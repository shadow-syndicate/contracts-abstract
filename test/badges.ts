const {expect} = require("chai");
const {ethers} = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("Badges", function () {
    let badges, owner, minter, withdrawRole, signer, user1, user2;

    beforeEach(async function () {
        [owner, withdrawRole, signer, minter, user1, user2] = await ethers.getSigners();

        const Badges = await ethers.getContractFactory("Badges");
        badges = await Badges.deploy(owner.address, signer, "");

        await badges.grantRole(badges.WITHDRAW_ROLE(), withdrawRole.getAddress());
        await badges.grantRole(badges.MINTER_ROLE(), minter.getAddress());
    });

    it("test", async function () {
        await badges.connect(minter).mint(user1.getAddress(), 1);
        expect(await badges.balanceOf(user1.getAddress(), 1)).to.equal(1);
        expect(await badges.balanceOf(user1.getAddress(), 2)).to.equal(0);

        await expect(
            badges.connect(minter).mint(user1, 1)
        ).to.be.revertedWithCustomError(badges, "BalanceOverflow");

        await expect(
            badges.connect(user1).safeTransferFrom(user1, user2, 1, 1, "0x")
        ).to.be.revertedWithCustomError(badges, "TransfersNotAllowed");

        await expect(
            badges.connect(user1).safeTransferFrom(user1, "0x0000000000000000000000000000000000000000", 1, 1, "0x")
        ).to.be.revertedWithCustomError(badges, "ERC1155InvalidReceiver");

        await expect(
            badges.connect(user1).safeTransferFrom(user1, user2, 2, 1, "0x")
        ).to.be.revertedWithCustomError(badges, "ERC1155InsufficientBalance");
    });
});
