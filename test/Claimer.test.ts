import { expect } from "chai";
import { Wallet } from "zksync-ethers";
import * as hre from "hardhat";
import { Deployer } from "@matterlabs/hardhat-zksync";
import "@nomicfoundation/hardhat-chai-matchers";

// Use ZKsync's default rich wallet for local testing
const RICH_WALLET_PK = "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";

describe("Claimer", function () {
    let deployer: Deployer;
    let wallet: Wallet;
    let signer: Wallet;
    let user: Wallet;
    let claimer: any;
    let testToken: any;
    let admin: string;

    const SIGNER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("SIGNER_ROLE"));
    const WITHDRAW_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("WITHDRAW_ROLE"));

    // Helper function to create a signature for claiming ERC20 tokens (with fee)
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
                ["uint256", "address", "address", "uint256", "uint256", "uint256", "address"],
                [signId, account, token, value, fee, deadline, contractAddress]
            )
        );

        // Sign the hash directly without EIP-191 prefix
        const sig = signerWallet.signingKey.sign(messageHash);

        return {
            v: sig.v,
            r: sig.r,
            s: sig.s
        };
    }

    // Helper function to create a signature for claiming ETH (no fee)
    async function createClaimEthSignature(
        signId: number,
        account: string,
        value: bigint,
        deadline: number,
        contractAddress: string,
        signerWallet: Wallet
    ) {
        const messageHash = hre.ethers.keccak256(
            hre.ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "address", "address", "uint256", "uint256", "address"],
                [signId, account, hre.ethers.ZeroAddress, value, deadline, contractAddress]
            )
        );

        // Sign the hash directly without EIP-191 prefix
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

        // Deploy TestToken (allows transfers for testing claim and withdraw)
        const tokenArtifact = await deployer.loadArtifact("TestToken");
        testToken = await deployer.deploy(tokenArtifact, []);

        // Deploy TRAX token (for testing claimTrax)
        const traxArtifact = await deployer.loadArtifact("TRAX");
        const traxToken = await deployer.deploy(traxArtifact, [
            admin,
            admin,
            signer.address
        ]);

        // Deploy Claimer contract
        const claimerArtifact = await deployer.loadArtifact("Claimer");
        claimer = await deployer.deploy(claimerArtifact, [
            admin,
            signer.address,
            await traxToken.getAddress()
        ]);

        // Mint test tokens to the claimer contract
        await testToken.mint(await claimer.getAddress(), hre.ethers.parseEther("1000"));

        // Grant MINTER_ROLE to claimer for TRAX minting
        const MINTER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("MINTER_ROLE"));
        await traxToken.grantRole(MINTER_ROLE, await claimer.getAddress());
    });

    describe("Deployment", () => {
        it("Should grant admin, signer, and withdraw roles correctly", async () => {
            const DEFAULT_ADMIN_ROLE = hre.ethers.ZeroHash;
            expect(await claimer.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
            expect(await claimer.hasRole(SIGNER_ROLE, signer.address)).to.be.true;
            expect(await claimer.hasRole(WITHDRAW_ROLE, admin)).to.be.true;
        });

        it("Should have the correct token balance", async () => {
            const balance = await claimer.getBalance(await testToken.getAddress());
            expect(balance).to.equal(hre.ethers.parseEther("1000"));
        });
    });

    describe("Claiming", () => {
        it("Should allow user to claim tokens with valid signature and fee", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const fee = hre.ethers.parseEther("0.01");
            const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            const signId = 1;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                fee,
                deadline,
                await claimer.getAddress(),
                signer
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    fee,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s,
                    { value: fee }
                )
            )
                .to.emit(claimer, "Claimed")
                .withArgs(user.address, tokenAddress, claimAmount, deadline, signId);

            // Verify user received the tokens
            expect(await testToken.balanceOf(user.address)).to.equal(claimAmount);

            // Verify signId is marked as used
            expect(await claimer.isSignIdUsed(signId)).to.be.true;
        });

        it("Should revert if insufficient fee is sent", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const fee = hre.ethers.parseEther("0.01");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 1;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                fee,
                deadline,
                await claimer.getAddress(),
                signer
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    fee,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s,
                    { value: hre.ethers.parseEther("0.005") } // Insufficient fee
                )
            ).to.be.revertedWithCustomError(claimer, "InsufficientFee");
        });

        it("Should revert if signature is invalid", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const fee = hre.ethers.parseEther("0.01");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 2;

            // Create signature with wrong signer (wallet instead of signer)
            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                fee,
                deadline,
                await claimer.getAddress(),
                wallet // Wrong signer!
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    fee,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s,
                    { value: fee }
                )
            ).to.be.revertedWithCustomError(claimer, "InvalidSignature");
        });

        it("Should revert if deadline has expired", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const fee = hre.ethers.parseEther("0.01");

            // Get current block timestamp and set deadline to be in the past
            const currentBlock = await hre.ethers.provider.getBlock('latest');
            const deadline = currentBlock!.timestamp - 1; // 1 second before current block
            const signId = 3;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                fee,
                deadline,
                await claimer.getAddress(),
                signer
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    fee,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s,
                    { value: fee }
                )
            ).to.be.revertedWithCustomError(claimer, "DeadlineExpired");
        });

        it("Should revert if signId is already used", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const fee = hre.ethers.parseEther("0.01");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 4;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                fee,
                deadline,
                await claimer.getAddress(),
                signer
            );

            const claimerWithUser = claimer.connect(user);

            // First claim should succeed
            await claimerWithUser.claim(
                user.address,
                tokenAddress,
                claimAmount,
                fee,
                deadline,
                signId,
                sig.v,
                sig.r,
                sig.s,
                { value: fee }
            );

            // Second claim with same signId should fail
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    fee,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s,
                    { value: fee }
                )
            ).to.be.revertedWithCustomError(claimer, "SignIdAlreadyUsed");
        });

        it("Should revert if contract has insufficient balance", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("2000"); // More than contract has
            const fee = hre.ethers.parseEther("0.01");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 5;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                fee,
                deadline,
                await claimer.getAddress(),
                signer
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    fee,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s,
                    { value: fee }
                )
            ).to.be.revertedWithCustomError(claimer, "InsufficientBalance");
        });

        it("Should revert if value is zero", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = 0n;
            const fee = hre.ethers.parseEther("0.01");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 6;

            const sig = await createClaimSignature(
                signId,
                user.address,
                tokenAddress,
                claimAmount,
                fee,
                deadline,
                await claimer.getAddress(),
                signer
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    fee,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s,
                    { value: fee }
                )
            ).to.be.revertedWithCustomError(claimer, "ZeroValue");
        });
    });

    describe("Withdrawal", () => {
        it("Should allow admin to withdraw specific amount", async () => {
            const tokenAddress = await testToken.getAddress();
            const withdrawAmount = hre.ethers.parseEther("100");

            await expect(
                claimer.withdraw(tokenAddress, admin, withdrawAmount)
            )
                .to.emit(claimer, "Withdrawn")
                .withArgs(tokenAddress, admin, withdrawAmount);

            expect(await testToken.balanceOf(admin)).to.equal(withdrawAmount);
        });

        it("Should allow admin to withdraw all tokens", async () => {
            const tokenAddress = await testToken.getAddress();
            const balance = await claimer.getBalance(tokenAddress);

            await expect(
                claimer.connect(wallet).withdrawAll(tokenAddress)
            )
                .to.emit(claimer, "Withdrawn")
                .withArgs(tokenAddress, admin, balance);

            expect(await testToken.balanceOf(admin)).to.equal(balance);
            expect(await claimer.getBalance(tokenAddress)).to.equal(0);
        });

        it("Should revert if non-admin tries to withdraw", async () => {
            const tokenAddress = await testToken.getAddress();
            const withdrawAmount = hre.ethers.parseEther("100");

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.withdraw(tokenAddress, user.address, withdrawAmount)
            ).to.be.reverted;
        });
    });
});