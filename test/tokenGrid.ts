const {expect} = require("chai");
const {ethers} = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("TokenGrid", function () {
    let tokenGrid, testToken, owner, withdrawRole, refundRole, signer, user1, user2;
    let signerPrivateKey;

    beforeEach(async function () {
        [owner, withdrawRole, refundRole, signer, user1, user2] = await ethers.getSigners();

        // Store signer private key for signature generation - need to use a known private key
        // Generate a deterministic private key for testing and derive the corresponding address
        signerPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
        const testSigner = new ethers.Wallet(signerPrivateKey);
        
        // Deploy TokenGrid contract with the test signer's address
        const TokenGrid = await ethers.getContractFactory("TokenGrid");
        tokenGrid = await TokenGrid.deploy(owner.address, testSigner.address);

        // Grant withdraw role
        await tokenGrid.grantRole(tokenGrid.WITHDRAW_ROLE(), withdrawRole.address);
        
        // Grant refund role
        await tokenGrid.grantRole(tokenGrid.REFUND_ROLE(), refundRole.address);

        // Deploy test ERC20 token
        const TestToken = await ethers.getContractFactory("TestToken");
        testToken = await TestToken.deploy();

        // Mint tokens to users for testing
        await testToken.mint(user1.address, ethers.parseEther("1000"));
        await testToken.mint(user2.address, ethers.parseEther("1000"));
        // Mint tokens to the first account (owner) for transfers to contract
        await testToken.mint(owner.address, ethers.parseEther("1000"));
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

    // Helper function to create signatures for token deposit operations
    async function createDepositSignature(orderId, account, token, value, contractAddress, deadline, systemBalance = 0) {
        const messageHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "address", "address", "uint256", "uint256", "uint256", "address"],
                [orderId, account, token, value, deadline, systemBalance, contractAddress]
            )
        );
        return signMessageHash(messageHash);
    }

    // Helper function to create signatures for token claim operations
    async function createClaimSignature(orderId, account, token, value, contractAddress) {
        const messageHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "address", "address", "uint256", "address"],
                [orderId, account, token, value, contractAddress]
            )
        );
        return signMessageHash(messageHash);
    }

    describe("Deployment", function () {
        it("Should set the correct signer address", async function () {
            const testSigner = new ethers.Wallet(signerPrivateKey);
            expect(await tokenGrid.signerAddress()).to.equal(testSigner.address);
        });

        it("Should grant DEFAULT_ADMIN_ROLE, WITHDRAW_ROLE and REFUND_ROLE to owner", async function () {
            expect(await tokenGrid.hasRole(tokenGrid.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await tokenGrid.hasRole(tokenGrid.WITHDRAW_ROLE(), owner.address)).to.be.true;
            expect(await tokenGrid.hasRole(tokenGrid.REFUND_ROLE(), owner.address)).to.be.true;
        });

        it("Should revert with ZeroAddress error for zero admin address", async function () {
            const TokenGrid = await ethers.getContractFactory("TokenGrid");
            await expect(
                TokenGrid.deploy(ethers.ZeroAddress, signer.address)
            ).to.be.revertedWithCustomError(tokenGrid, "ZeroAddress");
        });
    });

    describe("setSigner", function () {
        it("Should allow admin to set new signer", async function () {
            const newSigner = user1.address;
            await tokenGrid.connect(owner).setSigner(newSigner);
            expect(await tokenGrid.signerAddress()).to.equal(newSigner);
        });

        it("Should revert if non-admin tries to set signer", async function () {
            await expect(
                tokenGrid.connect(user1).setSigner(user2.address)
            ).to.be.revertedWithCustomError(tokenGrid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Token Deposits", function () {
        beforeEach(async function () {
            // Approve tokenGrid contract to spend tokens
            await testToken.connect(user1).approve(await tokenGrid.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow valid token deposit with correct signature", async function () {
            const orderId = 1;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100"); // High systemBalance to prevent auto-withdrawal
            
            const sig = await createDepositSignature(orderId, user1.address, await testToken.getAddress(), amount, await tokenGrid.getAddress(), deadline, systemBalance);

            await expect(
                tokenGrid.connect(user1).depositToken(orderId, await testToken.getAddress(), amount, deadline, systemBalance, sig.v, sig.r, sig.s)
            )
                .to.emit(tokenGrid, "TokenDeposited")
                .withArgs(orderId, user1.address, await testToken.getAddress(), amount);

            expect(await tokenGrid.processedOrders(orderId)).to.be.true;
            expect(await testToken.balanceOf(await tokenGrid.getAddress())).to.equal(amount);
        });

        it("Should revert for invalid signature", async function () {
            const orderId = 2;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Create signature with wrong token address
            const wrongSig = await createDepositSignature(orderId, user1.address, user2.address, amount, await tokenGrid.getAddress(), deadline, 0);

            await expect(
                tokenGrid.connect(user1).depositToken(orderId, await testToken.getAddress(), amount, deadline, 0, wrongSig.v, wrongSig.r, wrongSig.s)
            ).to.be.revertedWithCustomError(tokenGrid, "WrongSignature");
        });

        it("Should revert for already processed order", async function () {
            const orderId = 3;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            const sig = await createDepositSignature(orderId, user1.address, await testToken.getAddress(), amount, await tokenGrid.getAddress(), deadline, 0);

            // First deposit should succeed
            await tokenGrid.connect(user1).depositToken(orderId, await testToken.getAddress(), amount, deadline, 0, sig.v, sig.r, sig.s);

            // Second deposit with same orderId should fail
            await expect(
                tokenGrid.connect(user1).depositToken(orderId, await testToken.getAddress(), amount, deadline, 0, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(tokenGrid, "OrderAlreadyProcessed");
        });

        it("Should revert for expired deadline", async function () {
            const orderId = 4;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
            
            const sig = await createDepositSignature(orderId, user1.address, await testToken.getAddress(), amount, await tokenGrid.getAddress(), deadline, 0);

            await expect(
                tokenGrid.connect(user1).depositToken(orderId, await testToken.getAddress(), amount, deadline, 0, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(tokenGrid, "DeadlineExpired");
        });
    });

    describe("Token Claims", function () {
        beforeEach(async function () {
            // Transfer tokens to the tokenGrid contract from owner account
            await testToken.connect(owner).transfer(await tokenGrid.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow valid token claim with correct signature", async function () {
            const orderId = 5;
            const amount = ethers.parseEther("10");
            const recipient = user2.address;
            
            const sig = await createClaimSignature(orderId, recipient, await testToken.getAddress(), amount, await tokenGrid.getAddress());

            const initialBalance = await testToken.balanceOf(recipient);

            await expect(
                tokenGrid.connect(user1).claimToken(orderId, recipient, await testToken.getAddress(), amount, sig.v, sig.r, sig.s)
            )
                .to.emit(tokenGrid, "TokenClaimed")
                .withArgs(orderId, recipient, await testToken.getAddress(), amount);

            expect(await tokenGrid.processedOrders(orderId)).to.be.true;
            
            const finalBalance = await testToken.balanceOf(recipient);
            expect(finalBalance - initialBalance).to.equal(amount);
        });

        it("Should revert for invalid signature", async function () {
            const orderId = 6;
            const amount = ethers.parseEther("10");
            
            // Create signature with wrong amount
            const wrongSig = await createClaimSignature(orderId, user2.address, await testToken.getAddress(), ethers.parseEther("5"), await tokenGrid.getAddress());

            await expect(
                tokenGrid.connect(user1).claimToken(orderId, user2.address, await testToken.getAddress(), amount, wrongSig.v, wrongSig.r, wrongSig.s)
            ).to.be.revertedWithCustomError(tokenGrid, "WrongSignature");
        });

        it("Should revert for already processed order", async function () {
            const orderId = 7;
            const amount = ethers.parseEther("10");
            const recipient = user2.address;
            
            const sig = await createClaimSignature(orderId, recipient, await testToken.getAddress(), amount, await tokenGrid.getAddress());

            // First claim should succeed
            await tokenGrid.connect(user1).claimToken(orderId, recipient, await testToken.getAddress(), amount, sig.v, sig.r, sig.s);

            // Second claim with same orderId should fail
            await expect(
                tokenGrid.connect(user1).claimToken(orderId, recipient, await testToken.getAddress(), amount, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(tokenGrid, "OrderAlreadyProcessed");
        });
    });

    describe("Withdraw ERC20", function () {
        beforeEach(async function () {
            // Transfer tokens to the contract from owner account
            await testToken.connect(owner).transfer(await tokenGrid.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow token withdrawal with reserved amount", async function () {
            const reserved = ethers.parseEther("20");
            const expectedWithdraw = ethers.parseEther("80");

            const initialBalance = await testToken.balanceOf(withdrawRole.address);

            await tokenGrid.connect(withdrawRole).withdrawERC20(await testToken.getAddress(), reserved);

            const finalBalance = await testToken.balanceOf(withdrawRole.address);
            const contractBalance = await testToken.balanceOf(await tokenGrid.getAddress());

            expect(contractBalance).to.equal(reserved);
            expect(finalBalance - initialBalance).to.equal(expectedWithdraw);
        });

        it("Should revert if reserved amount exceeds balance", async function () {
            const reserved = ethers.parseEther("150"); // More than contract balance

            await expect(
                tokenGrid.connect(withdrawRole).withdrawERC20(await testToken.getAddress(), reserved)
            ).to.be.revertedWithCustomError(tokenGrid, "InsufficientBalance");
        });

        it("Should revert if non-withdraw role tries to withdraw", async function () {
            await expect(
                tokenGrid.connect(user1).withdrawERC20(await testToken.getAddress(), 0)
            ).to.be.revertedWithCustomError(tokenGrid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Refund Tokens", function () {
        beforeEach(async function () {
            // Transfer tokens to the contract from owner account
            await testToken.connect(owner).transfer(await tokenGrid.getAddress(), ethers.parseEther("50"));
        });

        it("Should allow refund role to refund tokens", async function () {
            const refundAmount = ethers.parseEther("5");
            const recipient = user2.address;

            const initialBalance = await testToken.balanceOf(recipient);

            await expect(
                tokenGrid.connect(refundRole).refundToken(recipient, await testToken.getAddress(), refundAmount)
            )
                .to.emit(tokenGrid, "TokenRefunded")
                .withArgs(recipient, await testToken.getAddress(), refundAmount);

            const finalBalance = await testToken.balanceOf(recipient);
            expect(finalBalance - initialBalance).to.equal(refundAmount);
        });

        it("Should revert if non-refund role tries to refund tokens", async function () {
            const refundAmount = ethers.parseEther("5");

            await expect(
                tokenGrid.connect(user1).refundToken(user2.address, await testToken.getAddress(), refundAmount)
            ).to.be.revertedWithCustomError(tokenGrid, "AccessControlUnauthorizedAccount");
        });

        it("Should revert when refunding tokens to zero address", async function () {
            const refundAmount = ethers.parseEther("5");

            await expect(
                tokenGrid.connect(refundRole).refundToken(ethers.ZeroAddress, await testToken.getAddress(), refundAmount)
            ).to.be.revertedWithCustomError(tokenGrid, "ZeroAddress");
        });

        it("Should revert when contract has insufficient tokens", async function () {
            const refundAmount = ethers.parseEther("100"); // More than contract balance

            await expect(
                tokenGrid.connect(refundRole).refundToken(user2.address, await testToken.getAddress(), refundAmount)
            ).to.be.reverted; // ERC20 transfer will revert
        });
    });

    describe("Reserve Coefficients", function () {
        it("Should have default reserve coefficients set", async function () {
            expect(await tokenGrid.minReservesCoef()).to.equal(11000); // 110%
            expect(await tokenGrid.maxReservesCoef()).to.equal(12000); // 120%
        });

        it("Should allow admin to set reserve coefficients", async function () {
            await tokenGrid.connect(owner).setReserveCoefficients(5000, 15000); // 50% min, 150% max
            
            expect(await tokenGrid.minReservesCoef()).to.equal(5000);
            expect(await tokenGrid.maxReservesCoef()).to.equal(15000);
        });

        it("Should emit ReserveCoefficientsUpdated event", async function () {
            await expect(tokenGrid.connect(owner).setReserveCoefficients(8000, 13000))
                .to.emit(tokenGrid, "ReserveCoefficientsUpdated")
                .withArgs(8000, 13000);
        });

        it("Should revert if min coefficient > max coefficient", async function () {
            await expect(
                tokenGrid.connect(owner).setReserveCoefficients(15000, 10000)
            ).to.be.revertedWith("Min coefficient must be <= max coefficient");
        });

        it("Should revert if non-admin tries to set coefficients", async function () {
            await expect(
                tokenGrid.connect(user1).setReserveCoefficients(5000, 10000)
            ).to.be.revertedWithCustomError(tokenGrid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Withdraw Address", function () {
        it("Should have default withdraw address set to admin", async function () {
            expect(await tokenGrid.withdrawAddress()).to.equal(owner.address);
        });

        it("Should allow admin to set withdraw address", async function () {
            await tokenGrid.connect(owner).setWithdrawAddress(user2.address);
            expect(await tokenGrid.withdrawAddress()).to.equal(user2.address);
        });

        it("Should revert when setting zero address", async function () {
            await expect(
                tokenGrid.connect(owner).setWithdrawAddress(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(tokenGrid, "ZeroAddress");
        });

        it("Should revert if non-admin tries to set withdraw address", async function () {
            await expect(
                tokenGrid.connect(user1).setWithdrawAddress(user2.address)
            ).to.be.revertedWithCustomError(tokenGrid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Minimum Reserves", function () {
        it("Should allow admin to set minimum reserves for tokens", async function () {
            const minAmount = ethers.parseEther("100");
            await tokenGrid.connect(owner).setMinReserves(await testToken.getAddress(), minAmount);
            
            expect(await tokenGrid.minReserves(await testToken.getAddress())).to.equal(minAmount);
        });

        it("Should emit MinReservesUpdated event", async function () {
            const minAmount = ethers.parseEther("10");
            await expect(tokenGrid.connect(owner).setMinReserves(await testToken.getAddress(), minAmount))
                .to.emit(tokenGrid, "MinReservesUpdated")
                .withArgs(await testToken.getAddress(), minAmount);
        });

        it("Should revert if non-admin tries to set minimum reserves", async function () {
            await expect(
                tokenGrid.connect(user1).setMinReserves(await testToken.getAddress(), ethers.parseEther("5"))
            ).to.be.revertedWithCustomError(tokenGrid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Auto-withdrawal on Token Deposit", function () {
        beforeEach(async function () {
            // Set up withdraw address
            await tokenGrid.connect(owner).setWithdrawAddress(withdrawRole.address);
            
            // Set reserve coefficients for testing (10% min, 20% max)
            await tokenGrid.connect(owner).setReserveCoefficients(1000, 2000);
            
            // Approve tokenGrid contract to spend tokens
            await testToken.connect(user1).approve(await tokenGrid.getAddress(), ethers.parseEther("1000"));
        });

        it("Should trigger auto-withdrawal when token balance exceeds systemBalance + maxReserves", async function () {
            const systemBalance = ethers.parseEther("100");
            const depositAmount = ethers.parseEther("50");
            
            // First deposit to set up initial balance
            const orderId1 = 101;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig1 = await createDepositSignature(orderId1, user1.address, await testToken.getAddress(), depositAmount, await tokenGrid.getAddress(), deadline, systemBalance);
            await tokenGrid.connect(user1).depositToken(orderId1, await testToken.getAddress(), depositAmount, deadline, systemBalance, sig1.v, sig1.r, sig1.s);
            
            // Second deposit that should trigger auto-withdrawal
            // systemBalance = 100, maxReserves = 20% = 20, so max allowed = 120
            // Current balance = 50, adding another 80 = 130 total, should trigger withdrawal
            const orderId2 = 102;
            const triggerAmount = ethers.parseEther("80");
            const sig2 = await createDepositSignature(orderId2, user1.address, await testToken.getAddress(), triggerAmount, await tokenGrid.getAddress(), deadline, systemBalance);
            
            const withdrawBalanceBefore = await testToken.balanceOf(withdrawRole.address);
            
            await expect(
                tokenGrid.connect(user1).depositToken(orderId2, await testToken.getAddress(), triggerAmount, deadline, systemBalance, sig2.v, sig2.r, sig2.s)
            ).to.emit(tokenGrid, "AutoWithdrawal");
            
            const withdrawBalanceAfter = await testToken.balanceOf(withdrawRole.address);
            const contractBalance = await testToken.balanceOf(await tokenGrid.getAddress());
            
            // Contract should keep systemBalance + minReserves (100 + 10 = 110)
            const expectedContractBalance = systemBalance + (systemBalance * 1000n / 10000n);
            expect(contractBalance).to.equal(expectedContractBalance);
            
            // Withdraw address should receive the excess
            const expectedWithdraw = depositAmount + triggerAmount - expectedContractBalance;
            expect(withdrawBalanceAfter - withdrawBalanceBefore).to.equal(expectedWithdraw);
        });

        it("Should respect absolute minimum reserves for tokens", async function () {
            // Set absolute minimum reserves higher than coefficient-based
            const absoluteMin = ethers.parseEther("30");
            await tokenGrid.connect(owner).setMinReserves(await testToken.getAddress(), absoluteMin);
            
            const systemBalance = ethers.parseEther("10"); // coefficient min would be 1 token
            const depositAmount = ethers.parseEther("50");
            
            const orderId = 103;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(orderId, user1.address, await testToken.getAddress(), depositAmount, await tokenGrid.getAddress(), deadline, systemBalance);
            
            await expect(
                tokenGrid.connect(user1).depositToken(orderId, await testToken.getAddress(), depositAmount, deadline, systemBalance, sig.v, sig.r, sig.s)
            ).to.emit(tokenGrid, "AutoWithdrawal");
            
            const contractBalance = await testToken.balanceOf(await tokenGrid.getAddress());
            
            // Should keep systemBalance + absoluteMin (10 + 30 = 40)
            expect(contractBalance).to.equal(systemBalance + absoluteMin);
        });

        it("Should not trigger auto-withdrawal when balance is within limits", async function () {
            const systemBalance = ethers.parseEther("100");
            const depositAmount = ethers.parseEther("10"); // Won't exceed max allowed
            
            const orderId = 104;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(orderId, user1.address, await testToken.getAddress(), depositAmount, await tokenGrid.getAddress(), deadline, systemBalance);
            
            await expect(
                tokenGrid.connect(user1).depositToken(orderId, await testToken.getAddress(), depositAmount, deadline, systemBalance, sig.v, sig.r, sig.s)
            ).to.not.emit(tokenGrid, "AutoWithdrawal");
            
            const contractBalance = await testToken.balanceOf(await tokenGrid.getAddress());
            expect(contractBalance).to.equal(depositAmount);
        });
    });

    describe("Token Deposits with systemBalance parameter", function () {
        beforeEach(async function () {
            await testToken.connect(user1).approve(await tokenGrid.getAddress(), ethers.parseEther("100"));
        });

        it("Should accept token deposit with systemBalance parameter", async function () {
            const orderId = 201;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("50");
            
            const sig = await createDepositSignature(orderId, user1.address, await testToken.getAddress(), amount, await tokenGrid.getAddress(), deadline, systemBalance);

            await expect(
                tokenGrid.connect(user1).depositToken(orderId, await testToken.getAddress(), amount, deadline, systemBalance, sig.v, sig.r, sig.s)
            )
                .to.emit(tokenGrid, "TokenDeposited")
                .withArgs(orderId, user1.address, await testToken.getAddress(), amount);

            expect(await tokenGrid.processedOrders(orderId)).to.be.true;
        });

        it("Should revert with wrong systemBalance in signature", async function () {
            const orderId = 202;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const correctSystemBalance = ethers.parseEther("50");
            const wrongSystemBalance = ethers.parseEther("100");
            
            // Create signature with correct systemBalance
            const sig = await createDepositSignature(orderId, user1.address, await testToken.getAddress(), amount, await tokenGrid.getAddress(), deadline, correctSystemBalance);

            // Try to use with different systemBalance
            await expect(
                tokenGrid.connect(user1).depositToken(orderId, await testToken.getAddress(), amount, deadline, wrongSystemBalance, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(tokenGrid, "WrongSignature");
        });
    });
});