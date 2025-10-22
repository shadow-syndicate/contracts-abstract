import { expect } from "chai";
import { Wallet } from "zksync-ethers";
import * as hre from "hardhat";
import { Deployer } from "@matterlabs/hardhat-zksync";
import { vars } from "hardhat/config";

const RICH_WALLET_PK = vars.get("DEPLOYER_PRIVATE_KEY");

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

    // Helper function to create a signature for claiming
    async function createClaimSignature(
        account: string,
        token: string,
        value: bigint,
        deadline: number,
        signId: number,
        signerWallet: Wallet
    ) {
        const messageHash = hre.ethers.keccak256(
            hre.ethers.AbiCoder.defaultAbiCoder().encode(
                ["address", "address", "uint256", "uint256", "uint256"],
                [account, token, value, deadline, signId]
            )
        );

        const messageHashBytes = hre.ethers.getBytes(messageHash);
        const signature = await signerWallet.signMessage(messageHashBytes);
        const sig = hre.ethers.Signature.from(signature);

        return {
            v: sig.v,
            r: sig.r,
            s: sig.s
        };
    }

    beforeEach(async () => {
        wallet = new Wallet(RICH_WALLET_PK);
        admin = await wallet.getAddress();
        signer = Wallet.createRandom().connect(wallet.provider);
        user = Wallet.createRandom().connect(wallet.provider);
        deployer = new Deployer(hre, wallet);

        // Deploy a test ERC20 token
        const tokenArtifact = await deployer.loadArtifact("TRAX");
        testToken = await deployer.deploy(tokenArtifact, [
            "Test Token",
            "TEST",
            18,
            admin,
            admin
        ]);

        // Deploy Claimer contract
        const claimerArtifact = await deployer.loadArtifact("Claimer");
        claimer = await deployer.deploy(claimerArtifact, [
            admin,
            signer.address
        ]);

        // Mint some tokens to the claimer contract
        await testToken.mint(await claimer.getAddress(), hre.ethers.parseEther("1000"));
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
        it("Should allow user to claim tokens with valid signature", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            const signId = 1;

            const sig = await createClaimSignature(
                user.address,
                tokenAddress,
                claimAmount,
                deadline,
                signId,
                signer
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
                )
            )
                .to.emit(claimer, "Claimed")
                .withArgs(user.address, tokenAddress, claimAmount, deadline, signId);

            // Verify user received the tokens
            expect(await testToken.balanceOf(user.address)).to.equal(claimAmount);

            // Verify signId is marked as used
            expect(await claimer.isSignIdUsed(signId)).to.be.true;
        });

        it("Should revert if signature is invalid", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 2;

            // Create signature with wrong signer (wallet instead of signer)
            const sig = await createClaimSignature(
                user.address,
                tokenAddress,
                claimAmount,
                deadline,
                signId,
                wallet // Wrong signer!
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
                )
            ).to.be.revertedWithCustomError(claimer, "InvalidSignature");
        });

        it("Should revert if deadline has expired", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) - 1; // Already expired
            const signId = 3;

            const sig = await createClaimSignature(
                user.address,
                tokenAddress,
                claimAmount,
                deadline,
                signId,
                signer
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
                )
            ).to.be.revertedWithCustomError(claimer, "DeadlineExpired");
        });

        it("Should revert if signId is already used", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("100");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 4;

            const sig = await createClaimSignature(
                user.address,
                tokenAddress,
                claimAmount,
                deadline,
                signId,
                signer
            );

            const claimerWithUser = claimer.connect(user);

            // First claim should succeed
            await claimerWithUser.claim(
                user.address,
                tokenAddress,
                claimAmount,
                deadline,
                signId,
                sig.v,
                sig.r,
                sig.s
            );

            // Second claim with same signId should fail
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
                )
            ).to.be.revertedWithCustomError(claimer, "SignIdAlreadyUsed");
        });

        it("Should revert if contract has insufficient balance", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = hre.ethers.parseEther("2000"); // More than contract has
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 5;

            const sig = await createClaimSignature(
                user.address,
                tokenAddress,
                claimAmount,
                deadline,
                signId,
                signer
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
                )
            ).to.be.revertedWithCustomError(claimer, "InsufficientBalance");
        });

        it("Should revert if value is zero", async () => {
            const tokenAddress = await testToken.getAddress();
            const claimAmount = 0n;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 6;

            const sig = await createClaimSignature(
                user.address,
                tokenAddress,
                claimAmount,
                deadline,
                signId,
                signer
            );

            const claimerWithUser = claimer.connect(user);
            await expect(
                claimerWithUser.claim(
                    user.address,
                    tokenAddress,
                    claimAmount,
                    deadline,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
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
                claimer.withdrawAll(tokenAddress, admin)
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