import { expect } from "chai";
import { Wallet } from "zksync-ethers";
import * as hre from "hardhat";
import { Deployer } from "@matterlabs/hardhat-zksync";
import "@nomicfoundation/hardhat-chai-matchers";

// Use ZKsync's default rich wallet for local testing
const RICH_WALLET_PK = "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";

describe("RetroDrop", function () {
    let deployer: Deployer;
    let wallet: Wallet;
    let signer: Wallet;
    let user: Wallet;
    let retroDrop: any;
    let roachToken: any;
    let votingEscrow: any;
    let admin: string;

    const SIGNER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("SIGNER_ROLE"));
    const WITHDRAW_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("WITHDRAW_ROLE"));

    // Helper function to create a signature for claiming
    async function createClaimSignature(
        signId: number,
        account: string,
        roachMax: bigint,
        deadline: number,
        chainId: bigint,
        contractAddress: string,
        signerWallet: Wallet
    ) {
        const messageHash = hre.ethers.keccak256(
            hre.ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256", "address", "uint256", "uint256", "uint256", "address"],
                [signId, account, roachMax, deadline, chainId, contractAddress]
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

        // Fund the user wallet with ETH for gas
        await wallet.sendTransaction({
            to: user.address,
            value: hre.ethers.parseEther("10")
        });

        // Deploy TestToken as ROACH
        const tokenArtifact = await deployer.loadArtifact("TestToken");
        roachToken = await deployer.deploy(tokenArtifact, []);

        // Deploy mock VotingEscrow
        const veArtProxyArtifact = await deployer.loadArtifact("VeArtProxy");
        const veArtProxy = await deployer.deploy(veArtProxyArtifact, []);

        const votingEscrowArtifact = await deployer.loadArtifact("VotingEscrow");
        votingEscrow = await deployer.deploy(votingEscrowArtifact, [
            await roachToken.getAddress(),
            await veArtProxy.getAddress()
        ]);

        // Deploy RetroDrop contract
        const retroDropArtifact = await deployer.loadArtifact("RetroDrop");
        retroDrop = await deployer.deploy(retroDropArtifact, [
            admin,
            signer.address,
            await roachToken.getAddress(),
            await votingEscrow.getAddress()
        ]);

        // Mint ROACH tokens to the RetroDrop contract
        await roachToken.mint(await retroDrop.getAddress(), hre.ethers.parseEther("10000"));
    });

    describe("Deployment", () => {
        it("Should grant admin, signer, and withdraw roles correctly", async () => {
            const DEFAULT_ADMIN_ROLE = hre.ethers.ZeroHash;
            expect(await retroDrop.hasRole(DEFAULT_ADMIN_ROLE, admin)).to.be.true;
            expect(await retroDrop.hasRole(SIGNER_ROLE, signer.address)).to.be.true;
            expect(await retroDrop.hasRole(WITHDRAW_ROLE, admin)).to.be.true;
        });

        it("Should have the correct ROACH balance", async () => {
            const balance = await retroDrop.getRoachBalance();
            expect(balance).to.equal(hre.ethers.parseEther("10000"));
        });

        it("Should have approved VotingEscrow", async () => {
            const allowance = await roachToken.allowance(
                await retroDrop.getAddress(),
                await votingEscrow.getAddress()
            );
            expect(allowance).to.equal(hre.ethers.MaxUint256);
        });
    });

    describe("Amount Calculation", () => {
        it("Should return 100% for 208 weeks", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const amount = await retroDrop.calculateAmount(roachMax, 208);
            // sqrt(209/209) = 1, so should be ~100%
            expect(amount).to.equal(roachMax);
        });

        it("Should return ~6.92% for 0 weeks", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const amount = await retroDrop.calculateAmount(roachMax, 0);
            // sqrt(1/209) ≈ 0.0692
            // Expected: ~69.2 tokens
            const expected = hre.ethers.parseEther("69.2");
            const tolerance = hre.ethers.parseEther("1"); // 1 token tolerance
            expect(amount).to.be.closeTo(expected, tolerance);
        });

        it("Should return ~50% for 52 weeks", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const amount = await retroDrop.calculateAmount(roachMax, 52);
            // sqrt(53/209) ≈ 0.5036
            // Expected: ~503.6 tokens
            const expected = hre.ethers.parseEther("503.6");
            const tolerance = hre.ethers.parseEther("5");
            expect(amount).to.be.closeTo(expected, tolerance);
        });

        it("Should return ~70.87% for 104 weeks", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const amount = await retroDrop.calculateAmount(roachMax, 104);
            // sqrt(105/209) ≈ 0.7087
            // Expected: ~708.7 tokens
            const expected = hre.ethers.parseEther("708.7");
            const tolerance = hre.ethers.parseEther("5");
            expect(amount).to.be.closeTo(expected, tolerance);
        });

        it("previewClaim should return same as calculateAmount", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const calcAmount = await retroDrop.calculateAmount(roachMax, 52);
            const previewAmount = await retroDrop.previewClaim(roachMax, 52);
            expect(calcAmount).to.equal(previewAmount);
        });

        it("previewClaim should return 0 for invalid lockWeeks", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const amount = await retroDrop.previewClaim(roachMax, 209);
            expect(amount).to.equal(0);
        });
    });

    describe("Claiming with lockWeeks=0 (direct transfer)", () => {
        it("Should transfer tokens directly for lockWeeks=0", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 1;
            const chainId = (await hre.ethers.provider.getNetwork()).chainId;

            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                chainId,
                await retroDrop.getAddress(),
                signer
            );

            const retroDropWithUser = retroDrop.connect(user);
            const tx = await retroDropWithUser.claim(
                0, // lockWeeks
                signId,
                roachMax,
                deadline,
                sig.v,
                sig.r,
                sig.s
            );

            const receipt = await tx.wait();

            // Check user received tokens
            const userBalance = await roachToken.balanceOf(user.address);
            const expectedAmount = await retroDrop.calculateAmount(roachMax, 0);
            expect(userBalance).to.equal(expectedAmount);

            // Verify signId is marked as used
            expect(await retroDrop.isSignIdUsed(signId)).to.be.true;
        });

        it("Should emit Claimed event with tokenId=0 for direct transfer", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 2;
            const chainId = (await hre.ethers.provider.getNetwork()).chainId;

            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                chainId,
                await retroDrop.getAddress(),
                signer
            );

            const expectedAmount = await retroDrop.calculateAmount(roachMax, 0);

            await expect(
                retroDrop.connect(user).claim(0, signId, roachMax, deadline, sig.v, sig.r, sig.s)
            )
                .to.emit(retroDrop, "Claimed")
                .withArgs(user.address, signId, roachMax, 0, expectedAmount, 0);
        });
    });

    describe("Claiming with lockWeeks>0 (VotingEscrow)", () => {
        it("Should create veNFT lock for lockWeeks>0", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const lockWeeks = 52;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 3;
            const chainId = (await hre.ethers.provider.getNetwork()).chainId;

            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                chainId,
                await retroDrop.getAddress(),
                signer
            );

            const tx = await retroDrop.connect(user).claim(
                lockWeeks,
                signId,
                roachMax,
                deadline,
                sig.v,
                sig.r,
                sig.s
            );

            const receipt = await tx.wait();

            // User should own the veNFT (tokenId 1)
            const veNftOwner = await votingEscrow.ownerOf(1);
            expect(veNftOwner).to.equal(user.address);

            // User should not have liquid ROACH tokens
            const userBalance = await roachToken.balanceOf(user.address);
            expect(userBalance).to.equal(0);
        });

        it("Should emit Claimed event with correct tokenId", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const lockWeeks = 104;
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 4;
            const chainId = (await hre.ethers.provider.getNetwork()).chainId;

            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                chainId,
                await retroDrop.getAddress(),
                signer
            );

            const expectedAmount = await retroDrop.calculateAmount(roachMax, lockWeeks);

            await expect(
                retroDrop.connect(user).claim(lockWeeks, signId, roachMax, deadline, sig.v, sig.r, sig.s)
            )
                .to.emit(retroDrop, "Claimed")
                .withArgs(user.address, signId, roachMax, lockWeeks, expectedAmount, 1); // tokenId = 1
        });
    });

    describe("Validation Errors", () => {
        it("Should revert if lockWeeks > 208", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 10;
            const chainId = (await hre.ethers.provider.getNetwork()).chainId;

            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                chainId,
                await retroDrop.getAddress(),
                signer
            );

            await expect(
                retroDrop.connect(user).claim(209, signId, roachMax, deadline, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(retroDrop, "InvalidLockWeeks");
        });

        it("Should revert if deadline has expired", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const currentBlock = await hre.ethers.provider.getBlock('latest');
            const deadline = currentBlock!.timestamp - 1;
            const signId = 11;
            const chainId = (await hre.ethers.provider.getNetwork()).chainId;

            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                chainId,
                await retroDrop.getAddress(),
                signer
            );

            await expect(
                retroDrop.connect(user).claim(0, signId, roachMax, deadline, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(retroDrop, "DeadlineExpired");
        });

        it("Should revert if signId is already used", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 12;
            const chainId = (await hre.ethers.provider.getNetwork()).chainId;

            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                chainId,
                await retroDrop.getAddress(),
                signer
            );

            // First claim should succeed
            await retroDrop.connect(user).claim(0, signId, roachMax, deadline, sig.v, sig.r, sig.s);

            // Second claim with same signId should fail
            await expect(
                retroDrop.connect(user).claim(0, signId, roachMax, deadline, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(retroDrop, "SignIdAlreadyUsed");
        });

        it("Should revert if signature is invalid (wrong signer)", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 13;
            const chainId = (await hre.ethers.provider.getNetwork()).chainId;

            // Sign with wallet instead of signer
            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                chainId,
                await retroDrop.getAddress(),
                wallet // Wrong signer!
            );

            await expect(
                retroDrop.connect(user).claim(0, signId, roachMax, deadline, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(retroDrop, "InvalidSignature");
        });

        it("Should revert if contract has insufficient balance", async () => {
            const roachMax = hre.ethers.parseEther("100000"); // More than contract has
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 14;
            const chainId = (await hre.ethers.provider.getNetwork()).chainId;

            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                chainId,
                await retroDrop.getAddress(),
                signer
            );

            await expect(
                retroDrop.connect(user).claim(208, signId, roachMax, deadline, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(retroDrop, "InsufficientBalance");
        });

        it("Should revert if wrong chainId in signature", async () => {
            const roachMax = hre.ethers.parseEther("1000");
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const signId = 15;
            const wrongChainId = 999n;

            const sig = await createClaimSignature(
                signId,
                user.address,
                roachMax,
                deadline,
                wrongChainId, // Wrong chainId
                await retroDrop.getAddress(),
                signer
            );

            await expect(
                retroDrop.connect(user).claim(0, signId, roachMax, deadline, sig.v, sig.r, sig.s)
            ).to.be.revertedWithCustomError(retroDrop, "InvalidSignature");
        });
    });

    describe("Withdrawal", () => {
        it("Should allow admin to withdraw specific amount", async () => {
            const withdrawAmount = hre.ethers.parseEther("100");

            await expect(
                retroDrop.withdraw(admin, withdrawAmount)
            )
                .to.emit(retroDrop, "Withdrawn")
                .withArgs(admin, withdrawAmount);

            expect(await roachToken.balanceOf(admin)).to.equal(withdrawAmount);
        });

        it("Should allow admin to withdraw all tokens", async () => {
            const balance = await retroDrop.getRoachBalance();

            await expect(
                retroDrop.connect(wallet).withdrawAll()
            )
                .to.emit(retroDrop, "Withdrawn")
                .withArgs(admin, balance);

            expect(await roachToken.balanceOf(admin)).to.equal(balance);
            expect(await retroDrop.getRoachBalance()).to.equal(0);
        });

        it("Should revert if non-admin tries to withdraw", async () => {
            const withdrawAmount = hre.ethers.parseEther("100");

            await expect(
                retroDrop.connect(user).withdraw(user.address, withdrawAmount)
            ).to.be.reverted;
        });

        it("Should revert withdraw with zero address", async () => {
            await expect(
                retroDrop.withdraw(hre.ethers.ZeroAddress, hre.ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(retroDrop, "ZeroAddress");
        });

        it("Should revert withdraw with zero amount", async () => {
            await expect(
                retroDrop.withdraw(admin, 0)
            ).to.be.revertedWithCustomError(retroDrop, "ZeroValue");
        });
    });
});