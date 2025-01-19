const { expect } = require("chai");
const { ethers } = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("SafeMathExample", function () {
    let traxExchange, trax, testToken, owner, minter, setPriceRole, withdrawRole, user1, user2;

    beforeEach(async function () {
        [owner, minter, setPriceRole, withdrawRole, user1, user2] = await ethers.getSigners();

        const Trax = await ethers.getContractFactory("TRAX");
        trax = await Trax.deploy(owner.address, minter.address);

        console.log(trax.address);

        const TraxExchange = await ethers.getContractFactory("TraxExchange");
        traxExchange = await TraxExchange.deploy(trax.getAddress(), owner.address, setPriceRole.address, withdrawRole.address);

        await trax.grantRole('0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6', traxExchange.getAddress());

        const TestToken = await ethers.getContractFactory("TestToken");
        testToken = await TestToken.deploy();
    });

    it("Buy trax happy path", async function () {
        await testToken.mint(user1, 10_000_000);
        expect(await testToken.balanceOf(user1)).to.equal(10_000_000n);

        await traxExchange.connect(setPriceRole).setPrice(testToken.getAddress(), 2_000_000);

        await testToken.connect(user1).approve(traxExchange.getAddress(), 8_000_000);


        expect(await traxExchange.connect(user1).getTraxCost(testToken.getAddress(), 3)).to.equal(6_000_000n);

        await traxExchange.connect(user1).buyTrax(testToken.getAddress(), 3);

        expect(await testToken.balanceOf(user1)).to.equal(4_000_000n);
        expect(await trax.balanceOf(user1)).to.equal(ethers.parseUnits("3", 18));
    });

    it("Buy trax limitatons", async function () {
        await testToken.mint(user1, 10_000_000);
        expect(await testToken.balanceOf(user1)).to.equal(10_000_000n);
        await traxExchange.connect(setPriceRole).setPrice(testToken.getAddress(), 2_000_000);
        await testToken.connect(user1).approve(traxExchange.getAddress(), 8_000_000);

        await expect(
            traxExchange.connect(user1).buyTrax(testToken.getAddress(), 0)
        ).to.be.revertedWith("Min traxValueWithoutDecimals is 1 TRAX");
    });

    it("Mint limit", async function () {
        const testMinter = trax.connect(minter);
        await testMinter.mint(user1.address, ethers.parseUnits("10000", 18));

        await expect(
            testMinter.mint(user1.address, ethers.parseUnits("10001", 18))
        ).to.be.revertedWith("Mint limit exceeded");

        await trax.connect(owner).setMintLimit(ethers.parseUnits("10001", 18));

        await testMinter.mint(user1.address, ethers.parseUnits("10001", 18));

    });

});
