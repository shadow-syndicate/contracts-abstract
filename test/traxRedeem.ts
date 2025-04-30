const {expect} = require("chai");
const {ethers} = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("TraxRedeem", function () {
    let traxExchange, trax, usdc, owner, minter, setPriceRole, withdrawRole, signer, user1, user2, traxRedeem;
    const rawBytes32 = "0x" + "00".repeat(32);

    beforeEach(async function () {
        [owner, minter, setPriceRole, withdrawRole, signer, user1, user2] = await ethers.getSigners();

        const Trax = await ethers.getContractFactory("TraxTest");
        trax = await Trax.deploy(owner.address, minter.address, signer);

        const TraxExchange = await ethers.getContractFactory("TraxExchange");
        traxExchange = await TraxExchange.deploy(trax.getAddress(), owner.address, setPriceRole.address, withdrawRole.address);

        await trax.grantRole(trax.MINTER_ROLE(), traxExchange.getAddress());

        const TestToken = await ethers.getContractFactory("TestToken");
        usdc = await TestToken.deploy();

        await traxExchange.connect(setPriceRole).setPrice(usdc.getAddress(), 70_000); // 1 TRAX = 0.07 USDC

        const TraxRedeem = await ethers.getContractFactory("TraxRedeem");
        traxRedeem = await TraxRedeem.deploy(
            trax.getAddress(),
            traxExchange.getAddress(),
            usdc.getAddress(),
            owner.address,
            withdrawRole.address);

        await traxExchange.grantRole(traxExchange.WITHDRAW_ROLE(), traxRedeem.getAddress());
    });

    it("Buy/Redeem happy path", async function () {
        await usdc.mint(user1, 10_000_000);
        expect(await usdc.balanceOf(user1)).to.equal(10_000_000n);

        await usdc.connect(user1).approve(traxExchange.getAddress(), 8_000_000);

        expect(await traxExchange.connect(user1).getTraxCost(usdc.getAddress(), 10)).to.equal(700_000n);

        await traxExchange.connect(user1).buyTrax(usdc.getAddress(), 10);

        expect(await usdc.balanceOf(user1)).to.equal(9_300_000n);
        expect(await trax.balanceOf(user1)).to.equal(ethers.parseUnits("10", 18));

        await trax.connect(user1).approve(traxRedeem.getAddress(), ethers.parseUnits("2", 18));
        await traxRedeem.connect(user1).redeem(ethers.parseUnits("2", 18), 1, 0, 0, rawBytes32, rawBytes32);

        expect(await usdc.balanceOf(user1)).to.equal(9_440_000n);
        expect(await usdc.balanceOf(traxExchange)).to.equal(0);
        expect(await usdc.balanceOf(traxRedeem)).to.equal(560_000n);
        expect(await trax.balanceOf(user1)).to.equal(ethers.parseUnits("8", 18));
        expect(await trax.balanceOf(traxExchange)).to.equal(0);
        expect(await trax.balanceOf(traxRedeem)).to.equal(0);


        await trax.connect(user1).approve(traxRedeem.getAddress(), ethers.parseUnits("8", 18));
        await trax.connect(user1).use(ethers.parseUnits("3", 18), 2, 0, 0, rawBytes32, rawBytes32);
        expect(await trax.balanceOf(user1)).to.equal(ethers.parseUnits("5", 18));
        expect(await traxRedeem.getReservedBalance()).to.equal(5n * 70_000n);
        expect(await traxRedeem.getAvailableBalance()).to.equal(3n * 70_000n);

        await traxRedeem.connect(withdrawRole).withdraw();
        expect(await traxRedeem.getReservedBalance()).to.equal(5n * 70_000n);
        expect(await traxRedeem.getAvailableBalance()).to.equal(0);
        expect(await usdc.balanceOf(withdrawRole)).to.equal(3n * 70_000n);
    });

    it("low funds", async function () {
        await trax.connect(minter).mint(user1, ethers.parseUnits("3", 18));

        await usdc.mint(traxExchange, 100_000);
        await usdc.mint(traxRedeem, 100_000);
        await trax.connect(user1).approve(traxRedeem.getAddress(), ethers.parseUnits("3", 18))

        await expect(
            // need 210,000 USDC
            traxRedeem.connect(user1).redeem(ethers.parseUnits("3", 18), 1, 0, 0, rawBytes32, rawBytes32)
        ).to.be.revertedWithCustomError(traxRedeem, "LowReserves");
    });

    it("low reserves", async function () {
        await trax.connect(minter).mint(user1, ethers.parseUnits("3", 18));
        await trax.connect(minter).mint(user2, ethers.parseUnits("2", 18));

        await usdc.mint(traxExchange, 100_000);
        await usdc.mint(traxRedeem, 100_000);
        await trax.connect(user1).approve(traxRedeem.getAddress(), ethers.parseUnits("1", 18))

        await expect(
            // need 5x70,000 USDC
            traxRedeem.connect(user1).redeem(ethers.parseUnits("1", 18), 1, 0, 0, rawBytes32, rawBytes32)
        ).to.be.revertedWithCustomError(traxRedeem, "LowReserves");

        await expect(
            traxRedeem.connect(withdrawRole).withdraw()
        ).to.be.revertedWithCustomError(traxRedeem, "LowReserves");

        await usdc.mint(traxExchange, 150_000);
        // now reserves are ok
        await traxRedeem.connect(user1).redeem(ethers.parseUnits("1", 18), 1, 0, 0, rawBytes32, rawBytes32);
        await traxRedeem.connect(withdrawRole).withdraw() // sends 0
        expect(await usdc.balanceOf(withdrawRole)).to.equal(0n);
    });

    it("severeal stages", async function () {
        await trax.connect(minter).mint(user1, ethers.parseUnits("3", 18));

        await usdc.mint(traxExchange, 110_000);
        await usdc.mint(traxRedeem, 100_000);

        await trax.connect(user1).approve(traxRedeem.getAddress(), ethers.parseUnits("2", 18));
        await traxRedeem.connect(user1).redeem(ethers.parseUnits("1", 18), 1, 0, 0, rawBytes32, rawBytes32);

        expect(await usdc.balanceOf(user1)).to.equal(70_000n);
        expect(await usdc.balanceOf(traxExchange)).to.equal(110_000n);
        expect(await usdc.balanceOf(traxRedeem)).to.equal(30_000n);
        expect(await trax.balanceOf(user1)).to.equal(ethers.parseUnits("2", 18));
        expect(await trax.balanceOf(traxExchange)).to.equal(0);
        expect(await trax.balanceOf(traxRedeem)).to.equal(0);
    });

    it("low trax balance", async function () {
        await trax.connect(minter).mint(user1, ethers.parseUnits("1", 18));

        await usdc.mint(traxExchange, 110_000);
        await usdc.mint(traxRedeem, 100_000);

        await trax.connect(user1).approve(traxRedeem.getAddress(), ethers.parseUnits("2", 18));
        await expect(
            traxRedeem.connect(user1).redeem(ethers.parseUnits("2", 18), 1, 0, 0, rawBytes32, rawBytes32)
        ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientBalance");
    });

    it("low trax balance", async function () {
        await trax.connect(minter).mint(user1, ethers.parseUnits("1", 18));

        await usdc.mint(traxExchange, 110_000);
        await usdc.mint(traxRedeem, 100_000);

        await trax.connect(user1).approve(traxRedeem.getAddress(), ethers.parseUnits("2", 18));
        await traxRedeem.connect(owner).withdrawAll()
        expect(await usdc.balanceOf(owner)).to.equal(100_000n);
    });

    it("access", async function () {
        await usdc.mint(traxExchange, 110_000);
        await usdc.mint(traxRedeem, 100_000);

        await expect(
            traxRedeem.connect(withdrawRole).withdrawAll()
        ).to.be.revertedWithCustomError(traxRedeem, "AccessControlUnauthorizedAccount");
        await expect(
            traxRedeem.connect(user1).withdrawAll()
        ).to.be.revertedWithCustomError(traxRedeem, "AccessControlUnauthorizedAccount");
        await expect(
            traxRedeem.connect(user1).withdraw()
        ).to.be.revertedWithCustomError(traxRedeem, "AccessControlUnauthorizedAccount");
    });

});
