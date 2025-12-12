import { expect } from "chai";
import { Wallet } from "zksync-ethers";
import * as hre from "hardhat";
import { Deployer } from "@matterlabs/hardhat-zksync";
import "@nomicfoundation/hardhat-chai-matchers";

// Use ZKsync's default rich wallet for local testing
const RICH_WALLET_PK = "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";

describe("BankV2", function () {
    let deployer: Deployer;
    let wallet: Wallet;
    let signer: Wallet;
    let user: Wallet;
    let bank: any;
    let testToken: any;
    let traxToken: any;
    let admin: string;

    const SIGNER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("SIGNER_ROLE"));
    const WITHDRAW_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("WITHDRAW_ROLE"));
    const OPERATOR_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("OPERATOR_ROLE"));

    // Helper function to create a signature for useETH/useToken
    async function createUseSignature(
        signId: number,
        value: bigint,
        token: string,
        account: string,
        param: number,
        fee: bigint,
        deadline: number,
        contractAddress: string,
        signerWallet: Wallet
    ) {
        const messageHash = hre.ethers.keccak256(
            hre.ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "uint256", "uint256", "address", "address", "uint256", "uint256", "uint256", "address"],
                ["use", signId, value, token, account, param, fee, deadline, contractAddress]
            )
        );

        const sig = signerWallet.signingKey.sign(messageHash);

        return {
            v: sig.v,
            r: sig.r,
            s: sig.s
        };
    }

    // Helper function to create a signature for claim/claimEth
    async function createClaimSignature(
        signId: number,
        account: string,
        token: string,
        value: bigint,
        fee: bigint,
        deadline: number,
        contractAddress: string,
        signerWallet: Wallet
    ) {
        const messageHash = hre.ethers.keccak256(
            hre.ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "uint256", "address", "address", "uint256", "uint256", "uint256", "address"],
                ["claim", signId, account, token, value, fee, deadline, contractAddress]
            )
        );

        const sig = signerWallet.signingKey.sign(messageHash);

        return {
            v: sig.v,
            r: sig.r,
            s: sig.s
        };
    }

    beforeEach(async () => {
        wallet = new Wallet(RICH_WALLET_PK, hre.ethers.provider);
        admin = await wallet.getAddress();
        signer = Wallet.createRandom().connect(hre.ethers.provider);
        user = Wallet.createRandom().connect(hre.ethers.provider);
        deployer = new Deployer(hre, wallet);

        // Fund the user and signer wallets with ETH for gas
        await wallet.sendTransaction({
            to: user.address,
            value: hre.ethers.parseEther("10")
        });
        await wallet.sendTransaction({
            to: signer.address,
            value: hre.ethers.parseEther("1")
        });

        // Deploy TestToken
        const tokenArtifact = await deployer.loadArtifact("TestToken");
        testToken = await deployer.deploy(tokenArtifact, []);

        // Deploy TRAX token (using TestToken as mock)
        traxToken = await deployer.deploy(tokenArtifact, []);

        // Deploy BankV2 contract
        const bankArtifact = await deployer.loadArtifact("BankV2");
        bank = await deployer.deploy(bankArtifact, [
            admin,
            admin,
            signer.address,
            await traxToken.getAddress()
        ]);

        // Mint test tokens to user for useToken tests
        await testToken.mint(user.address, hre.ethers.parseEther("1000"));

        // Mint test tokens to bank for claim tests
        await testToken.mint(await bank.getAddress(), hre.ethers.parseEther("1000"));

        // Fund bank with ETH for claimEth tests
        await wallet.sendTransaction({
            to: await bank.getAddress(),
            value: hre.ethers.parseEther("10")
        });
    });

    describe("Deployment", () => {
        it("Should grant admin, signer, and withdraw roles correctly", async () => {
            const DEFAULT_ADMIN_ROLE = hre.ethers.ZeroHash;
            expect(await bank.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
            expect(await bank.hasRole(SIGNER_ROLE, signer.address)).to.be.true;
            expect(await bank.hasRole(WITHDRAW_ROLE, admin)).to.be.true;
        });

        it("Should have the correct token balance", async () => {
            const balance = await bank.getBalance(await testToken.getAddress());
            expect(balance).to.equal(hre.ethers.parseEther("1000"));
        });

        it("Should have the correct ETH balance", async () => {
            const balance = await bank.getEthBalance();
            expect(balance).to.equal(hre.ethers.parseEther("10"));
        });

        it("Should revert if admin is zero address", async () => {
            const bankArtifact = await deployer.loadArtifact("BankV2");
            await expect(
                deployer.deploy(bankArtifact, [
                    hre.ethers.ZeroAddress,
                    admin,
                    signer.address,
                    await traxToken.getAddress()
                ])
            ).to.be.revertedWithCustomError(bank, "ZeroAddress");
        });

        it("Should revert if signer is zero address", async () => {
            const bankArtifact = await deployer.loadArtifact("BankV2");
            await expect(
                deployer.deploy(bankArtifact, [
                    admin,
                    admin,
                    hre.ethers.ZeroAddress,
                    await traxToken.getAddress()
                ])
            ).to.be.revertedWithCustomError(bank, "ZeroAddress");
        });

        it("Should revert if traxToken is zero address", async () => {
            const bankArtifact = await deployer.loadArtifact("BankV2");
            await expect(
                deployer.deploy(bankArtifact, [
                    admin,
                    admin,
                    signer.address,
                    hre.ethers.ZeroAddress
                ])
            ).to.be.revertedWithCustomError(bank, "ZeroAddress");
        });
    });

    describe("useETH", () => {
        it("Should accept ETH payment with valid signature", async () => {
            const paymentAmount = hre.ethers.parseEther("1");
            const param = 123;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 1;

            const sig = await createUseSignature(
                signId,
                paymentAmount,
                hre.ethers.ZeroAddress,
                user.address,
                param,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.useETH(signId, param, deadline, sig.v, sig.r, sig.s, { value: paymentAmount })
            )
                .to.emit(bank, "Used")
                .withArgs(signId, paymentAmount, hre.ethers.ZeroAddress, user.address, param);

            // Verify signId is marked as used
            expect(await bank.isSignIdUsed(signId)).to.be.true;
        });

        it("Should revert if value is zero", async () => {
            const param = 123;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 2;

            const sig = await createUseSignature(
                signId,
                0n,
                hre.ethers.ZeroAddress,
                user.address,
                param,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.useETH(signId, param, deadline, sig.v, sig.r, sig.s, { value: 0 })
            ).to.be.revertedWithCustomError(bank, "ZeroValue");
        });

        it("Should revert if deadline has expired", async () => {
            const paymentAmount = hre.ethers.parseEther("1");
            const param = 123;
            const currentBlock = await hre.ethers.provider.getBlock('latest');
            const deadline = currentBlock!.timestamp - 1;
            const signId = 3;

            const sig = await createUseSignature(
                signId,
                paymentAmount,
                hre.ethers.ZeroAddress,
                user.address,
                param,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.useETH(signId, param, deadline, sig.v, sig.r, sig.s, { value: paymentAmount })
            ).to.be.revertedWithCustomError(bank, "DeadlineExpired");
        });

        it("Should revert if signature is invalid", async () => {
            const paymentAmount = hre.ethers.parseEther("1");
            const param = 123;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 4;

            // Sign with wrong signer
            const sig = await createUseSignature(
                signId,
                paymentAmount,
                hre.ethers.ZeroAddress,
                user.address,
                param,
                0n,
                deadline,
                await bank.getAddress(),
                wallet // Wrong signer!
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.useETH(signId, param, deadline, sig.v, sig.r, sig.s, { value: paymentAmount })
            ).to.be.revertedWithCustomError(bank, "WrongSignature");
        });

        it("Should revert if signId is already used", async () => {
            const paymentAmount = hre.ethers.parseEther("1");
            const param = 123;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 5;

            const sig = await createUseSignature(
                signId,
                paymentAmount,
                hre.ethers.ZeroAddress,
                user.address,
                param,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);

            // First use should succeed
            await bankWithUser.useETH(signId, param, deadline, sig.v, sig.r, sig.s, { value: paymentAmount });

            // Second use with same signId should fail
            await expect(
                bankWithUser.useETH(signId, param, deadline, sig.v, sig.r, sig.s, { value: paymentAmount })
            ).to.be.revertedWithCustomError(bank, "SignIdAlreadyUsed");
        });
    });

    describe("useToken", () => {
        it("Should accept token payment with valid signature", async () => {
            const tokenAddress = await testToken.getAddress();
            const paymentAmount = hre.ethers.parseEther("100");
            const param = 456;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 10;

            // Approve bank to spend tokens
            await testToken.connect(user).approve(await bank.getAddress(), paymentAmount);

            const sig = await createUseSignature(
                signId,
                paymentAmount,
                tokenAddress,
                user.address,
                param,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.useToken(tokenAddress, paymentAmount, signId, param, deadline, sig.v, sig.r, sig.s)
            )
                .to.emit(bank, "Used")
                .withArgs(signId, paymentAmount, tokenAddress, user.address, param);

            // Verify bank received the tokens
            expect(await testToken.balanceOf(await bank.getAddress())).to.equal(hre.ethers.parseEther("1100"));
        });

        it("Should revert if token is zero address", async () => {
            const paymentAmount = hre.ethers.parseEther("100");
            const param = 456;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 11;

            const sig = await createUseSignature(
                signId,
                paymentAmount,
                hre.ethers.ZeroAddress,
                user.address,
                param,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.useToken(hre.ethers.ZeroAddress, paymentAmount, signId, param, deadline, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(bank, "ZeroAddress");
        });

        it("Should revert if value is zero", async () => {
            const tokenAddress = await testToken.getAddress();
            const param = 456;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 12;

            const sig = await createUseSignature(
                signId,
                0n,
                tokenAddress,
                user.address,
                param,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.useToken(tokenAddress, 0, signId, param, deadline, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(bank, "ZeroValue");
        });
    });

    describe("claim", () => {
        it("Should allow user to claim tokens with valid signature", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 20;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.claim(user.address, tokenAddress, claimAmount, 0, deadline, signId, sig.v, sig.r, sig.s)
            )
                .to.emit(bank, "Claimed")
                .withArgs(user.address, tokenAddress, claimAmount, deadline, signId);

            // Verify user received the tokens
            expect(await testToken.balanceOf(user.address)).to.equal(hre.ethers.parseEther("1100")); // 1000 initial + 100 claimed
        });

        it("Should revert if token is zero address", async () => {
            const claimAmount = hre.ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 21;

            const sig = await createClaimSignature(
                signId,
                user.address,
                hre.ethers.ZeroAddress,
                claimAmount,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.claim(user.address, hre.ethers.ZeroAddress, claimAmount, 0, deadline, signId, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(bank, "ZeroAddress");
        });

        it("Should revert if insufficient balance", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("2000"); // More than bank has
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 22;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.claim(user.address, tokenAddress, claimAmount, 0, deadline, signId, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(bank, "InsufficientBalance");
        });

        it("Should revert if deadline has expired", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const currentBlock = await hre.ethers.provider.getBlock('latest');
            const deadline = currentBlock!.timestamp - 1;
            const signId = 23;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.claim(user.address, tokenAddress, claimAmount, 0, deadline, signId, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(bank, "DeadlineExpired");
        });

        it("Should revert if signature is invalid", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 24;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                0n,
                deadline,
                await bank.getAddress(),
                wallet // Wrong signer!
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.claim(user.address, tokenAddress, claimAmount, 0, deadline, signId, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(bank, "WrongSignature");
        });

        it("Should revert if signId is already used", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 25;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);

            // First claim should succeed
            await bankWithUser.claim(user.address, tokenAddress, claimAmount, 0, deadline, signId, sig.v, sig.r, sig.s);

            // Second claim with same signId should fail
            await expect(
                bankWithUser.claim(user.address, tokenAddress, claimAmount, 0, deadline, signId, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(bank, "SignIdAlreadyUsed");
        });
    });

    describe("claimEth", () => {
        it("Should allow user to claim ETH with valid signature", async () => {
            const claimAmount = hre.ethers.parseEther("1");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 30;

            const userBalanceBefore = await hre.ethers.provider.getBalance(user.address);

            const sig = await createClaimSignature(
                signId,
                user.address,
                hre.ethers.ZeroAddress,
                claimAmount,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            const tx = await bankWithUser.claimEth(user.address, claimAmount, 0, deadline, signId, sig.v, sig.r, sig.s);
            const receipt = await tx.wait();
            const gasCost = receipt.gasUsed * receipt.gasPrice;

            await expect(tx)
                .to.emit(bank, "Claimed")
                .withArgs(user.address, hre.ethers.ZeroAddress, claimAmount, deadline, signId);

            // Verify user received the ETH (accounting for gas)
            const userBalanceAfter = await hre.ethers.provider.getBalance(user.address);
            expect(userBalanceAfter).to.equal(userBalanceBefore + claimAmount - gasCost);
        });

        it("Should revert if insufficient ETH balance", async () => {
            const claimAmount = hre.ethers.parseEther("100"); // More than bank has
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 31;

            const sig = await createClaimSignature(
                signId,
                user.address,
                hre.ethers.ZeroAddress,
                claimAmount,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.claimEth(user.address, claimAmount, 0, deadline, signId, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(bank, "InsufficientBalance");
        });

        it("Should revert if value is zero", async () => {
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 32;

            const sig = await createClaimSignature(
                signId,
                user.address,
                hre.ethers.ZeroAddress,
                0n,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.claimEth(user.address, 0, 0, deadline, signId, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(bank, "ZeroValue");
        });
    });

    describe("Withdrawal", () => {
        it("Should allow admin to withdraw specific token amount", async () => {
            const tokenAddress = await testToken.getAddress();
            const withdrawAmount = hre.ethers.parseEther("100");

            await expect(
                bank.withdraw(tokenAddress, admin, withdrawAmount)
            )
                .to.emit(bank, "Withdrawn")
                .withArgs(tokenAddress, admin, withdrawAmount);

            expect(await testToken.balanceOf(admin)).to.equal(withdrawAmount);
        });

        it("Should allow admin to withdraw all tokens", async () => {
            const tokenAddress = await testToken.getAddress();
            const balance = await bank.getBalance(tokenAddress);

            await expect(
                bank.connect(wallet).withdrawAll(tokenAddress)
            )
                .to.emit(bank, "Withdrawn")
                .withArgs(tokenAddress, admin, balance);

            expect(await testToken.balanceOf(admin)).to.equal(balance);
            expect(await bank.getBalance(tokenAddress)).to.equal(0);
        });

        it("Should allow admin to withdraw specific ETH amount", async () => {
            const withdrawAmount = hre.ethers.parseEther("1");
            const adminBalanceBefore = await hre.ethers.provider.getBalance(admin);

            const tx = await bank.withdrawEth(admin, withdrawAmount);
            const receipt = await tx.wait();
            const gasCost = receipt.gasUsed * receipt.gasPrice;

            await expect(tx)
                .to.emit(bank, "WithdrawnEth")
                .withArgs(admin, withdrawAmount);

            const adminBalanceAfter = await hre.ethers.provider.getBalance(admin);
            expect(adminBalanceAfter).to.equal(adminBalanceBefore + withdrawAmount - gasCost);
        });

        it("Should allow admin to withdraw all ETH", async () => {
            const balance = await bank.getEthBalance();

            await expect(
                bank.connect(wallet).withdrawAllEth()
            )
                .to.emit(bank, "WithdrawnEth")
                .withArgs(admin, balance);

            expect(await bank.getEthBalance()).to.equal(0);
        });

        it("Should revert if non-admin tries to withdraw", async () => {
            const tokenAddress = await testToken.getAddress();
            const withdrawAmount = hre.ethers.parseEther("100");

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.withdraw(tokenAddress, user.address, withdrawAmount)
            ).to.be.reverted;
        });

        it("Should revert if non-admin tries to withdraw ETH", async () => {
            const withdrawAmount = hre.ethers.parseEther("1");

            const bankWithUser = bank.connect(user);
            await expect(
                bankWithUser.withdrawEth(user.address, withdrawAmount)
            ).to.be.reverted;
        });
    });

    describe("View functions", () => {
        it("Should return correct token balance", async () => {
            const tokenAddress = await testToken.getAddress();
            expect(await bank.getBalance(tokenAddress)).to.equal(hre.ethers.parseEther("1000"));
        });

        it("Should return correct ETH balance", async () => {
            expect(await bank.getEthBalance()).to.equal(hre.ethers.parseEther("10"));
        });

        it("Should correctly track used signIds", async () => {
            expect(await bank.isSignIdUsed(999)).to.be.false;

            // Use a signId
            const paymentAmount = hre.ethers.parseEther("1");
            const param = 123;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 999;

            const sig = await createUseSignature(
                signId,
                paymentAmount,
                hre.ethers.ZeroAddress,
                user.address,
                param,
                0n,
                deadline,
                await bank.getAddress(),
                signer
            );

            await bank.connect(user).useETH(signId, param, deadline, sig.v, sig.r, sig.s, { value: paymentAmount });

            expect(await bank.isSignIdUsed(999)).to.be.true;
        });
    });

    describe("Receive ETH", () => {
        it("Should accept direct ETH transfers", async () => {
            const balanceBefore = await bank.getEthBalance();

            await wallet.sendTransaction({
                to: await bank.getAddress(),
                value: hre.ethers.parseEther("1")
            });

            const balanceAfter = await bank.getEthBalance();
            expect(balanceAfter).to.equal(balanceBefore + hre.ethers.parseEther("1"));
        });
    });

    describe("Operator sendToken/sendEth", () => {
        let operator: Wallet;

        beforeEach(async () => {
            // Create operator wallet
            operator = Wallet.createRandom().connect(hre.ethers.provider);
            await wallet.sendTransaction({
                to: operator.address,
                value: hre.ethers.parseEther("1")
            });

            // Grant operator role
            await bank.grantRole(OPERATOR_ROLE, operator.address);
        });

        describe("setSendTokenLimit", () => {
            it("Should allow admin to set token limit", async () => {
                const tokenAddress = await testToken.getAddress();
                const limit = hre.ethers.parseEther("100");

                await bank.setSendTokenLimit(tokenAddress, limit);
                expect(await bank.sendTokenLimit(tokenAddress)).to.equal(limit);
            });

            it("Should allow admin to set ETH limit (address 0)", async () => {
                const limit = hre.ethers.parseEther("5");

                await bank.setSendTokenLimit(hre.ethers.ZeroAddress, limit);
                expect(await bank.sendTokenLimit(hre.ethers.ZeroAddress)).to.equal(limit);
            });

            it("Should revert if non-admin tries to set limit", async () => {
                const tokenAddress = await testToken.getAddress();
                const limit = hre.ethers.parseEther("100");

                await expect(
                    bank.connect(user).setSendTokenLimit(tokenAddress, limit)
                ).to.be.reverted;
            });
        });

        describe("sendToken", () => {
            it("Should allow operator to send tokens within limit", async () => {
                const tokenAddress = await testToken.getAddress();
                const sendAmount = hre.ethers.parseEther("50");
                const limit = hre.ethers.parseEther("100");

                // Set limit
                await bank.setSendTokenLimit(tokenAddress, limit);

                const recipientBalanceBefore = await testToken.balanceOf(user.address);

                // Operator sends tokens
                await bank.connect(operator).sendToken(tokenAddress, user.address, sendAmount);

                const recipientBalanceAfter = await testToken.balanceOf(user.address);
                expect(recipientBalanceAfter).to.equal(recipientBalanceBefore + sendAmount);
            });

            it("Should revert if amount exceeds limit", async () => {
                const tokenAddress = await testToken.getAddress();
                const sendAmount = hre.ethers.parseEther("150");
                const limit = hre.ethers.parseEther("100");

                // Set limit
                await bank.setSendTokenLimit(tokenAddress, limit);

                await expect(
                    bank.connect(operator).sendToken(tokenAddress, user.address, sendAmount)
                ).to.be.revertedWithCustomError(bank, "ExceedsTokenLimit");
            });

            it("Should revert if limit is not set (default 0)", async () => {
                const tokenAddress = await testToken.getAddress();
                const sendAmount = hre.ethers.parseEther("50");

                // No limit set, default is 0
                await expect(
                    bank.connect(operator).sendToken(tokenAddress, user.address, sendAmount)
                ).to.be.revertedWithCustomError(bank, "ExceedsTokenLimit");
            });

            it("Should revert if non-operator tries to send", async () => {
                const tokenAddress = await testToken.getAddress();
                const sendAmount = hre.ethers.parseEther("50");
                const limit = hre.ethers.parseEther("100");

                await bank.setSendTokenLimit(tokenAddress, limit);

                await expect(
                    bank.connect(user).sendToken(tokenAddress, user.address, sendAmount)
                ).to.be.reverted;
            });

            it("Should revert if recipient is zero address", async () => {
                const tokenAddress = await testToken.getAddress();
                const sendAmount = hre.ethers.parseEther("50");
                const limit = hre.ethers.parseEther("100");

                await bank.setSendTokenLimit(tokenAddress, limit);

                await expect(
                    bank.connect(operator).sendToken(tokenAddress, hre.ethers.ZeroAddress, sendAmount)
                ).to.be.revertedWithCustomError(bank, "ZeroAddress");
            });

            it("Should revert if token is zero address", async () => {
                const sendAmount = hre.ethers.parseEther("50");
                const limit = hre.ethers.parseEther("100");

                await bank.setSendTokenLimit(hre.ethers.ZeroAddress, limit);

                await expect(
                    bank.connect(operator).sendToken(hre.ethers.ZeroAddress, user.address, sendAmount)
                ).to.be.revertedWithCustomError(bank, "ZeroAddress");
            });

            it("Should revert if amount is zero", async () => {
                const tokenAddress = await testToken.getAddress();
                const limit = hre.ethers.parseEther("100");

                await bank.setSendTokenLimit(tokenAddress, limit);

                await expect(
                    bank.connect(operator).sendToken(tokenAddress, user.address, 0)
                ).to.be.revertedWithCustomError(bank, "ZeroValue");
            });
        });

        describe("sendEth", () => {
            it("Should allow operator to send ETH within limit", async () => {
                const sendAmount = hre.ethers.parseEther("1");
                const limit = hre.ethers.parseEther("5");

                // Set ETH limit (using address 0)
                await bank.setSendTokenLimit(hre.ethers.ZeroAddress, limit);

                const recipientBalanceBefore = await hre.ethers.provider.getBalance(user.address);

                // Operator sends ETH
                await bank.connect(operator).sendEth(user.address, sendAmount);

                const recipientBalanceAfter = await hre.ethers.provider.getBalance(user.address);
                expect(recipientBalanceAfter).to.equal(recipientBalanceBefore + sendAmount);
            });

            it("Should revert if amount exceeds limit", async () => {
                const sendAmount = hre.ethers.parseEther("10");
                const limit = hre.ethers.parseEther("5");

                await bank.setSendTokenLimit(hre.ethers.ZeroAddress, limit);

                await expect(
                    bank.connect(operator).sendEth(user.address, sendAmount)
                ).to.be.revertedWithCustomError(bank, "ExceedsTokenLimit");
            });

            it("Should revert if limit is not set (default 0)", async () => {
                const sendAmount = hre.ethers.parseEther("1");

                // No limit set, default is 0
                await expect(
                    bank.connect(operator).sendEth(user.address, sendAmount)
                ).to.be.revertedWithCustomError(bank, "ExceedsTokenLimit");
            });

            it("Should revert if non-operator tries to send", async () => {
                const sendAmount = hre.ethers.parseEther("1");
                const limit = hre.ethers.parseEther("5");

                await bank.setSendTokenLimit(hre.ethers.ZeroAddress, limit);

                await expect(
                    bank.connect(user).sendEth(user.address, sendAmount)
                ).to.be.reverted;
            });

            it("Should revert if recipient is zero address", async () => {
                const sendAmount = hre.ethers.parseEther("1");
                const limit = hre.ethers.parseEther("5");

                await bank.setSendTokenLimit(hre.ethers.ZeroAddress, limit);

                await expect(
                    bank.connect(operator).sendEth(hre.ethers.ZeroAddress, sendAmount)
                ).to.be.revertedWithCustomError(bank, "ZeroAddress");
            });

            it("Should revert if amount is zero", async () => {
                const limit = hre.ethers.parseEther("5");

                await bank.setSendTokenLimit(hre.ethers.ZeroAddress, limit);

                await expect(
                    bank.connect(operator).sendEth(user.address, 0)
                ).to.be.revertedWithCustomError(bank, "ZeroValue");
            });

            it("Should revert if insufficient ETH balance", async () => {
                const sendAmount = hre.ethers.parseEther("100"); // More than bank has
                const limit = hre.ethers.parseEther("200");

                await bank.setSendTokenLimit(hre.ethers.ZeroAddress, limit);

                await expect(
                    bank.connect(operator).sendEth(user.address, sendAmount)
                ).to.be.revertedWithCustomError(bank, "InsufficientBalance");
            });
        });
    });
});