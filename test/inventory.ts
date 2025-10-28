const {expect} = require("chai");
const {ethers} = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("Inventory", function () {
    let inventory, owner, minter, burner, banRole, withdrawRole, signer, user1, user2;

    beforeEach(async function () {
        [owner, withdrawRole, signer, minter, burner, banRole, user1, user2] = await ethers.getSigners();

        // Deploy implementation
        const Inventory = await ethers.getContractFactory("Inventory");
        const implementation = await Inventory.deploy();

        // Encode initialize function call
        const initData = implementation.interface.encodeFunctionData("initialize", [
            owner.address,
            signer.address,
            "https://example.com/metadata/"
        ]);

        // Deploy proxy
        const InventoryProxy = await ethers.getContractFactory("InventoryProxy");
        const proxy = await InventoryProxy.deploy(await implementation.getAddress(), initData);

        // Get contract interface at proxy address
        inventory = implementation.attach(await proxy.getAddress());

        await inventory.grantRole(await inventory.WITHDRAW_ROLE(), withdrawRole.address);
        await inventory.grantRole(await inventory.MINTER_ROLE(), minter.address);
        await inventory.grantRole(await inventory.BURNER_ROLE(), burner.address);
        await inventory.grantRole(await inventory.BAN_ROLE(), banRole.address);
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await inventory.hasRole(await inventory.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
        });

        it("Should set the right signer", async function () {
            expect(await inventory.signerAddress()).to.equal(signer.address);
        });
    });

    describe("Minting", function () {
        it("Should mint tokens to user", async function () {
            await inventory.connect(minter).mint(user1.address, 1, 5, "0x");
            expect(await inventory.balanceOf(user1.address, 1)).to.equal(5);
        });

        it("Should mint batch tokens", async function () {
            await inventory.connect(minter).mintBatch(user1.address, [1, 2], [5, 3], "0x");
            expect(await inventory.balanceOf(user1.address, 1)).to.equal(5);
            expect(await inventory.balanceOf(user1.address, 2)).to.equal(3);
        });

        it("Should only allow minter role to mint", async function () {
            await expect(
                inventory.connect(user1).mint(user1.address, 1, 5, "0x")
            ).to.be.reverted;
        });
    });

    describe("Transfer Controls", function () {
        beforeEach(async function () {
            await inventory.connect(minter).mint(user1.address, 1, 5, "0x");
            await inventory.connect(minter).mint(user1.address, 2, 3, "0x");
            await inventory.connect(minter).mint(user1.address, 10, 1, "0x");
        });

        it("Should allow transfers by default", async function () {
            await inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 2, "0x");
            expect(await inventory.balanceOf(user1.address, 1)).to.equal(3);
            expect(await inventory.balanceOf(user2.address, 1)).to.equal(2);
        });

        it("Should disable transfers for specific IDs", async function () {
            await inventory.connect(owner).disableTransfer([1, 2]);
            
            await expect(
                inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "TransfersNotAllowed");
            
            await expect(
                inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 2, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "TransfersNotAllowed");
            
            // Should still allow transfers for non-disabled IDs
            await inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 10, 1, "0x");
            expect(await inventory.balanceOf(user2.address, 10)).to.equal(1);
        });

        it("Should re-enable transfers", async function () {
            await inventory.connect(owner).disableTransfer([1]);
            await expect(
                inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "TransfersNotAllowed");
            
            await inventory.connect(owner).enableTransfer([1]);
            await inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 1, "0x");
            expect(await inventory.balanceOf(user2.address, 1)).to.equal(1);
        });

        it("Should emit Locked/Unlocked events", async function () {
            await expect(inventory.connect(owner).disableTransfer([1, 2]))
                .to.emit(inventory, "Locked").withArgs(1)
                .and.to.emit(inventory, "Locked").withArgs(2);
            
            await expect(inventory.connect(owner).enableTransfer([1, 2]))
                .to.emit(inventory, "Unlocked").withArgs(1)
                .and.to.emit(inventory, "Unlocked").withArgs(2);
        });
    });

    describe("Range Transfer Controls", function () {
        beforeEach(async function () {
            // Mint tokens with IDs 1-15
            const ids = Array.from({length: 15}, (_, i) => i + 1);
            const amounts = Array(15).fill(1);
            await inventory.connect(minter).mintBatch(user1.address, ids, amounts, "0x");
        });

        it("Should disable transfers for ID range", async function () {
            await inventory.connect(owner).disableTransferRange(5, 10);
            
            // Should allow transfers for IDs outside range
            await inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 1, "0x");
            await inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 15, 1, "0x");
            
            // Should block transfers for IDs in range
            for (let id = 5; id <= 10; id++) {
                await expect(
                    inventory.connect(user1).safeTransferFrom(user1.address, user2.address, id, 1, "0x")
                ).to.be.revertedWithCustomError(inventory, "TransfersNotAllowed");
            }
        });

        it("Should enable transfers for ID range", async function () {
            await inventory.connect(owner).disableTransferRange(5, 10);
            await inventory.connect(owner).enableTransferRange(5, 10);
            
            // Should now allow transfers for previously disabled range
            await inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 7, 1, "0x");
            expect(await inventory.balanceOf(user2.address, 7)).to.equal(1);
        });

        it("Should emit events for range operations", async function () {
            const tx1 = await inventory.connect(owner).disableTransferRange(3, 5);
            const receipt1 = await tx1.wait();
            
            // Check that Locked events were emitted for each ID in range
            const lockedEvents = receipt1.logs.filter(log => 
                log.topics[0] === inventory.interface.getEvent("Locked").topicHash
            );
            expect(lockedEvents).to.have.length(3);
            
            const tx2 = await inventory.connect(owner).enableTransferRange(3, 5);
            const receipt2 = await tx2.wait();
            
            // Check that Unlocked events were emitted for each ID in range
            const unlockedEvents = receipt2.logs.filter(log => 
                log.topics[0] === inventory.interface.getEvent("Unlocked").topicHash
            );
            expect(unlockedEvents).to.have.length(3);
        });
    });

    describe("Banning", function () {
        beforeEach(async function () {
            await inventory.connect(minter).mint(user1.address, 1, 5, "0x");
        });

        it("Should ban accounts", async function () {
            await inventory.connect(banRole).ban(user1.address);
            expect(await inventory.banned(user1.address)).to.be.true;
        });

        it("Should prevent banned accounts from receiving tokens", async function () {
            await inventory.connect(banRole).ban(user2.address);
            await expect(
                inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "AccountBanned");
        });

        it("Should prevent banned accounts from sending tokens", async function () {
            await inventory.connect(banRole).ban(user1.address);
            await expect(
                inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "AccountBanned");
        });

        it("Should unban accounts", async function () {
            await inventory.connect(banRole).ban(user1.address);
            await inventory.connect(banRole).unban(user1.address);
            expect(await inventory.banned(user1.address)).to.be.false;
            
            await inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 1, 1, "0x");
            expect(await inventory.balanceOf(user2.address, 1)).to.equal(1);
        });

        it("Should emit ban/unban events", async function () {
            await expect(inventory.connect(banRole).ban(user1.address))
                .to.emit(inventory, "Banned").withArgs(user1.address);
            
            await expect(inventory.connect(banRole).unban(user1.address))
                .to.emit(inventory, "Unbanned").withArgs(user1.address);
        });
    });

    describe("Signature-based Claims", function () {
        let signerPrivateKey;

        beforeEach(async function () {
            // Use a known private key for consistent signature generation
            signerPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
            const testSigner = new ethers.Wallet(signerPrivateKey);
            
            // Update signer to use test signer
            await inventory.connect(owner).setSigner(testSigner.address);
        });

        function createClaimSignature(signId, account, id, amount, fee, deadline, data, contractAddress) {
            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "address", "uint256", "uint256", "uint256", "uint256", "bytes", "address", "string"],
                    [signId, account, id, amount, fee, deadline, data, contractAddress, "claim"]
                )
            );

            const signingKey = new ethers.SigningKey(signerPrivateKey);
            const signature = signingKey.sign(messageHash);

            return {
                v: signature.v,
                r: signature.r,
                s: signature.s
            };
        }

        it("Should allow valid claims with signature", async function () {
            const signId = 1;
            const id = 10;
            const amount = 5;
            const fee = ethers.parseEther("0.01");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600; // 1 hour from now
            const data = "0x1234";

            const sig = createClaimSignature(signId, user1.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await expect(
                inventory.connect(user1).claim(
                    signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                    {value: fee}
                )
            )
                .to.emit(inventory, "Claimed")
                .withArgs(signId, user1.address, id, amount, data);

            expect(await inventory.balanceOf(user1.address, id)).to.equal(amount);
            expect(await inventory.usedSignId(signId)).to.be.true;
        });

        it("Should reject claims with insufficient fee", async function () {
            const signId = 2;
            const id = 10;
            const amount = 5;
            const fee = ethers.parseEther("0.01");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600;
            const data = "0x1234";

            const sig = createClaimSignature(signId, user1.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await expect(
                inventory.connect(user1).claim(
                    signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                    {value: ethers.parseEther("0.005")}
                )
            ).to.be.revertedWithCustomError(inventory, "NotEnoughFee");
        });

        it("Should reject claims with wrong signature", async function () {
            const signId = 3;
            const id = 10;
            const amount = 5;
            const fee = ethers.parseEther("0.01");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600;
            const data = "0x1234";

            // Create signature for different parameters
            const wrongSig = createClaimSignature(signId, user2.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await expect(
                inventory.connect(user1).claim(
                    signId, id, amount, fee, deadline, wrongSig.v, wrongSig.r, wrongSig.s, data,
                    {value: fee}
                )
            ).to.be.revertedWithCustomError(inventory, "WrongSignature");
        });

        it("Should reject reused signature IDs", async function () {
            const signId = 4;
            const id = 10;
            const amount = 5;
            const fee = ethers.parseEther("0.01");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600;
            const data = "0x1234";

            const sig = createClaimSignature(signId, user1.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await inventory.connect(user1).claim(
                signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                {value: fee}
            );

            await expect(
                inventory.connect(user1).claim(
                    signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                    {value: fee}
                )
            ).to.be.revertedWithCustomError(inventory, "SignAlreadyUsed");
        });

        it("Should emit Claimed event on successful claim", async function () {
            const signId = 5;
            const id = 15;
            const amount = 3;
            const fee = ethers.parseEther("0.005");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600;
            const data = "0x5678";

            const sig = createClaimSignature(signId, user1.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await expect(
                inventory.connect(user1).claim(
                    signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                    {value: fee}
                )
            )
                .to.emit(inventory, "Claimed")
                .withArgs(signId, user1.address, id, amount, data);
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to set new signer", async function () {
            await inventory.connect(owner).setSigner(user1.address);
            expect(await inventory.signerAddress()).to.equal(user1.address);
        });

        it("Should allow admin to set URI", async function () {
            await inventory.connect(owner).setURI("https://newuri.com/");
        });

        it("Should allow pausing", async function () {
            await inventory.connect(owner).pause();
            
            await expect(
                inventory.connect(minter).mint(user1.address, 1, 5, "0x")
            ).to.be.reverted;
        });

        it("Should allow unpausing", async function () {
            await inventory.connect(owner).pause();
            await inventory.connect(owner).unpause();
            
            await inventory.connect(minter).mint(user1.address, 1, 5, "0x");
            expect(await inventory.balanceOf(user1.address, 1)).to.equal(5);
        });
    });

    describe("Burning", function () {
        beforeEach(async function () {
            await inventory.connect(minter).mint(user1.address, 1, 10, "0x");
        });

        it("Should allow users to burn their own tokens", async function () {
            await inventory.connect(user1).burn(user1.address, 1, 5);
            expect(await inventory.balanceOf(user1.address, 1)).to.equal(5);
        });

        it("Should allow admin burning via burnAdmin", async function () {
            await inventory.connect(burner).burnAdmin(user1.address, 1, 3, "0x");
            expect(await inventory.balanceOf(user1.address, 1)).to.equal(7);
        });

        it("Should emit ItemUsed event on admin burn", async function () {
            await expect(inventory.connect(burner).burnAdmin(user1.address, 1, 3, "0x"))
                .to.emit(inventory, "ItemUsed")
                .withArgs(user1.address, 1, 3, "0x");
        });
    });

    describe("Signature-based Use Function", function () {
        let signerPrivateKey;

        beforeEach(async function () {
            // Use a known private key for consistent signature generation
            signerPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
            const testSigner = new ethers.Wallet(signerPrivateKey);
            
            // Update signer to use test signer
            await inventory.connect(owner).setSigner(testSigner.address);
            
            // Mint tokens for testing
            await inventory.connect(minter).mint(user1.address, 1, 10, "0x");
        });

        function createUseSignature(signId, account, id, amount, fee, deadline, data, contractAddress) {
            const messageHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "address", "uint256", "uint256", "uint256", "uint256", "bytes", "address", "string"],
                    [signId, account, id, amount, fee, deadline, data, contractAddress, "use"]
                )
            );
            
            const signingKey = new ethers.SigningKey(signerPrivateKey);
            const signature = signingKey.sign(messageHash);
            
            return {
                v: signature.v,
                r: signature.r,
                s: signature.s
            };
        }

        it("Should allow valid use with signature and deadline", async function () {
            const signId = 1;
            const id = 1;
            const amount = 3;
            const fee = ethers.parseEther("0.01");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600; // 1 hour from current block time
            const data = "0x1234";

            const sig = createUseSignature(signId, user1.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await expect(
                inventory.connect(user1).use(
                    signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                    {value: fee}
                )
            )
                .to.emit(inventory, "SignUsed")
                .withArgs(signId, user1.address, id, amount, data)
                .and.to.emit(inventory, "ItemUsed")
                .withArgs(user1.address, id, amount, data);

            expect(await inventory.balanceOf(user1.address, id)).to.equal(7);
            expect(await inventory.usedSignId(signId)).to.be.true;
        });

        it("Should reject use with insufficient fee", async function () {
            const signId = 2;
            const id = 1;
            const amount = 3;
            const fee = ethers.parseEther("0.01");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600;
            const data = "0x1234";

            const sig = createUseSignature(signId, user1.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await expect(
                inventory.connect(user1).use(
                    signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                    {value: ethers.parseEther("0.005")} // Less than required fee
                )
            ).to.be.revertedWithCustomError(inventory, "NotEnoughFee");
        });

        it("Should reject use with expired deadline", async function () {
            const signId = 3;
            const id = 1;
            const amount = 3;
            const fee = ethers.parseEther("0.01");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp - 3600; // 1 hour ago (expired)
            const data = "0x1234";

            const sig = createUseSignature(signId, user1.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await expect(
                inventory.connect(user1).use(
                    signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                    {value: fee}
                )
            ).to.be.revertedWithCustomError(inventory, "DeadlineExceeded");
        });

        it("Should reject use with wrong signature", async function () {
            const signId = 4;
            const id = 1;
            const amount = 3;
            const fee = ethers.parseEther("0.01");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600;
            const data = "0x1234";

            // Create signature for different parameters
            const wrongSig = createUseSignature(signId, user2.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await expect(
                inventory.connect(user1).use(
                    signId, id, amount, fee, deadline, wrongSig.v, wrongSig.r, wrongSig.s, data,
                    {value: fee}
                )
            ).to.be.revertedWithCustomError(inventory, "WrongSignature");
        });

        it("Should reject reused signature ID for use", async function () {
            const signId = 5;
            const id = 1;
            const amount = 3;
            const fee = ethers.parseEther("0.01");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600;
            const data = "0x1234";

            const sig = createUseSignature(signId, user1.address, id, amount, fee, deadline, data, await inventory.getAddress());

            // First use should succeed
            await inventory.connect(user1).use(
                signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                {value: fee}
            );

            // Second use with same signId should fail
            await expect(
                inventory.connect(user1).use(
                    signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                    {value: fee}
                )
            ).to.be.revertedWithCustomError(inventory, "SignAlreadyUsed");
        });
    });

    describe("ETH Withdrawal", function () {
        let signerPrivateKey;

        beforeEach(async function () {
            // Use a known private key for consistent signature generation
            signerPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
            const testSigner = new ethers.Wallet(signerPrivateKey);
            
            // Update signer to use test signer
            await inventory.connect(owner).setSigner(testSigner.address);
            
            // Add ETH to contract via claim function (which accepts ETH payments)
            const signId = 1000;
            const id = 10;
            const amount = 5;
            const fee = ethers.parseEther("2.0");
            const currentBlock = await ethers.provider.getBlock('latest');
            const deadline = currentBlock.timestamp + 3600;
            const data = "0x1234";

            function createClaimSignature(signId, account, id, amount, fee, deadline, data, contractAddress) {
                const messageHash = ethers.keccak256(
                    ethers.AbiCoder.defaultAbiCoder().encode(
                        ["uint256", "address", "uint256", "uint256", "uint256", "uint256", "bytes", "address", "string"],
                        [signId, account, id, amount, fee, deadline, data, contractAddress, "claim"]
                    )
                );

                const signingKey = new ethers.SigningKey(signerPrivateKey);
                const signature = signingKey.sign(messageHash);

                return {
                    v: signature.v,
                    r: signature.r,
                    s: signature.s
                };
            }

            const sig = createClaimSignature(signId, user1.address, id, amount, fee, deadline, data, await inventory.getAddress());

            await inventory.connect(user1).claim(
                signId, id, amount, fee, deadline, sig.v, sig.r, sig.s, data,
                {value: fee}
            );
        });

        it("Should allow withdraw role to withdraw ETH", async function () {
            const initialBalance = await ethers.provider.getBalance(withdrawRole.address);
            const contractBalance = await ethers.provider.getBalance(await inventory.getAddress());
            
            await inventory.connect(withdrawRole).withdrawEth();
            
            const finalBalance = await ethers.provider.getBalance(withdrawRole.address);
            const finalContractBalance = await ethers.provider.getBalance(await inventory.getAddress());
            
            expect(finalContractBalance).to.equal(0);
            expect(finalBalance).to.be.gt(initialBalance);
        });

        it("Should revert if non-withdraw role tries to withdraw ETH", async function () {
            await expect(
                inventory.connect(user1).withdrawEth()
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
        });

        it("Should handle withdrawal when contract has no ETH", async function () {
            // First withdraw all ETH
            await inventory.connect(withdrawRole).withdrawEth();
            
            // Second withdrawal should not fail (0 balance transfer)
            await inventory.connect(withdrawRole).withdrawEth();
        });
    });

    describe("ERC20 Token Withdrawal", function () {
        let mockToken;

        beforeEach(async function () {
            // Deploy a mock ERC20 token for testing
            const MockERC20 = await ethers.getContractFactory("TestToken");
            mockToken = await MockERC20.deploy();
            
            // Mint and transfer some tokens to the inventory contract
            await mockToken.mint(owner.address, ethers.parseEther("100"));
            await mockToken.transfer(await inventory.getAddress(), ethers.parseEther("100"));
        });

        it("Should allow withdraw role to withdraw ERC20 tokens", async function () {
            const initialBalance = await mockToken.balanceOf(withdrawRole.address);
            const contractBalance = await mockToken.balanceOf(await inventory.getAddress());
            
            await inventory.connect(withdrawRole).withdrawERC20(await mockToken.getAddress());
            
            const finalBalance = await mockToken.balanceOf(withdrawRole.address);
            const finalContractBalance = await mockToken.balanceOf(await inventory.getAddress());
            
            expect(finalContractBalance).to.equal(0);
            expect(finalBalance).to.equal(initialBalance + contractBalance);
        });

        it("Should revert if non-withdraw role tries to withdraw ERC20", async function () {
            await expect(
                inventory.connect(user1).withdrawERC20(await mockToken.getAddress())
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
        });

        it("Should handle withdrawal when contract has no tokens", async function () {
            // First withdraw all tokens
            await inventory.connect(withdrawRole).withdrawERC20(await mockToken.getAddress());
            
            // Second withdrawal should not fail (0 balance transfer)
            await inventory.connect(withdrawRole).withdrawERC20(await mockToken.getAddress());
        });
    });

    describe("URI Functionality", function () {
        it("Should return correct URI with token ID concatenated", async function () {
            const tokenId = 123;
            const expectedUri = "https://example.com/metadata/123";
            
            expect(await inventory.uri(tokenId)).to.equal(expectedUri);
        });

        it("Should handle token ID 0 correctly", async function () {
            const tokenId = 0;
            const expectedUri = "https://example.com/metadata/0";
            
            expect(await inventory.uri(tokenId)).to.equal(expectedUri);
        });

        it("Should handle large token IDs correctly", async function () {
            const tokenId = 999999999;
            const expectedUri = "https://example.com/metadata/999999999";
            
            expect(await inventory.uri(tokenId)).to.equal(expectedUri);
        });

        it("Should update URI when setURI is called", async function () {
            await inventory.connect(owner).setURI("https://newbase.com/tokens/");
            
            const tokenId = 456;
            const expectedUri = "https://newbase.com/tokens/456";
            
            expect(await inventory.uri(tokenId)).to.equal(expectedUri);
        });
    });

    describe("Role-based Access Controls", function () {
        it("Should only allow DEFAULT_ADMIN_ROLE to grant/revoke roles", async function () {
            await expect(
                inventory.connect(user1).grantRole(await inventory.MINTER_ROLE(), user2.address)
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
            
            // Admin should be able to grant roles
            await inventory.connect(owner).grantRole(await inventory.MINTER_ROLE(), user2.address);
            expect(await inventory.hasRole(await inventory.MINTER_ROLE(), user2.address)).to.be.true;
        });

        it("Should only allow MINTER_ROLE to mint", async function () {
            await expect(
                inventory.connect(user1).mint(user1.address, 1, 5, "0x")
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
        });

        it("Should only allow BURNER_ROLE to admin burn", async function () {
            await inventory.connect(minter).mint(user1.address, 1, 10, "0x");
            
            await expect(
                inventory.connect(user1).burnAdmin(user1.address, 1, 3, "0x")
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
        });

        it("Should only allow BAN_ROLE to ban/unban", async function () {
            await expect(
                inventory.connect(user1).ban(user2.address)
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
            
            await expect(
                inventory.connect(user1).unban(user2.address)
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
        });

        it("Should only allow DEFAULT_ADMIN_ROLE to pause/unpause", async function () {
            await expect(
                inventory.connect(user1).pause()
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
            
            await expect(
                inventory.connect(user1).unpause()
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
        });

        it("Should only allow DEFAULT_ADMIN_ROLE to modify transfer controls", async function () {
            await expect(
                inventory.connect(user1).disableTransfer([1])
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
            
            await expect(
                inventory.connect(user1).enableTransfer([1])
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
            
            await expect(
                inventory.connect(user1).disableTransferRange(1, 10)
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
            
            await expect(
                inventory.connect(user1).enableTransferRange(1, 10)
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
        });
    });

    describe("Max Balance Per Owner", function () {
        it("Should allow minting up to max balance limit", async function () {
            // Set max balance to 3 for token ID 100
            await inventory.connect(owner).setMaxBalancePerOwner(100, 3);

            // Should allow minting up to limit
            await inventory.connect(minter).mint(user1.address, 100, 3, "0x");
            expect(await inventory.balanceOf(user1.address, 100)).to.equal(3);
        });

        it("Should prevent minting above max balance limit", async function () {
            // Set max balance to 3 for token ID 100
            await inventory.connect(owner).setMaxBalancePerOwner(100, 3);

            // Should revert when trying to mint more than limit
            await expect(
                inventory.connect(minter).mint(user1.address, 100, 4, "0x")
            ).to.be.revertedWithCustomError(inventory, "MaxBalanceExceeded");
        });

        it("Should prevent exceeding limit across multiple mints", async function () {
            // Set max balance to 5 for token ID 100
            await inventory.connect(owner).setMaxBalancePerOwner(100, 5);

            // First mint 3
            await inventory.connect(minter).mint(user1.address, 100, 3, "0x");

            // Should revert when trying to mint 3 more (would exceed 5)
            await expect(
                inventory.connect(minter).mint(user1.address, 100, 3, "0x")
            ).to.be.revertedWithCustomError(inventory, "MaxBalanceExceeded");

            // Should allow minting 2 more (exactly 5 total)
            await inventory.connect(minter).mint(user1.address, 100, 2, "0x");
            expect(await inventory.balanceOf(user1.address, 100)).to.equal(5);
        });

        it("Should prevent transfers that exceed recipient's limit", async function () {
            // Set max balance to 2 for token ID 100
            await inventory.connect(owner).setMaxBalancePerOwner(100, 2);

            // Mint 5 to user1 (set limit after minting)
            await inventory.connect(minter).mint(user1.address, 100, 5, "0x");
            await inventory.connect(owner).setMaxBalancePerOwner(100, 2);

            // Mint 1 to user2
            await inventory.connect(minter).mint(user2.address, 100, 1, "0x");

            // Should revert when user1 tries to transfer 2 to user2 (would make user2 have 3)
            await expect(
                inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 100, 2, "0x")
            ).to.be.revertedWithCustomError(inventory, "MaxBalanceExceeded");

            // Should allow transferring 1 (user2 would have 2, at the limit)
            await inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 100, 1, "0x");
            expect(await inventory.balanceOf(user2.address, 100)).to.equal(2);
        });

        it("Should allow batch setting max balances", async function () {
            const tokenIds = [100, 101, 102];
            const maxBalances = [1, 2, 3];

            await inventory.connect(owner).setMaxBalancePerOwnerBatch(tokenIds, maxBalances);

            expect(await inventory.maxBalancePerOwner(100)).to.equal(1);
            expect(await inventory.maxBalancePerOwner(101)).to.equal(2);
            expect(await inventory.maxBalancePerOwner(102)).to.equal(3);
        });

        it("Should only allow admin to set max balance", async function () {
            await expect(
                inventory.connect(user1).setMaxBalancePerOwner(100, 5)
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
        });

        it("Should allow unlimited balance when max is 0", async function () {
            // Default max is 0 (unlimited)
            await inventory.connect(minter).mint(user1.address, 200, 1000000, "0x");
            expect(await inventory.balanceOf(user1.address, 200)).to.equal(1000000);
        });
    });

    describe("Restricted Items", function () {
        it("Should prevent minting token when owning restricted item", async function () {
            // Set token 1001 as restricted for token 1000
            await inventory.connect(owner).setRestrictedItems(1000, [1001]);

            // Mint token 1001 to user1
            await inventory.connect(minter).mint(user1.address, 1001, 1, "0x");

            // Should revert when trying to mint token 1000 (restricted because owns 1001)
            await expect(
                inventory.connect(minter).mint(user1.address, 1000, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "RestrictedItemConflict");
        });

        it("Should prevent minting if user owns any restricted item", async function () {
            // Set multiple restricted items for token 1000
            await inventory.connect(owner).setRestrictedItems(1000, [1001, 1002, 1003]);

            // Mint token 1002 to user1
            await inventory.connect(minter).mint(user1.address, 1002, 1, "0x");

            // Should revert when trying to mint token 1000
            await expect(
                inventory.connect(minter).mint(user1.address, 1000, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "RestrictedItemConflict");
        });

        it("Should prevent transfers to address owning restricted item", async function () {
            // Set token 1001 as restricted for token 1000
            await inventory.connect(owner).setRestrictedItems(1000, [1001]);

            // Mint token 1000 to user1
            await inventory.connect(minter).mint(user1.address, 1000, 1, "0x");

            // Mint token 1001 to user2
            await inventory.connect(minter).mint(user2.address, 1001, 1, "0x");

            // Should revert when user1 tries to transfer 1000 to user2 (user2 owns restricted 1001)
            await expect(
                inventory.connect(user1).safeTransferFrom(user1.address, user2.address, 1000, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "RestrictedItemConflict");
        });

        it("Should allow minting when no restricted items are owned", async function () {
            // Set token 1001 as restricted for token 1000
            await inventory.connect(owner).setRestrictedItems(1000, [1001]);

            // User doesn't own 1001, so should be able to mint 1000
            await inventory.connect(minter).mint(user1.address, 1000, 1, "0x");
            expect(await inventory.balanceOf(user1.address, 1000)).to.equal(1);
        });

        it("Should allow batch setting restricted items", async function () {
            const tokenIds = [2000, 2001, 2002];
            const restrictedArrays = [
                [2001, 2002],  // 2000 restricts 2001, 2002
                [2000, 2002],  // 2001 restricts 2000, 2002
                [2000, 2001]   // 2002 restricts 2000, 2001
            ];

            await inventory.connect(owner).setRestrictedItemsBatch(tokenIds, restrictedArrays);

            // Mint 2000 to user1
            await inventory.connect(minter).mint(user1.address, 2000, 1, "0x");

            // Should not be able to mint 2001 or 2002 (both restricted)
            await expect(
                inventory.connect(minter).mint(user1.address, 2001, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "RestrictedItemConflict");

            await expect(
                inventory.connect(minter).mint(user1.address, 2002, 1, "0x")
            ).to.be.revertedWithCustomError(inventory, "RestrictedItemConflict");
        });

        it("Should allow mutually exclusive reactor ownership pattern", async function () {
            // Simulate reactor family (2000, 2001, 2002, 2003, 2004) mutually exclusive
            await inventory.connect(owner).setRestrictedItemsBatch(
                [2000, 2001, 2002, 2003, 2004],
                [
                    [2001, 2002, 2003, 2004],  // 2000 restricts all others
                    [2000, 2002, 2003, 2004],  // 2001 restricts all others
                    [2000, 2001, 2003, 2004],  // 2002 restricts all others
                    [2000, 2001, 2002, 2004],  // 2003 restricts all others
                    [2000, 2001, 2002, 2003]   // 2004 restricts all others
                ]
            );

            // Mint base reactor 2000 to user1
            await inventory.connect(minter).mint(user1.address, 2000, 1, "0x");

            // Should not be able to mint any other variant
            for (let i = 1; i <= 4; i++) {
                await expect(
                    inventory.connect(minter).mint(user1.address, 2000 + i, 1, "0x")
                ).to.be.revertedWithCustomError(inventory, "RestrictedItemConflict");
            }

            // User2 should be able to mint 2001 (doesn't own any reactors)
            await inventory.connect(minter).mint(user2.address, 2001, 1, "0x");
            expect(await inventory.balanceOf(user2.address, 2001)).to.equal(1);
        });

        it("Should only allow admin to set restricted items", async function () {
            await expect(
                inventory.connect(user1).setRestrictedItems(1000, [1001])
            ).to.be.revertedWithCustomError(inventory, "AccessControlUnauthorizedAccount");
        });

        it("Should handle empty restricted items array", async function () {
            // Set empty array (no restrictions)
            await inventory.connect(owner).setRestrictedItems(1000, []);

            // Should be able to mint freely
            await inventory.connect(minter).mint(user1.address, 1000, 1, "0x");
            expect(await inventory.balanceOf(user1.address, 1000)).to.equal(1);
        });
    });
});