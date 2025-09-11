const {expect} = require("chai");
const {ethers} = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("GridleToken", function () {
    let gridleToken, testToken, owner, withdrawRole, refundRole, signer, user1, user2;
    let signerPrivateKey;

    beforeEach(async function () {
        [owner, withdrawRole, refundRole, signer, user1, user2] = await ethers.getSigners();

        // Store signer private key for signature generation - need to use a known private key
        // Generate a deterministic private key for testing and derive the corresponding address
        signerPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
        const testSigner = new ethers.Wallet(signerPrivateKey);
        
        // Deploy GridleToken contract with the test signer's address
        const GridleToken = await ethers.getContractFactory("GridleToken");
        gridleToken = await GridleToken.deploy(owner.address, testSigner.address);

        // Grant withdraw role
        await gridleToken.grantRole(gridleToken.WITHDRAW_ROLE(), withdrawRole.address);
        
        // Grant refund role
        await gridleToken.grantRole(gridleToken.REFUND_ROLE(), refundRole.address);

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
    async function createDepositSignature(signId, account, token, value, contractAddress, deadline, systemBalance = 0) {
        const messageHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "address", "address", "uint256", "uint256", "uint256", "address"],
                [signId, account, token, value, deadline, systemBalance, contractAddress]
            )
        );
        return signMessageHash(messageHash);
    }

    // Helper function to create signatures for token claim operations
    async function createClaimSignature(signId, account, token, value, contractAddress) {
        const messageHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "address", "address", "uint256", "address"],
                [signId, account, token, value, contractAddress]
            )
        );
        return signMessageHash(messageHash);
    }

    describe("Deployment", function () {
        it("Should set the correct signer address", async function () {
            const testSigner = new ethers.Wallet(signerPrivateKey);
            expect(await gridleToken.signerAddress()).to.equal(testSigner.address);
        });

        it("Should grant DEFAULT_ADMIN_ROLE, WITHDRAW_ROLE and REFUND_ROLE to owner", async function () {
            expect(await gridleToken.hasRole(gridleToken.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await gridleToken.hasRole(gridleToken.WITHDRAW_ROLE(), owner.address)).to.be.true;
            expect(await gridleToken.hasRole(gridleToken.REFUND_ROLE(), owner.address)).to.be.true;
        });

        it("Should revert with ZeroAddress error for zero admin address", async function () {
            const GridleToken = await ethers.getContractFactory("GridleToken");
            await expect(
                GridleToken.deploy(ethers.ZeroAddress, signer.address)
            ).to.be.revertedWithCustomError(gridleToken, "ZeroAddress");
        });
    });

    describe("setSigner", function () {
        it("Should allow admin to set new signer", async function () {
            const newSigner = user1.address;
            await gridleToken.connect(owner).setSigner(newSigner);
            expect(await gridleToken.signerAddress()).to.equal(newSigner);
        });

        it("Should revert if non-admin tries to set signer", async function () {
            await expect(
                gridleToken.connect(user1).setSigner(user2.address)
            ).to.be.revertedWithCustomError(gridleToken, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Token Deposits", function () {
        beforeEach(async function () {
            // Approve gridleToken contract to spend tokens
            await testToken.connect(user1).approve(await gridleToken.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow valid token deposit with correct signature", async function () {
            const signId = 1;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100"); // High systemBalance to prevent auto-withdrawal
            
            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), amount, await gridleToken.getAddress(), deadline, systemBalance);

            await expect(
                gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, systemBalance, sig.v, sig.r, sig.s)
            )
                .to.emit(gridleToken, "TokenDeposited")
                .withArgs(signId, user1.address, await testToken.getAddress(), amount);

            expect(await gridleToken.processedOrders(signId)).to.be.true;
            expect(await testToken.balanceOf(await gridleToken.getAddress())).to.equal(amount);
        });

        it("Should revert for invalid signature", async function () {
            const signId = 2;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Create signature with wrong token address
            const wrongSig = await createDepositSignature(signId, user1.address, user2.address, amount, await gridleToken.getAddress(), deadline, 0);

            await expect(
                gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, 0, wrongSig.v, wrongSig.r, wrongSig.s)
            ).to.be.revertedWithCustomError(gridleToken, "WrongSignature");
        });

        it("Should revert for already processed order", async function () {
            const signId = 3;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), amount, await gridleToken.getAddress(), deadline, 0);

            // First deposit should succeed
            await gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, 0, sig.v, sig.r, sig.s);

            // Second deposit with same signId should fail
            await expect(
                gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, 0, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(gridleToken, "OrderAlreadyProcessed");
        });

        it("Should revert for expired deadline", async function () {
            const signId = 4;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
            
            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), amount, await gridleToken.getAddress(), deadline, 0);

            await expect(
                gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, 0, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(gridleToken, "DeadlineExpired");
        });
    });

    describe("Token Claims", function () {
        beforeEach(async function () {
            // Transfer tokens to the gridleToken contract from owner account
            await testToken.connect(owner).transfer(await gridleToken.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow valid token claim with correct signature", async function () {
            const signId = 5;
            const amount = ethers.parseEther("10");
            const recipient = user2.address;
            
            const sig = await createClaimSignature(signId, recipient, await testToken.getAddress(), amount, await gridleToken.getAddress());

            const initialBalance = await testToken.balanceOf(recipient);

            await expect(
                gridleToken.connect(user1).claimToken(signId, recipient, await testToken.getAddress(), amount, sig.v, sig.r, sig.s)
            )
                .to.emit(gridleToken, "TokenClaimed")
                .withArgs(signId, recipient, await testToken.getAddress(), amount);

            expect(await gridleToken.processedOrders(signId)).to.be.true;
            
            const finalBalance = await testToken.balanceOf(recipient);
            expect(finalBalance - initialBalance).to.equal(amount);
        });

        it("Should revert for invalid signature", async function () {
            const signId = 6;
            const amount = ethers.parseEther("10");
            
            // Create signature with wrong amount
            const wrongSig = await createClaimSignature(signId, user2.address, await testToken.getAddress(), ethers.parseEther("5"), await gridleToken.getAddress());

            await expect(
                gridleToken.connect(user1).claimToken(signId, user2.address, await testToken.getAddress(), amount, wrongSig.v, wrongSig.r, wrongSig.s)
            ).to.be.revertedWithCustomError(gridleToken, "WrongSignature");
        });

        it("Should revert for already processed order", async function () {
            const signId = 7;
            const amount = ethers.parseEther("10");
            const recipient = user2.address;
            
            const sig = await createClaimSignature(signId, recipient, await testToken.getAddress(), amount, await gridleToken.getAddress());

            // First claim should succeed
            await gridleToken.connect(user1).claimToken(signId, recipient, await testToken.getAddress(), amount, sig.v, sig.r, sig.s);

            // Second claim with same signId should fail
            await expect(
                gridleToken.connect(user1).claimToken(signId, recipient, await testToken.getAddress(), amount, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(gridleToken, "OrderAlreadyProcessed");
        });
    });

    describe("Withdraw ERC20", function () {
        beforeEach(async function () {
            // Transfer tokens to the contract from owner account
            await testToken.connect(owner).transfer(await gridleToken.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow token withdrawal with reserved amount", async function () {
            const reserved = ethers.parseEther("20");
            const expectedWithdraw = ethers.parseEther("80");

            const initialBalance = await testToken.balanceOf(withdrawRole.address);

            await gridleToken.connect(withdrawRole).withdrawERC20(await testToken.getAddress(), reserved);

            const finalBalance = await testToken.balanceOf(withdrawRole.address);
            const contractBalance = await testToken.balanceOf(await gridleToken.getAddress());

            expect(contractBalance).to.equal(reserved);
            expect(finalBalance - initialBalance).to.equal(expectedWithdraw);
        });

        it("Should emit TokenWithdrawn event on successful withdrawal", async function () {
            const reserved = ethers.parseEther("10");
            const expectedWithdraw = ethers.parseEther("90");

            await expect(
                gridleToken.connect(withdrawRole).withdrawERC20(await testToken.getAddress(), reserved)
            )
                .to.emit(gridleToken, "TokenWithdrawn")
                .withArgs(withdrawRole.address, await testToken.getAddress(), expectedWithdraw, reserved);
        });

        it("Should revert if reserved amount exceeds balance", async function () {
            const reserved = ethers.parseEther("150"); // More than contract balance

            await expect(
                gridleToken.connect(withdrawRole).withdrawERC20(await testToken.getAddress(), reserved)
            ).to.be.revertedWithCustomError(gridleToken, "InsufficientBalance");
        });

        it("Should revert if non-withdraw role tries to withdraw", async function () {
            await expect(
                gridleToken.connect(user1).withdrawERC20(await testToken.getAddress(), 0)
            ).to.be.revertedWithCustomError(gridleToken, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Refund Tokens", function () {
        beforeEach(async function () {
            // Transfer tokens to the contract from owner account
            await testToken.connect(owner).transfer(await gridleToken.getAddress(), ethers.parseEther("50"));
        });

        it("Should allow refund role to refund tokens", async function () {
            const refundAmount = ethers.parseEther("5");
            const recipient = user2.address;

            // First, user2 needs to make a deposit to be eligible for refund
            await testToken.connect(user2).approve(await gridleToken.getAddress(), ethers.parseEther("10"));
            const signId = 999;
            const depositAmount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100");

            const sig = await createDepositSignature(signId, recipient, await testToken.getAddress(), depositAmount, await gridleToken.getAddress(), deadline, systemBalance);
            await gridleToken.connect(user2).depositToken(signId, await testToken.getAddress(), depositAmount, deadline, systemBalance, sig.v, sig.r, sig.s);

            const initialBalance = await testToken.balanceOf(recipient);

            await expect(
                gridleToken.connect(refundRole).refundToken(recipient, await testToken.getAddress(), refundAmount)
            )
                .to.emit(gridleToken, "TokenRefunded")
                .withArgs(recipient, await testToken.getAddress(), refundAmount);

            const finalBalance = await testToken.balanceOf(recipient);
            expect(finalBalance - initialBalance).to.equal(refundAmount);
        });

        it("Should revert if non-refund role tries to refund tokens", async function () {
            const refundAmount = ethers.parseEther("5");

            await expect(
                gridleToken.connect(user1).refundToken(user2.address, await testToken.getAddress(), refundAmount)
            ).to.be.revertedWithCustomError(gridleToken, "AccessControlUnauthorizedAccount");
        });

        it("Should revert when refunding tokens to zero address", async function () {
            const refundAmount = ethers.parseEther("5");

            await expect(
                gridleToken.connect(refundRole).refundToken(ethers.ZeroAddress, await testToken.getAddress(), refundAmount)
            ).to.be.revertedWithCustomError(gridleToken, "ZeroAddress");
        });

        it("Should revert when contract has insufficient tokens", async function () {
            const refundAmount = ethers.parseEther("100"); // More than contract balance

            await expect(
                gridleToken.connect(refundRole).refundToken(user2.address, await testToken.getAddress(), refundAmount)
            ).to.be.reverted; // ERC20 transfer will revert
        });
    });

    describe("Reserve Coefficients", function () {
        it("Should have default reserve coefficients set", async function () {
            expect(await gridleToken.minReservesCoef()).to.equal(11000); // 110%
            expect(await gridleToken.maxReservesCoef()).to.equal(12000); // 120%
        });

        it("Should allow admin to set reserve coefficients", async function () {
            await gridleToken.connect(owner).setReserveCoefficients(11000, 15000); // 110% min, 150% max
            
            expect(await gridleToken.minReservesCoef()).to.equal(11000);
            expect(await gridleToken.maxReservesCoef()).to.equal(15000);
        });

        it("Should emit ReserveCoefficientsUpdated event", async function () {
            await expect(gridleToken.connect(owner).setReserveCoefficients(11000, 13000))
                .to.emit(gridleToken, "ReserveCoefficientsUpdated")
                .withArgs(11000, 13000);
        });

        it("Should revert if min coefficient > max coefficient", async function () {
            await expect(
                gridleToken.connect(owner).setReserveCoefficients(15000, 12000)
            ).to.be.revertedWithCustomError(gridleToken, "InvalidCoefficientOrder");
        });

        it("Should revert if min coefficient <= 100%", async function () {
            await expect(
                gridleToken.connect(owner).setReserveCoefficients(10000, 15000)
            ).to.be.revertedWithCustomError(gridleToken, "MinCoefficientTooLow");
        });

        it("Should revert if max coefficient <= 100%", async function () {
            await expect(
                gridleToken.connect(owner).setReserveCoefficients(11000, 10000)
            ).to.be.revertedWithCustomError(gridleToken, "MaxCoefficientTooLow");
        });

        it("Should revert if non-admin tries to set coefficients", async function () {
            await expect(
                gridleToken.connect(user1).setReserveCoefficients(11000, 12000)
            ).to.be.revertedWithCustomError(gridleToken, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Withdraw Address", function () {
        it("Should have default withdraw address set to admin", async function () {
            expect(await gridleToken.withdrawAddress()).to.equal(owner.address);
        });

        it("Should allow admin to set withdraw address", async function () {
            await gridleToken.connect(owner).setWithdrawAddress(user2.address);
            expect(await gridleToken.withdrawAddress()).to.equal(user2.address);
        });

        it("Should revert when setting zero address", async function () {
            await expect(
                gridleToken.connect(owner).setWithdrawAddress(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(gridleToken, "ZeroAddress");
        });

        it("Should revert if non-admin tries to set withdraw address", async function () {
            await expect(
                gridleToken.connect(user1).setWithdrawAddress(user2.address)
            ).to.be.revertedWithCustomError(gridleToken, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Minimum Reserves", function () {
        it("Should allow admin to set minimum reserves for tokens", async function () {
            const minAmount = ethers.parseEther("100");
            await gridleToken.connect(owner).setMinReserves(await testToken.getAddress(), minAmount);
            
            expect(await gridleToken.minReserves(await testToken.getAddress())).to.equal(minAmount);
        });

        it("Should emit MinReservesUpdated event", async function () {
            const minAmount = ethers.parseEther("10");
            await expect(gridleToken.connect(owner).setMinReserves(await testToken.getAddress(), minAmount))
                .to.emit(gridleToken, "MinReservesUpdated")
                .withArgs(await testToken.getAddress(), minAmount);
        });

        it("Should revert if non-admin tries to set minimum reserves", async function () {
            await expect(
                gridleToken.connect(user1).setMinReserves(await testToken.getAddress(), ethers.parseEther("5"))
            ).to.be.revertedWithCustomError(gridleToken, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Auto-withdrawal on Token Deposit", function () {
        beforeEach(async function () {
            // Set up withdraw address
            await gridleToken.connect(owner).setWithdrawAddress(withdrawRole.address);
            
            // Set reserve coefficients for testing (110% min, 120% max)
            await gridleToken.connect(owner).setReserveCoefficients(11000, 12000);
            
            // Approve gridleToken contract to spend tokens
            await testToken.connect(user1).approve(await gridleToken.getAddress(), ethers.parseEther("1000"));
        });

        it("Should trigger auto-withdrawal when token balance exceeds systemBalance + maxReserves", async function () {
            const systemBalance = ethers.parseEther("100");
            const depositAmount = ethers.parseEther("50");
            
            // First deposit to set up initial balance
            const signId1 = 101;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig1 = await createDepositSignature(signId1, user1.address, await testToken.getAddress(), depositAmount, await gridleToken.getAddress(), deadline, systemBalance);
            await gridleToken.connect(user1).depositToken(signId1, await testToken.getAddress(), depositAmount, deadline, systemBalance, sig1.v, sig1.r, sig1.s);
            
            // Second deposit that should trigger auto-withdrawal
            // systemBalance = 100, maxReservesCoef = 120% means max allowed = 120
            // Current balance = 50, adding another 80 = 130 total, should trigger withdrawal
            const signId2 = 102;
            const triggerAmount = ethers.parseEther("80");
            const sig2 = await createDepositSignature(signId2, user1.address, await testToken.getAddress(), triggerAmount, await gridleToken.getAddress(), deadline, systemBalance);
            
            const withdrawBalanceBefore = await testToken.balanceOf(withdrawRole.address);
            
            await expect(
                gridleToken.connect(user1).depositToken(signId2, await testToken.getAddress(), triggerAmount, deadline, systemBalance, sig2.v, sig2.r, sig2.s)
            ).to.emit(gridleToken, "AutoWithdrawal");
            
            const withdrawBalanceAfter = await testToken.balanceOf(withdrawRole.address);
            const contractBalance = await testToken.balanceOf(await gridleToken.getAddress());
            
            // Contract should keep 110% of systemBalance (100 * 110% = 110)
            const expectedContractBalance = (systemBalance * 11000n) / 10000n;
            expect(contractBalance).to.equal(expectedContractBalance);
            
            // Withdraw address should receive the excess
            const expectedWithdraw = depositAmount + triggerAmount - expectedContractBalance;
            expect(withdrawBalanceAfter - withdrawBalanceBefore).to.equal(expectedWithdraw);
        });

        it("Should respect absolute minimum reserves for tokens", async function () {
            // Set absolute minimum reserves higher than coefficient-based
            const absoluteMin = ethers.parseEther("30");
            await gridleToken.connect(owner).setMinReserves(await testToken.getAddress(), absoluteMin);
            
            const systemBalance = ethers.parseEther("10"); // coefficient min would be 1 token
            const depositAmount = ethers.parseEther("50");
            
            const signId = 103;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), depositAmount, await gridleToken.getAddress(), deadline, systemBalance);
            
            await expect(
                gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), depositAmount, deadline, systemBalance, sig.v, sig.r, sig.s)
            ).to.emit(gridleToken, "AutoWithdrawal");
            
            const contractBalance = await testToken.balanceOf(await gridleToken.getAddress());
            
            // Should keep systemBalance + absoluteMin (10 + 30 = 40)
            expect(contractBalance).to.equal(systemBalance + absoluteMin);
        });

        it("Should not trigger auto-withdrawal when balance is within limits", async function () {
            const systemBalance = ethers.parseEther("100");
            const depositAmount = ethers.parseEther("10"); // Won't exceed max allowed
            
            const signId = 104;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), depositAmount, await gridleToken.getAddress(), deadline, systemBalance);
            
            await expect(
                gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), depositAmount, deadline, systemBalance, sig.v, sig.r, sig.s)
            ).to.not.emit(gridleToken, "AutoWithdrawal");
            
            const contractBalance = await testToken.balanceOf(await gridleToken.getAddress());
            expect(contractBalance).to.equal(depositAmount);
        });
    });

    describe("Token Deposits with systemBalance parameter", function () {
        beforeEach(async function () {
            await testToken.connect(user1).approve(await gridleToken.getAddress(), ethers.parseEther("100"));
        });

        it("Should accept token deposit with systemBalance parameter", async function () {
            const signId = 201;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("50");
            
            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), amount, await gridleToken.getAddress(), deadline, systemBalance);

            await expect(
                gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, systemBalance, sig.v, sig.r, sig.s)
            )
                .to.emit(gridleToken, "TokenDeposited")
                .withArgs(signId, user1.address, await testToken.getAddress(), amount);

            expect(await gridleToken.processedOrders(signId)).to.be.true;
        });

        it("Should revert with wrong systemBalance in signature", async function () {
            const signId = 202;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const correctSystemBalance = ethers.parseEther("50");
            const wrongSystemBalance = ethers.parseEther("100");
            
            // Create signature with correct systemBalance
            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), amount, await gridleToken.getAddress(), deadline, correctSystemBalance);

            // Try to use with different systemBalance
            await expect(
                gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, wrongSystemBalance, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(gridleToken, "WrongSignature");
        });
    });

    describe("Deposit Tracking", function () {
        beforeEach(async function () {
            await testToken.connect(user1).approve(await gridleToken.getAddress(), ethers.parseEther("100"));
        });

        it("Should track deposit amount per account and token", async function () {
            const signId = 301;
            const amount = ethers.parseEther("20");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100");

            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), amount, await gridleToken.getAddress(), deadline, systemBalance);

            await gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, systemBalance, sig.v, sig.r, sig.s);

            expect(await gridleToken.deposits(user1.address, await testToken.getAddress())).to.equal(amount);
        });

        it("Should update deposit amount with new deposit (not cumulative)", async function () {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100");

            // First deposit
            const signId1 = 302;
            const amount1 = ethers.parseEther("20");
            const sig1 = await createDepositSignature(signId1, user1.address, await testToken.getAddress(), amount1, await gridleToken.getAddress(), deadline, systemBalance);
            await gridleToken.connect(user1).depositToken(signId1, await testToken.getAddress(), amount1, deadline, systemBalance, sig1.v, sig1.r, sig1.s);

            expect(await gridleToken.deposits(user1.address, await testToken.getAddress())).to.equal(amount1);

            // Second deposit should replace, not add
            const signId2 = 303;
            const amount2 = ethers.parseEther("30");
            const sig2 = await createDepositSignature(signId2, user1.address, await testToken.getAddress(), amount2, await gridleToken.getAddress(), deadline, systemBalance);
            await gridleToken.connect(user1).depositToken(signId2, await testToken.getAddress(), amount2, deadline, systemBalance, sig2.v, sig2.r, sig2.s);

            expect(await gridleToken.deposits(user1.address, await testToken.getAddress())).to.equal(amount2);
        });
    });

    describe("Refund with Deposit Validation", function () {
        beforeEach(async function () {
            await testToken.connect(user1).approve(await gridleToken.getAddress(), ethers.parseEther("100"));
            
            // User1 deposits 50 tokens
            const signId = 400;
            const amount = ethers.parseEther("50");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100");

            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), amount, await gridleToken.getAddress(), deadline, systemBalance);
            await gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, systemBalance, sig.v, sig.r, sig.s);
        });

        it("Should allow refund less than deposit amount", async function () {
            const refundAmount = ethers.parseEther("20");

            await expect(
                gridleToken.connect(refundRole).refundToken(user1.address, await testToken.getAddress(), refundAmount)
            )
                .to.emit(gridleToken, "TokenRefunded")
                .withArgs(user1.address, await testToken.getAddress(), refundAmount);

            // Check deposit was reset to 0
            expect(await gridleToken.deposits(user1.address, await testToken.getAddress())).to.equal(0);
        });

        it("Should allow refund equal to deposit amount", async function () {
            const refundAmount = ethers.parseEther("50");

            await expect(
                gridleToken.connect(refundRole).refundToken(user1.address, await testToken.getAddress(), refundAmount)
            )
                .to.emit(gridleToken, "TokenRefunded")
                .withArgs(user1.address, await testToken.getAddress(), refundAmount);

            // Check deposit was cleared
            expect(await gridleToken.deposits(user1.address, await testToken.getAddress())).to.equal(0);
        });

        it("Should revert when refund exceeds deposit amount", async function () {
            const refundAmount = ethers.parseEther("60"); // More than deposited

            await expect(
                gridleToken.connect(refundRole).refundToken(user1.address, await testToken.getAddress(), refundAmount)
            ).to.be.revertedWithCustomError(gridleToken, "InvalidRefundAmount");
        });

        it("Should revert when refunding to user with no deposit", async function () {
            await expect(
                gridleToken.connect(refundRole).refundToken(user2.address, await testToken.getAddress(), ethers.parseEther("10"))
            ).to.be.revertedWithCustomError(gridleToken, "InvalidRefundAmount");
        });
    });

    describe("Claim with Deposit Clearing", function () {
        beforeEach(async function () {
            await testToken.connect(user1).approve(await gridleToken.getAddress(), ethers.parseEther("100"));
            
            // User1 deposits 20 tokens
            const signId = 500;
            const amount = ethers.parseEther("20");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100");

            const sig = await createDepositSignature(signId, user1.address, await testToken.getAddress(), amount, await gridleToken.getAddress(), deadline, systemBalance);
            await gridleToken.connect(user1).depositToken(signId, await testToken.getAddress(), amount, deadline, systemBalance, sig.v, sig.r, sig.s);
        });

        it("Should clear deposit record when claiming", async function () {
            expect(await gridleToken.deposits(user1.address, await testToken.getAddress())).to.equal(ethers.parseEther("20"));

            const signId = 501;
            const claimAmount = ethers.parseEther("10");
            const sig = await createClaimSignature(signId, user1.address, await testToken.getAddress(), claimAmount, await gridleToken.getAddress());

            await gridleToken.claimToken(signId, user1.address, await testToken.getAddress(), claimAmount, sig.v, sig.r, sig.s);

            // Deposit should be cleared after claim
            expect(await gridleToken.deposits(user1.address, await testToken.getAddress())).to.equal(0);
        });
    });

    describe("LastSignId Tracking and Auto-withdrawal", function () {
        beforeEach(async function () {
            // Set up withdraw address
            await gridleToken.connect(owner).setWithdrawAddress(withdrawRole.address);
            
            // Set reserve coefficients for testing (110% min, 120% max)
            await gridleToken.connect(owner).setReserveCoefficients(11000, 12000);
            
            await testToken.connect(user1).approve(await gridleToken.getAddress(), ethers.parseEther("1000"));
            await testToken.connect(user2).approve(await gridleToken.getAddress(), ethers.parseEther("1000"));
        });

        it("Should track lastSignId per token correctly", async function () {
            const tokenAddress = await testToken.getAddress();
            
            // Check initial lastSignId is 0
            expect(await gridleToken.lastSignId(tokenAddress)).to.equal(0);

            // First deposit with signId = 5
            const signId1 = 5;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const systemBalance = ethers.parseEther("100");

            const sig1 = await createDepositSignature(signId1, user1.address, tokenAddress, amount, await gridleToken.getAddress(), deadline, systemBalance);
            await gridleToken.connect(user1).depositToken(signId1, tokenAddress, amount, deadline, systemBalance, sig1.v, sig1.r, sig1.s);

            // Check lastSignId updated to 5
            expect(await gridleToken.lastSignId(tokenAddress)).to.equal(5);

            // Second deposit with higher signId = 10
            const signId2 = 10;
            const sig2 = await createDepositSignature(signId2, user1.address, tokenAddress, amount, await gridleToken.getAddress(), deadline, systemBalance);
            await gridleToken.connect(user1).depositToken(signId2, tokenAddress, amount, deadline, systemBalance, sig2.v, sig2.r, sig2.s);

            // Check lastSignId updated to 10
            expect(await gridleToken.lastSignId(tokenAddress)).to.equal(10);
        });

        it("Should only trigger auto-withdrawal for newer signIds", async function () {
            const tokenAddress = await testToken.getAddress();
            const systemBalance = ethers.parseEther("100");
            const depositAmount = ethers.parseEther("150"); // This amount should trigger auto-withdrawal
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            // First deposit with signId = 5 (should trigger auto-withdrawal)
            const signId1 = 5;
            const sig1 = await createDepositSignature(signId1, user1.address, tokenAddress, depositAmount, await gridleToken.getAddress(), deadline, systemBalance);
            
            await expect(
                gridleToken.connect(user1).depositToken(signId1, tokenAddress, depositAmount, deadline, systemBalance, sig1.v, sig1.r, sig1.s)
            ).to.emit(gridleToken, "AutoWithdrawal");

            expect(await gridleToken.lastSignId(tokenAddress)).to.equal(5);

            // Second deposit with lower signId = 3 (should NOT trigger auto-withdrawal even with high amount)
            const signId2 = 3;
            const sig2 = await createDepositSignature(signId2, user2.address, tokenAddress, depositAmount, await gridleToken.getAddress(), deadline, systemBalance);
            
            await expect(
                gridleToken.connect(user2).depositToken(signId2, tokenAddress, depositAmount, deadline, systemBalance, sig2.v, sig2.r, sig2.s)
            ).to.not.emit(gridleToken, "AutoWithdrawal");

            // lastSignId should remain 5
            expect(await gridleToken.lastSignId(tokenAddress)).to.equal(5);
        });
    });

    describe("Topup Functionality", function () {
        beforeEach(async function () {
            await testToken.connect(user1).approve(await gridleToken.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow users to topup the contract with tokens", async function () {
            const topupAmount = ethers.parseEther("25");
            const initialContractBalance = await testToken.balanceOf(await gridleToken.getAddress());
            const initialUserBalance = await testToken.balanceOf(user1.address);

            await expect(
                gridleToken.connect(user1).topup(await testToken.getAddress(), topupAmount)
            )
                .to.emit(gridleToken, "Topup")
                .withArgs(user1.address, await testToken.getAddress(), topupAmount);

            const finalContractBalance = await testToken.balanceOf(await gridleToken.getAddress());
            const finalUserBalance = await testToken.balanceOf(user1.address);

            expect(finalContractBalance - initialContractBalance).to.equal(topupAmount);
            expect(initialUserBalance - finalUserBalance).to.equal(topupAmount);
        });

        it("Should revert if user has insufficient token balance for topup", async function () {
            const excessiveAmount = ethers.parseEther("2000"); // More than user1 has

            await expect(
                gridleToken.connect(user1).topup(await testToken.getAddress(), excessiveAmount)
            ).to.be.reverted; // ERC20 transfer will revert due to insufficient balance
        });

        it("Should revert if user has not approved sufficient tokens for topup", async function () {
            const topupAmount = ethers.parseEther("150"); // More than approved (100)

            await expect(
                gridleToken.connect(user1).topup(await testToken.getAddress(), topupAmount)
            ).to.be.reverted; // ERC20 transferFrom will revert due to insufficient allowance
        });

        it("Should allow multiple topups from different users", async function () {
            // Setup approvals for both users
            await testToken.connect(user2).approve(await gridleToken.getAddress(), ethers.parseEther("50"));

            const topupAmount1 = ethers.parseEther("20");
            const topupAmount2 = ethers.parseEther("30");
            
            const initialContractBalance = await testToken.balanceOf(await gridleToken.getAddress());

            // First topup from user1
            await expect(
                gridleToken.connect(user1).topup(await testToken.getAddress(), topupAmount1)
            ).to.emit(gridleToken, "Topup");

            // Second topup from user2
            await expect(
                gridleToken.connect(user2).topup(await testToken.getAddress(), topupAmount2)
            ).to.emit(gridleToken, "Topup");

            const finalContractBalance = await testToken.balanceOf(await gridleToken.getAddress());
            const totalTopup = topupAmount1 + topupAmount2;

            expect(finalContractBalance - initialContractBalance).to.equal(totalTopup);
        });
    });
});