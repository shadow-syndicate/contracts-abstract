const {expect} = require("chai");
const {ethers} = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("Grid", function () {
    let grid, testToken, owner, withdrawRole, refundRole, signer, user1, user2;
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
        await grid.grantRole(grid.WITHDRAW_ROLE(), withdrawRole.address);
        
        // Grant refund role
        await grid.grantRole(grid.REFUND_ROLE(), refundRole.address);

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

    // Helper function to create signatures for deposit operations (with deadline)
    async function createDepositSignature(orderId, account, value, contractAddress, deadline, token = null) {
        let messageHash;
        if (token) {
            messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "address", "address", "uint256", "uint256", "address"],
                    [orderId, account, token, value, deadline, contractAddress]
                )
            );
        } else {
            messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "address", "uint256", "uint256", "address"],
                    [orderId, account, value, deadline, contractAddress]
                )
            );
        }
        return signMessageHash(messageHash);
    }

    // Helper function to create signatures for claim operations (without deadline)
    async function createClaimSignature(orderId, account, value, contractAddress, token = null) {
        let messageHash;
        if (token) {
            messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "address", "address", "uint256", "address"],
                    [orderId, account, token, value, contractAddress]
                )
            );
        } else {
            messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "address", "uint256", "address"],
                    [orderId, account, value, contractAddress]
                )
            );
        }
        return signMessageHash(messageHash);
    }

    describe("Deployment", function () {
        it("Should set the correct signer address", async function () {
            const testSigner = new ethers.Wallet(signerPrivateKey);
            expect(await grid.signerAddress()).to.equal(testSigner.address);
        });

        it("Should grant DEFAULT_ADMIN_ROLE and WITHDRAW_ROLE to owner", async function () {
            expect(await grid.hasRole(grid.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await grid.hasRole(grid.WITHDRAW_ROLE(), owner.address)).to.be.true;
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
            const orderId = 1;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            
            const sig = await createDepositSignature(orderId, user1.address, value, await grid.getAddress(), deadline);

            await expect(
                grid.connect(user1).depositEth(orderId, deadline, sig.v, sig.r, sig.s, { value })
            )
                .to.emit(grid, "EthDeposited")
                .withArgs(orderId, user1.address, value);

            expect(await grid.processedOrders(orderId)).to.be.true;
            expect(await ethers.provider.getBalance(await grid.getAddress())).to.equal(value);
        });

        it("Should revert for invalid signature", async function () {
            const orderId = 1;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Create signature with wrong signer
            const wrongSig = await createDepositSignature(orderId, user2.address, value, await grid.getAddress(), deadline);

            await expect(
                grid.connect(user1).depositEth(orderId, deadline, wrongSig.v, wrongSig.r, wrongSig.s, { value })
            ).to.be.revertedWithCustomError(grid, "WrongSignature");
        });

        it("Should revert for already processed order", async function () {
            const orderId = 1;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            const sig = await createDepositSignature(orderId, user1.address, value, await grid.getAddress(), deadline);

            // First deposit should succeed
            await grid.connect(user1).depositEth(orderId, deadline, sig.v, sig.r, sig.s, { value });

            // Second deposit with same orderId should fail
            await expect(
                grid.connect(user1).depositEth(orderId, deadline, sig.v, sig.r, sig.s, { value })
            ).to.be.revertedWithCustomError(grid, "OrderAlreadyProcessed");
        });

        it("Should revert for expired deadline", async function () {
            const orderId = 2;
            const value = ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
            
            const sig = await createDepositSignature(orderId, user1.address, value, await grid.getAddress(), deadline);

            await expect(
                grid.connect(user1).depositEth(orderId, deadline, sig.v, sig.r, sig.s, { value })
            ).to.be.revertedWithCustomError(grid, "DeadlineExpired");
        });
    });

    describe("ETH Claims", function () {
        beforeEach(async function () {
            // Add some ETH to the contract using deposit function
            const orderId = 999; // Use a unique order ID for setup
            const value = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(orderId, user1.address, value, await grid.getAddress(), deadline);
            await grid.connect(user1).depositEth(orderId, deadline, sig.v, sig.r, sig.s, { value });
        });

        it("Should allow valid ETH claim with correct signature", async function () {
            const orderId = 2;
            const value = ethers.parseEther("1");
            const recipient = user2.address;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            const sig = await createClaimSignature(orderId, recipient, value, await grid.getAddress());

            const initialBalance = await ethers.provider.getBalance(recipient);

            await expect(
                grid.connect(user1).claimEth(orderId, recipient, value, sig.v, sig.r, sig.s)
            )
                .to.emit(grid, "EthClaimed")
                .withArgs(orderId, recipient, value);

            expect(await grid.processedOrders(orderId)).to.be.true;
            
            const finalBalance = await ethers.provider.getBalance(recipient);
            expect(finalBalance - initialBalance).to.equal(value);
        });

        it("Should revert for invalid signature", async function () {
            const orderId = 2;
            const value = ethers.parseEther("1");
            
            // Create signature with wrong recipient
            const wrongSig = await createClaimSignature(orderId, user1.address, value, await grid.getAddress());

            await expect(
                grid.connect(user1).claimEth(orderId, user2.address, value, wrongSig.v, wrongSig.r, wrongSig.s)
            ).to.be.revertedWithCustomError(grid, "WrongSignature");
        });

        it("Should revert for already processed order", async function () {
            const orderId = 2;
            const value = ethers.parseEther("1");
            const recipient = user2.address;
            
            const sig = await createClaimSignature(orderId, recipient, value, await grid.getAddress());

            // First claim should succeed
            await grid.connect(user1).claimEth(orderId, recipient, value, sig.v, sig.r, sig.s);

            // Second claim with same orderId should fail
            await expect(
                grid.connect(user1).claimEth(orderId, recipient, value, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(grid, "OrderAlreadyProcessed");
        });
    });

    describe("ERC20 Token Deposits", function () {
        beforeEach(async function () {
            // Approve grid contract to spend tokens
            await testToken.connect(user1).approve(await grid.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow valid token deposit with correct signature", async function () {
            const orderId = 3;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            const sig = await createDepositSignature(orderId, user1.address, amount, await grid.getAddress(), deadline, await testToken.getAddress());

            await expect(
                grid.connect(user1).depositToken(orderId, await testToken.getAddress(), amount, deadline, sig.v, sig.r, sig.s)
            )
                .to.emit(grid, "TokenDeposited")
                .withArgs(orderId, user1.address, await testToken.getAddress(), amount);

            expect(await grid.processedOrders(orderId)).to.be.true;
            expect(await testToken.balanceOf(await grid.getAddress())).to.equal(amount);
        });

        it("Should revert for invalid signature", async function () {
            const orderId = 3;
            const amount = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            
            // Create signature with wrong token address
            const wrongSig = await createDepositSignature(orderId, user1.address, amount, await grid.getAddress(), deadline, user2.address);

            await expect(
                grid.connect(user1).depositToken(orderId, await testToken.getAddress(), amount, deadline, wrongSig.v, wrongSig.r, wrongSig.s)
            ).to.be.revertedWithCustomError(grid, "WrongSignature");
        });
    });

    describe("ERC20 Token Claims", function () {
        beforeEach(async function () {
            // Transfer tokens to the grid contract from owner account
            await testToken.connect(owner).transfer(await grid.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow valid token claim with correct signature", async function () {
            const orderId = 4;
            const amount = ethers.parseEther("10");
            const recipient = user2.address;
            
            const sig = await createClaimSignature(orderId, recipient, amount, await grid.getAddress(), await testToken.getAddress());

            const initialBalance = await testToken.balanceOf(recipient);

            await expect(
                grid.connect(user1).claimToken(orderId, recipient, await testToken.getAddress(), amount, sig.v, sig.r, sig.s)
            )
                .to.emit(grid, "TokenClaimed")
                .withArgs(orderId, recipient, await testToken.getAddress(), amount);

            expect(await grid.processedOrders(orderId)).to.be.true;
            
            const finalBalance = await testToken.balanceOf(recipient);
            expect(finalBalance - initialBalance).to.equal(amount);
        });

        it("Should revert for invalid signature", async function () {
            const orderId = 4;
            const amount = ethers.parseEther("10");
            
            // Create signature with wrong amount
            const wrongSig = await createClaimSignature(orderId, user2.address, ethers.parseEther("5"), await grid.getAddress(), await testToken.getAddress());

            await expect(
                grid.connect(user1).claimToken(orderId, user2.address, await testToken.getAddress(), amount, wrongSig.v, wrongSig.r, wrongSig.s)
            ).to.be.revertedWithCustomError(grid, "WrongSignature");
        });
    });

    describe("Withdraw ETH", function () {
        beforeEach(async function () {
            // Add ETH to the contract using deposit function
            const orderId = 998; // Use a unique order ID for setup
            const value = ethers.parseEther("10");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(orderId, user1.address, value, await grid.getAddress(), deadline);
            await grid.connect(user1).depositEth(orderId, deadline, sig.v, sig.r, sig.s, { value });
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

    describe("Withdraw ERC20", function () {
        beforeEach(async function () {
            // Transfer tokens to the contract from owner account
            await testToken.connect(owner).transfer(await grid.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow token withdrawal with reserved amount", async function () {
            const reserved = ethers.parseEther("20");
            const expectedWithdraw = ethers.parseEther("80");

            const initialBalance = await testToken.balanceOf(withdrawRole.address);

            await grid.connect(withdrawRole).withdrawERC20(await testToken.getAddress(), reserved);

            const finalBalance = await testToken.balanceOf(withdrawRole.address);
            const contractBalance = await testToken.balanceOf(await grid.getAddress());

            expect(contractBalance).to.equal(reserved);
            expect(finalBalance - initialBalance).to.equal(expectedWithdraw);
        });

        it("Should revert if reserved amount exceeds balance", async function () {
            const reserved = ethers.parseEther("150"); // More than contract balance

            await expect(
                grid.connect(withdrawRole).withdrawERC20(await testToken.getAddress(), reserved)
            ).to.be.revertedWithCustomError(grid, "InsufficientBalance");
        });

        it("Should revert if non-withdraw role tries to withdraw", async function () {
            await expect(
                grid.connect(user1).withdrawERC20(await testToken.getAddress(), 0)
            ).to.be.revertedWithCustomError(grid, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Refund ETH", function () {
        beforeEach(async function () {
            // Add ETH to the contract using deposit function
            const orderId = 997; // Use a unique order ID for setup
            const value = ethers.parseEther("5");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const sig = await createDepositSignature(orderId, user1.address, value, await grid.getAddress(), deadline);
            await grid.connect(user1).depositEth(orderId, deadline, sig.v, sig.r, sig.s, { value });
        });

        it("Should allow refund role to refund ETH", async function () {
            const refundAmount = ethers.parseEther("1");
            const recipient = user2.address;

            const initialBalance = await ethers.provider.getBalance(recipient);

            await grid.connect(refundRole).refundEth(recipient, refundAmount);

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
            const refundAmount = ethers.parseEther("10"); // More than contract balance

            await expect(
                grid.connect(refundRole).refundEth(user2.address, refundAmount)
            ).to.be.revertedWithCustomError(grid, "EthTransferFailed");
        });
    });

    describe("Refund Tokens", function () {
        beforeEach(async function () {
            // Transfer tokens to the contract from owner account
            await testToken.connect(owner).transfer(await grid.getAddress(), ethers.parseEther("50"));
        });

        it("Should allow refund role to refund tokens", async function () {
            const refundAmount = ethers.parseEther("5");
            const recipient = user2.address;

            const initialBalance = await testToken.balanceOf(recipient);

            await grid.connect(refundRole).refundToken(recipient, await testToken.getAddress(), refundAmount);

            const finalBalance = await testToken.balanceOf(recipient);
            expect(finalBalance - initialBalance).to.equal(refundAmount);
        });

        it("Should revert if non-refund role tries to refund tokens", async function () {
            const refundAmount = ethers.parseEther("5");

            await expect(
                grid.connect(user1).refundToken(user2.address, await testToken.getAddress(), refundAmount)
            ).to.be.revertedWithCustomError(grid, "AccessControlUnauthorizedAccount");
        });

        it("Should revert when refunding tokens to zero address", async function () {
            const refundAmount = ethers.parseEther("5");

            await expect(
                grid.connect(refundRole).refundToken(ethers.ZeroAddress, await testToken.getAddress(), refundAmount)
            ).to.be.revertedWithCustomError(grid, "ZeroAddress");
        });

        it("Should revert when contract has insufficient tokens", async function () {
            const refundAmount = ethers.parseEther("100"); // More than contract balance

            await expect(
                grid.connect(refundRole).refundToken(user2.address, await testToken.getAddress(), refundAmount)
            ).to.be.reverted; // ERC20 transfer will revert
        });
    });
});