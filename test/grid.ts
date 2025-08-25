const {expect} = require("chai");
const {ethers} = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("Grid", function () {
    let grid, owner, withdrawRole, refundRole, signer, user1, user2;
    let signerPrivateKey;

    beforeEach(async function () {
        [owner, withdrawRole, refundRole, signer, user1, user2] = await ethers.getSigners();

        // Store signer private key for signature generation - need to use a known private key
        // Generate a deterministic private key for testing and derive the corresponding address
        signerPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
        const testSigner = new ethers.Wallet(signerPrivateKey);

        // Deploy Grid contract with the test signer's address
        const Grid = await ethers.getContractFactory("Grid");
        grid = await Grid.deploy(owner.address, testSigner.address);

        // Grant withdraw role
        await grid.grantRole(await grid.WITHDRAW_ROLE(), withdrawRole.address);

        // Grant refund role
        await grid.grantRole(await grid.REFUND_ROLE(), refundRole.address);
    });

    // Common signing function
    function signMessageHash(messageHash) {
        const signingKey = new ethers.SigningKey(signerPrivateKey);
        const signature = signingKey.sign(messageHash);

        return {
            v: signature.v,
            r: signature.r,
            s: signature.s
        };
    }

    // Helper function to create signatures for ETH deposit operations (with deadline and systemBalance)
    async function createDepositSignature(signId, account, value, contractAddress, deadline, systemBalance = 0) {
        const messageHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "address", "uint256", "uint256", "uint256", "address"],
                [signId, account, value, deadline, systemBalance, contractAddress]
            )
        );
        return signMessageHash(messageHash);
    }

    // Helper function to create signatures for ETH claim operations (without deadline)
    async function createClaimSignature(signId, account, value, contractAddress) {
        const messageHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "address", "uint256", "address"],
                [signId, account, value, contractAddress]
            )
        );
        return signMessageHash(messageHash);
    }

    describe("Deployment", function () {
        it("Should set the correct signer address", async function () {
            const testSigner = new ethers.Wallet(signerPrivateKey);
            expect(await grid.signerAddress()).to.equal(testSigner.address);
        });

        it("Should grant DEFAULT_ADMIN_ROLE and WITHDRAW_ROLE to owner", async function () {
            expect(await grid.hasRole(await grid.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await grid.hasRole(await grid.WITHDRAW_ROLE(), owner.address)).to.be.true;
        });

        it("Should revert with ZeroAddress error for zero admin address", async function () {
            const Grid = await ethers.getContractFactory("Grid");
            await expect(
                Grid.deploy(ethers.ZeroAddress, signer.address)
            ).to.be.revertedWithCustomError(grid, "ZeroAddress");
        });
    });

    describe("setSigner", function () {
        it("Should allow admin to set new signer", async function () {
            const newSigner = user1.address;
            await grid.connect(owner).setSigner(newSigner);
            expect(await grid.signerAddress()).to.equal(newSigner);
        });

        it("Should revert if non-admin tries to set signer", async function () {
            await expect(
                grid.connect(user1).setSigner(user2.address)
            ).to.be.revertedWithCustomError(grid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("ETH Deposits", function () {
        it("Should allow valid ETH deposit with correct signature", async function () {
            const signId = 1;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            const systemBalance = ethers.parseEther("10"); // Set systemBalance to prevent auto-withdrawal

            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, systemBalance);

            await expect(
                grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value })
            )
                .to.emit(grid, "EthDeposited")
                .withArgs(signId, user1.address, value);

            expect(await grid.processedOrders(signId)).to.be.true;
            expect(await ethers.provider.getBalance(await grid.getAddress())).to.equal(value);
        });

        it("Should revert for invalid signature", async function () {
            const signId = 1;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            // Create signature with wrong signer
            const wrongSig = await createDepositSignature(signId, user2.address, value, await grid.getAddress(), deadline);

            await expect(
                grid.connect(user1).depositEth(signId, deadline, 0, wrongSig.v, wrongSig.r, wrongSig.s, { value })
            ).to.be.revertedWithCustomError(grid, "WrongSignature");
        });

        it("Should revert for already processed order", async function () {
            const signId = 1;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline);

            // First deposit should succeed
            await grid.connect(user1).depositEth(signId, deadline, 0, sig.v, sig.r, sig.s, { value });

            // Second deposit with same signId should fail
            await expect(
                grid.connect(user1).depositEth(signId, deadline, 0, sig.v, sig.r, sig.s, { value })
            ).to.be.revertedWithCustomError(grid, "OrderAlreadyProcessed");
        });

        it("Should revert for expired deadline", async function () {
            const signId = 2;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline);

            await expect(
                grid.connect(user1).depositEth(signId, deadline, 0, sig.v, sig.r, sig.s, { value })
            ).to.be.revertedWithCustomError(grid, "DeadlineExpired");
        });
    });

    describe("ETH Claims", function () {
        beforeEach(async function () {
            // Add some ETH to the contract using deposit function with high systemBalance to prevent auto-withdrawal
            const signId = 999; // Use a unique order ID for setup
            const value = ethers.parseEther("10");
            const systemBalance = ethers.parseEther("100"); // High systemBalance to prevent auto-withdrawal
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value });
        });

        it("Should allow valid ETH claim with correct signature", async function () {
            const signId = 2;
            const value = ethers.parseEther("1");
            const recipient = user2.address;
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            const sig = await createClaimSignature(signId, recipient, value, await grid.getAddress());

            const initialBalance = await ethers.provider.getBalance(recipient);

            await expect(
                grid.connect(user1).claimEth(signId, recipient, value, sig.v, sig.r, sig.s)
            )
                .to.emit(grid, "EthClaimed")
                .withArgs(signId, recipient, value);

            expect(await grid.processedOrders(signId)).to.be.true;

            const finalBalance = await ethers.provider.getBalance(recipient);
            expect(finalBalance - initialBalance).to.equal(value);
        });

        it("Should revert for invalid signature", async function () {
            const signId = 2;
            const value = ethers.parseEther("1");

            // Create signature with wrong recipient
            const wrongSig = await createClaimSignature(signId, user1.address, value, await grid.getAddress());

            await expect(
                grid.connect(user1).claimEth(signId, user2.address, value, wrongSig.v, wrongSig.r, wrongSig.s)
            ).to.be.revertedWithCustomError(grid, "WrongSignature");
        });

        it("Should revert for already processed order", async function () {
            const signId = 2;
            const value = ethers.parseEther("1");
            const recipient = user2.address;

            const sig = await createClaimSignature(signId, recipient, value, await grid.getAddress());

            // First claim should succeed
            await grid.connect(user1).claimEth(signId, recipient, value, sig.v, sig.r, sig.s);

            // Second claim with same signId should fail
            await expect(
                grid.connect(user1).claimEth(signId, recipient, value, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(grid, "OrderAlreadyProcessed");
        });
    });

    describe("Withdraw ETH", function () {
        beforeEach(async function () {
            // Add ETH to the contract using deposit function with high systemBalance to prevent auto-withdrawal
            const signId = 998; // Use a unique order ID for setup
            const value = ethers.parseEther("10");
            const systemBalance = ethers.parseEther("100"); // High systemBalance to prevent auto-withdrawal
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value });
        });

        it("Should allow withdrawal with reserved amount", async function () {
            const reserved = ethers.parseEther("2");
            const expectedWithdraw = ethers.parseEther("8");

            const initialBalance = await ethers.provider.getBalance(withdrawRole.address);

            await grid.connect(withdrawRole).withdrawEth(reserved);

            const finalBalance = await ethers.provider.getBalance(withdrawRole.address);
            const contractBalance = await ethers.provider.getBalance(await grid.getAddress());

            expect(contractBalance).to.equal(reserved);
            // Account for gas costs in balance check
            expect(finalBalance).to.be.gt(initialBalance);
        });

        it("Should revert if reserved amount exceeds balance", async function () {
            const reserved = ethers.parseEther("15"); // More than contract balance

            await expect(
                grid.connect(withdrawRole).withdrawEth(reserved)
            ).to.be.revertedWithCustomError(grid, "InsufficientBalance");
        });

        it("Should revert if non-withdraw role tries to withdraw", async function () {
            await expect(
                grid.connect(user1).withdrawEth(0)
            ).to.be.revertedWithCustomError(grid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Refund ETH", function () {
        beforeEach(async function () {
            // Add ETH to the contract using deposit function with high systemBalance to prevent auto-withdrawal
            const signId = 997; // Use a unique order ID for setup
            const value = ethers.parseEther("5");
            const systemBalance = ethers.parseEther("100"); // High systemBalance to prevent auto-withdrawal
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value });
        });

        it("Should allow refund role to refund ETH", async function () {
            const refundAmount = ethers.parseEther("1");
            // Use user1 who made the deposit, not user2
            const recipient = user1.address;

            const initialBalance = await ethers.provider.getBalance(recipient);

            await expect(
                grid.connect(refundRole).refundEth(recipient, refundAmount)
            )
                .to.emit(grid, "EthRefunded")
                .withArgs(recipient, refundAmount);

            const finalBalance = await ethers.provider.getBalance(recipient);
            expect(finalBalance - initialBalance).to.equal(refundAmount);
        });

        it("Should revert if non-refund role tries to refund ETH", async function () {
            const refundAmount = ethers.parseEther("1");

            await expect(
                grid.connect(user1).refundEth(user2.address, refundAmount)
            ).to.be.revertedWithCustomError(grid, "AccessControlUnauthorizedAccount");
        });

        it("Should revert when refunding to zero address", async function () {
            const refundAmount = ethers.parseEther("1");

            await expect(
                grid.connect(refundRole).refundEth(ethers.ZeroAddress, refundAmount)
            ).to.be.revertedWithCustomError(grid, "ZeroAddress");
        });

        it("Should revert when contract has insufficient ETH", async function () {
            // First withdraw most of the ETH from the contract
            const currentBalance = await ethers.provider.getBalance(await grid.getAddress());
            await grid.connect(withdrawRole).withdrawEth(ethers.parseEther("0.1")); // Leave only 0.1 ETH

            // Now try to refund more than what's left in the contract
            const refundAmount = ethers.parseEther("1"); // More than remaining balance but less than deposit

            await expect(
                grid.connect(refundRole).refundEth(user1.address, refundAmount)
            ).to.be.revertedWithCustomError(grid, "EthTransferFailed");
        });
    });

    describe("Reserve Parameters", function () {
        it("Should have default reserve coefficients set", async function () {
            expect(await grid.minReservesCoef()).to.equal(11000); // 110%
            expect(await grid.maxReservesCoef()).to.equal(12000); // 120%
        });

        it("Should allow admin to set reserve parameters", async function () {
            const minAmount = ethers.parseEther("5");
            await grid.connect(owner).setReserveParameters(11000, 15000, minAmount); // 110% min, 150% max, 5 ETH absolute

            expect(await grid.minReservesCoef()).to.equal(11000);
            expect(await grid.maxReservesCoef()).to.equal(15000);
            expect(await grid.minReserves()).to.equal(minAmount);
        });

        it("Should emit ReserveParametersUpdated event", async function () {
            const minAmount = ethers.parseEther("10");
            await expect(grid.connect(owner).setReserveParameters(11000, 13000, minAmount))
                .to.emit(grid, "ReserveParametersUpdated")
                .withArgs(11000, 13000, minAmount);
        });

        it("Should revert if min coefficient > max coefficient", async function () {
            await expect(
                grid.connect(owner).setReserveParameters(15000, 12000, ethers.parseEther("1"))
            ).to.be.revertedWith("Min coefficient must be <= max coefficient");
        });

        it("Should revert if min coefficient <= 100%", async function () {
            await expect(
                grid.connect(owner).setReserveParameters(10000, 15000, ethers.parseEther("1"))
            ).to.be.revertedWith("Min coefficient must be > 100% (10000)");
        });

        it("Should revert if max coefficient <= 100%", async function () {
            await expect(
                grid.connect(owner).setReserveParameters(11000, 10000, ethers.parseEther("1"))
            ).to.be.revertedWith("Max coefficient must be > 100% (10000)");
        });

        it("Should revert if non-admin tries to set parameters", async function () {
            await expect(
                grid.connect(user1).setReserveParameters(11000, 12000, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(grid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Withdraw Address", function () {
        it("Should have default withdraw address set to admin", async function () {
            expect(await grid.withdrawAddress()).to.equal(owner.address);
        });

        it("Should allow admin to set withdraw address", async function () {
            await grid.connect(owner).setWithdrawAddress(user2.address);
            expect(await grid.withdrawAddress()).to.equal(user2.address);
        });

        it("Should revert when setting zero address", async function () {
            await expect(
                grid.connect(owner).setWithdrawAddress(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(grid, "ZeroAddress");
        });

        it("Should revert if non-admin tries to set withdraw address", async function () {
            await expect(
                grid.connect(user1).setWithdrawAddress(user2.address)
            ).to.be.revertedWithCustomError(grid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Auto-withdrawal on ETH Deposit", function () {
        beforeEach(async function () {
            // Set up withdraw address
            await grid.connect(owner).setWithdrawAddress(withdrawRole.address);

            // Set reserve coefficients for testing (110% min, 120% max)
            await grid.connect(owner).setReserveParameters(11000, 12000, 0);
        });

        it("Should trigger auto-withdrawal when balance exceeds systemBalance + maxReserves", async function () {
            const systemBalance = ethers.parseEther("10");
            const depositAmount = ethers.parseEther("5");

            // First deposit to set up initial balance
            const signId1 = 1001;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig1 = await createDepositSignature(signId1, user1.address, depositAmount, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId1, deadline, systemBalance, sig1.v, sig1.r, sig1.s, { value: depositAmount });

            // Second deposit that should trigger auto-withdrawal
            // systemBalance = 10 ETH, maxReservesCoef = 120%, so max allowed = 12 ETH
            // Current balance = 5 ETH, adding another 8 ETH = 13 ETH total, should trigger withdrawal
            const signId2 = 1002;
            const triggerAmount = ethers.parseEther("8");
            const sig2 = await createDepositSignature(signId2, user1.address, triggerAmount, await grid.getAddress(), deadline, systemBalance);

            const withdrawBalanceBefore = await ethers.provider.getBalance(withdrawRole.address);

            await expect(
                grid.connect(user1).depositEth(signId2, deadline, systemBalance, sig2.v, sig2.r, sig2.s, { value: triggerAmount })
            ).to.emit(grid, "AutoWithdrawal");

            const withdrawBalanceAfter = await ethers.provider.getBalance(withdrawRole.address);
            const contractBalance = await ethers.provider.getBalance(await grid.getAddress());

            // Contract should keep 110% of systemBalance (10 ETH * 110% = 11 ETH)
            const expectedContractBalance = systemBalance * 11000n / 10000n; // 11 ETH
            expect(contractBalance).to.equal(expectedContractBalance);

            // Withdraw address should receive the excess
            const expectedWithdraw = depositAmount + triggerAmount - expectedContractBalance;
            expect(withdrawBalanceAfter - withdrawBalanceBefore).to.equal(expectedWithdraw);
        });

        it("Should respect absolute minimum reserves over coefficient-based reserves", async function () {
            // Set absolute minimum reserves higher than coefficient-based
            const absoluteMin = ethers.parseEther("3");
            await grid.connect(owner).setReserveParameters(11000, 12000, absoluteMin);

            const systemBalance = ethers.parseEther("1"); // coefficient min would be 1.1 ETH
            const depositAmount = ethers.parseEther("6");

            const signId = 1003;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(signId, user1.address, depositAmount, await grid.getAddress(), deadline, systemBalance);

            await expect(
                grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value: depositAmount })
            ).to.emit(grid, "AutoWithdrawal");

            const contractBalance = await ethers.provider.getBalance(await grid.getAddress());

            // Should keep systemBalance + absoluteMin (1 + 3 = 4 ETH)
            expect(contractBalance).to.equal(systemBalance + absoluteMin);
        });

        it("Should not trigger auto-withdrawal when balance is within limits", async function () {
            const systemBalance = ethers.parseEther("10");
            const depositAmount = ethers.parseEther("1"); // Won't exceed max allowed

            const signId = 1004;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(signId, user1.address, depositAmount, await grid.getAddress(), deadline, systemBalance);

            await expect(
                grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value: depositAmount })
            ).to.not.emit(grid, "AutoWithdrawal");

            const contractBalance = await ethers.provider.getBalance(await grid.getAddress());
            expect(contractBalance).to.equal(depositAmount);
        });
    });

    describe("ETH Deposits with systemBalance parameter", function () {
        it("Should accept deposit with systemBalance parameter", async function () {
            const signId = 3001;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("5");

            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, systemBalance);

            await expect(
                grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value })
            )
                .to.emit(grid, "EthDeposited")
                .withArgs(signId, user1.address, value);

            expect(await grid.processedOrders(signId)).to.be.true;
        });

        it("Should revert with wrong systemBalance in signature", async function () {
            const signId = 3002;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const correctSystemBalance = ethers.parseEther("5");
            const wrongSystemBalance = ethers.parseEther("10");

            // Create signature with correct systemBalance
            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, correctSystemBalance);

            // Try to use with different systemBalance
            await expect(
                grid.connect(user1).depositEth(signId, deadline, wrongSystemBalance, sig.v, sig.r, sig.s, { value })
            ).to.be.revertedWithCustomError(grid, "WrongSignature");
        });
    });

    describe("Deposit Tracking", function () {
        it("Should track deposit amount per account", async function () {
            const signId = 4001;
            const value = ethers.parseEther("2");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("10");

            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, systemBalance);

            await grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value });

            expect(await grid.deposits(user1.address)).to.equal(value);
        });

        it("Should update deposit amount with new deposit (not cumulative)", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("10");

            // First deposit
            const signId1 = 4002;
            const value1 = ethers.parseEther("2");
            const sig1 = await createDepositSignature(signId1, user1.address, value1, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId1, deadline, systemBalance, sig1.v, sig1.r, sig1.s, { value: value1 });

            expect(await grid.deposits(user1.address)).to.equal(value1);

            // Second deposit should replace, not add
            const signId2 = 4003;
            const value2 = ethers.parseEther("3");
            const sig2 = await createDepositSignature(signId2, user1.address, value2, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId2, deadline, systemBalance, sig2.v, sig2.r, sig2.s, { value: value2 });

            expect(await grid.deposits(user1.address)).to.equal(value2); // Should be value2, not value1 + value2
        });
    });

    describe("Refund with Deposit Validation", function () {
        beforeEach(async function () {
            // User1 deposits 5 ETH
            const signId = 5000;
            const value = ethers.parseEther("5");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100");

            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value });
        });

        it("Should allow refund less than deposit amount", async function () {
            const refundAmount = ethers.parseEther("2");
            const initialBalance = await ethers.provider.getBalance(user1.address);

            await expect(
                grid.connect(refundRole).refundEth(user1.address, refundAmount)
            )
                .to.emit(grid, "EthRefunded")
                .withArgs(user1.address, refundAmount);

            // Check deposit was reset to 0
            expect(await grid.deposits(user1.address)).to.equal(0);
        });

        it("Should allow refund equal to deposit amount", async function () {
            const refundAmount = ethers.parseEther("5");

            await expect(
                grid.connect(refundRole).refundEth(user1.address, refundAmount)
            )
                .to.emit(grid, "EthRefunded")
                .withArgs(user1.address, refundAmount);

            // Check deposit was cleared
            expect(await grid.deposits(user1.address)).to.equal(0);
        });

        it("Should revert when refund exceeds deposit amount", async function () {
            const refundAmount = ethers.parseEther("6"); // More than deposited

            await expect(
                grid.connect(refundRole).refundEth(user1.address, refundAmount)
            ).to.be.revertedWithCustomError(grid, "InvalidRefundAmount");
        });

        it("Should not allow multiple refunds after first refund (deposit reset)", async function () {
            // First refund resets deposit to 0
            await grid.connect(refundRole).refundEth(user1.address, ethers.parseEther("2"));
            expect(await grid.deposits(user1.address)).to.equal(0);

            // Second refund should fail since deposit is now 0
            await expect(
                grid.connect(refundRole).refundEth(user1.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(grid, "InvalidRefundAmount");
        });

        it("Should revert when refunding to user with no deposit", async function () {
            await expect(
                grid.connect(refundRole).refundEth(user2.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(grid, "InvalidRefundAmount");
        });
    });

    describe("Claim with Deposit Clearing", function () {
        beforeEach(async function () {
            // User1 deposits 2 ETH
            const signId = 6000;
            const value = ethers.parseEther("2");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100");

            const sig = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value });
        });

        it("Should clear deposit record when claiming", async function () {
            expect(await grid.deposits(user1.address)).to.equal(ethers.parseEther("2"));

            const signId = 6001;
            const claimValue = ethers.parseEther("1");
            const sig = await createClaimSignature(signId, user1.address, claimValue, await grid.getAddress());

            await grid.claimEth(signId, user1.address, claimValue, sig.v, sig.r, sig.s);

            // Deposit should be cleared after claim
            expect(await grid.deposits(user1.address)).to.equal(0);
        });

        it("Should not allow refund after claim (deposit cleared)", async function () {
            // First claim
            const signId = 6002;
            const claimValue = ethers.parseEther("1");
            const sig = await createClaimSignature(signId, user1.address, claimValue, await grid.getAddress());

            await grid.claimEth(signId, user1.address, claimValue, sig.v, sig.r, sig.s);

            // Now try to refund - should fail as deposit is cleared
            await expect(
                grid.connect(refundRole).refundEth(user1.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(grid, "InvalidRefundAmount");
        });
    });

    describe("Direct ETH Transfer (Topup)", function () {
        it("Should accept direct ETH transfer and emit Topup event", async function () {
            const amount = ethers.parseEther("1");
            
            await expect(
                user1.sendTransaction({
                    to: await grid.getAddress(),
                    value: amount
                })
            )
                .to.emit(grid, "Topup")
                .withArgs(user1.address, amount);

            // Check contract balance increased
            expect(await ethers.provider.getBalance(await grid.getAddress())).to.equal(amount);
        });

        it("Should handle multiple direct transfers from different accounts", async function () {
            const amount1 = ethers.parseEther("1");
            const amount2 = ethers.parseEther("2");

            // First transfer from user1
            await expect(
                user1.sendTransaction({
                    to: await grid.getAddress(),
                    value: amount1
                })
            )
                .to.emit(grid, "Topup")
                .withArgs(user1.address, amount1);

            // Second transfer from user2
            await expect(
                user2.sendTransaction({
                    to: await grid.getAddress(),
                    value: amount2
                })
            )
                .to.emit(grid, "Topup")
                .withArgs(user2.address, amount2);

            // Check total contract balance
            expect(await ethers.provider.getBalance(await grid.getAddress())).to.equal(amount1 + amount2);
        });

        it("Should accept zero value transfers", async function () {
            await expect(
                user1.sendTransaction({
                    to: await grid.getAddress(),
                    value: 0
                })
            )
                .to.emit(grid, "Topup")
                .withArgs(user1.address, 0);
        });

        it("Should work alongside regular deposits", async function () {
            // Regular signature-based deposit
            const signId = 7001;
            const depositAmount = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("10");

            const sig = await createDepositSignature(signId, user1.address, depositAmount, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId, deadline, systemBalance, sig.v, sig.r, sig.s, { value: depositAmount });

            // Direct transfer
            const topupAmount = ethers.parseEther("0.5");
            await expect(
                user2.sendTransaction({
                    to: await grid.getAddress(),
                    value: topupAmount
                })
            )
                .to.emit(grid, "Topup")
                .withArgs(user2.address, topupAmount);

            // Check total balance is sum of both
            expect(await ethers.provider.getBalance(await grid.getAddress())).to.equal(depositAmount + topupAmount);
        });
    });

    describe("LastSignId Tracking and Auto-withdrawal", function () {
        beforeEach(async function () {
            // Set up withdraw address
            await grid.connect(owner).setWithdrawAddress(withdrawRole.address);

            // Set reserve coefficients for testing (110% min, 120% max)
            await grid.connect(owner).setReserveParameters(11000, 12000, 0);
        });

        it("Should track lastSignId correctly", async function () {
            // Check initial lastSignId is 0
            expect(await grid.lastSignId()).to.equal(0);

            // First deposit with signId = 5
            const signId1 = 5;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("10");

            const sig1 = await createDepositSignature(signId1, user1.address, value, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId1, deadline, systemBalance, sig1.v, sig1.r, sig1.s, { value });

            // Check lastSignId updated to 5
            expect(await grid.lastSignId()).to.equal(5);

            // Second deposit with higher signId = 10
            const signId2 = 10;
            const sig2 = await createDepositSignature(signId2, user1.address, value, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId2, deadline, systemBalance, sig2.v, sig2.r, sig2.s, { value });

            // Check lastSignId updated to 10
            expect(await grid.lastSignId()).to.equal(10);
        });

        it("Should only trigger auto-withdrawal for newer signIds", async function () {
            const systemBalance = ethers.parseEther("10");
            const depositAmount = ethers.parseEther("15"); // This amount should trigger auto-withdrawal
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            // First deposit with signId = 5 (should trigger auto-withdrawal)
            const signId1 = 5;
            const sig1 = await createDepositSignature(signId1, user1.address, depositAmount, await grid.getAddress(), deadline, systemBalance);
            
            await expect(
                grid.connect(user1).depositEth(signId1, deadline, systemBalance, sig1.v, sig1.r, sig1.s, { value: depositAmount })
            ).to.emit(grid, "AutoWithdrawal");

            expect(await grid.lastSignId()).to.equal(5);

            // Second deposit with lower signId = 3 (should NOT trigger auto-withdrawal)
            const signId2 = 3;
            const sig2 = await createDepositSignature(signId2, user2.address, depositAmount, await grid.getAddress(), deadline, systemBalance);
            
            await expect(
                grid.connect(user2).depositEth(signId2, deadline, systemBalance, sig2.v, sig2.r, sig2.s, { value: depositAmount })
            ).to.not.emit(grid, "AutoWithdrawal");

            // lastSignId should remain 5
            expect(await grid.lastSignId()).to.equal(5);

            // Third deposit with higher signId = 8 (should trigger auto-withdrawal)
            const signId3 = 8;
            const sig3 = await createDepositSignature(signId3, user1.address, depositAmount, await grid.getAddress(), deadline, systemBalance);
            
            await expect(
                grid.connect(user1).depositEth(signId3, deadline, systemBalance, sig3.v, sig3.r, sig3.s, { value: depositAmount })
            ).to.emit(grid, "AutoWithdrawal");

            // lastSignId should now be 8
            expect(await grid.lastSignId()).to.equal(8);
        });

        it("Should allow deposits with same signId but not update lastSignId twice", async function () {
            const signId = 5;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("10");

            // First deposit with signId = 5
            const sig1 = await createDepositSignature(signId, user1.address, value, await grid.getAddress(), deadline, systemBalance);
            await grid.connect(user1).depositEth(signId, deadline, systemBalance, sig1.v, sig1.r, sig1.s, { value });

            expect(await grid.lastSignId()).to.equal(5);

            // Try to deposit again with same signId (should fail due to OrderAlreadyProcessed)
            await expect(
                grid.connect(user1).depositEth(signId, deadline, systemBalance, sig1.v, sig1.r, sig1.s, { value })
            ).to.be.revertedWithCustomError(grid, "OrderAlreadyProcessed");
        });
    });

});
