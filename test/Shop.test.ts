import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Shop, MockTRAX, MockInventory, MockERC721 } from "../typechain-types";

describe("Shop", function () {
    let shop: Shop;
    let mockTRAX: MockTRAX;
    let mockInventory: MockInventory;
    let mockLootbox: MockERC721;
    let owner: SignerWithAddress;
    let manager: SignerWithAddress;
    let withdrawer: SignerWithAddress;
    let buyer: SignerWithAddress;
    let buyer2: SignerWithAddress;

    beforeEach(async function () {
        [owner, manager, withdrawer, buyer, buyer2] = await ethers.getSigners();

        // Deploy mock contracts
        const MockTRAX = await ethers.getContractFactory("MockTRAX");
        mockTRAX = await MockTRAX.deploy();

        const MockInventory = await ethers.getContractFactory("MockInventory");
        mockInventory = await MockInventory.deploy();

        const MockERC721 = await ethers.getContractFactory("MockERC721");
        mockLootbox = await MockERC721.deploy("Lootbox", "LB");

        // Deploy Shop
        const Shop = await ethers.getContractFactory("Shop");
        shop = await Shop.deploy(
            await mockTRAX.getAddress(),
            await mockInventory.getAddress(),
            await mockLootbox.getAddress(),
            owner.address,
            withdrawer.address
        );

        // Grant MINTER_ROLE to shop in inventory
        await mockInventory.grantRole(await mockInventory.MINTER_ROLE(), await shop.getAddress());
    });

    describe("Deployment", function () {
        it("Should set the correct roles", async function () {
            expect(await shop.hasRole(await shop.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await shop.hasRole(await shop.MANAGER_ROLE(), owner.address)).to.be.true;
            expect(await shop.hasRole(await shop.WITHDRAW_ROLE(), withdrawer.address)).to.be.true;
        });

        it("Should set the correct contract addresses", async function () {
            expect(await shop.trax()).to.equal(await mockTRAX.getAddress());
            expect(await shop.inventory()).to.equal(await mockInventory.getAddress());
            expect(await shop.lootbox()).to.equal(await mockLootbox.getAddress());
        });
    });

    describe("Lot Management", function () {
        const lotId = 1;
        const priceInTrax = ethers.parseEther("100");
        const priceInTraxTurbo = ethers.parseEther("80");
        const itemIds = [101, 102, 103];
        const itemCounts = [1, 2, 3];
        const restrictedItems = [200, 201];
        let startTime: number;
        let deadline: number;

        beforeEach(async function () {
            startTime = await time.latest();
            deadline = startTime + 86400; // 24 hours
        });

        describe("createLot", function () {
            it("Should create a lot successfully", async function () {
                await expect(shop.createLot(
                    lotId,
                    priceInTrax,
                    priceInTraxTurbo,
                    startTime,
                    deadline,
                    itemIds,
                    itemCounts,
                    restrictedItems
                ))
                    .to.emit(shop, "LotCreated")
                    .withArgs(lotId, priceInTrax, priceInTraxTurbo, startTime, deadline);

                const lot = await shop.getLot(lotId);
                expect(lot.priceInTrax).to.equal(priceInTrax);
                expect(lot.priceInTraxTurbo).to.equal(priceInTraxTurbo);
                expect(lot.startTime).to.equal(startTime);
                expect(lot.deadline).to.equal(deadline);
                expect(lot.itemIds).to.deep.equal(itemIds);
                expect(lot.itemCounts).to.deep.equal(itemCounts);
                expect(lot.restrictedItems).to.deep.equal(restrictedItems);
            });

            it("Should revert if arrays length mismatch", async function () {
                await expect(shop.createLot(
                    lotId,
                    priceInTrax,
                    priceInTraxTurbo,
                    startTime,
                    deadline,
                    itemIds,
                    [1, 2], // Mismatched length
                    restrictedItems
                )).to.be.revertedWithCustomError(shop, "ArraysLengthMismatch");
            });

            it("Should revert if not MANAGER_ROLE", async function () {
                await expect(shop.connect(buyer).createLot(
                    lotId,
                    priceInTrax,
                    priceInTraxTurbo,
                    startTime,
                    deadline,
                    itemIds,
                    itemCounts,
                    restrictedItems
                )).to.be.reverted;
            });
        });

        describe("updateLot", function () {
            beforeEach(async function () {
                await shop.createLot(
                    lotId,
                    priceInTrax,
                    priceInTraxTurbo,
                    startTime,
                    deadline,
                    itemIds,
                    itemCounts,
                    restrictedItems
                );
            });

            it("Should update a lot successfully", async function () {
                const newPrice = ethers.parseEther("150");
                const newPriceTurbo = ethers.parseEther("120");
                const newStartTime = startTime + 3600;
                const newDeadline = deadline + 3600;
                const newItemIds = [104, 105];
                const newItemCounts = [4, 5];
                const newRestrictedItems = [202];

                await expect(shop.updateLot(
                    lotId,
                    newPrice,
                    newPriceTurbo,
                    newStartTime,
                    newDeadline,
                    newItemIds,
                    newItemCounts,
                    newRestrictedItems
                ))
                    .to.emit(shop, "LotUpdated")
                    .withArgs(lotId, newPrice, newPriceTurbo, newStartTime, newDeadline);

                const lot = await shop.getLot(lotId);
                expect(lot.priceInTrax).to.equal(newPrice);
                expect(lot.priceInTraxTurbo).to.equal(newPriceTurbo);
                expect(lot.startTime).to.equal(newStartTime);
                expect(lot.deadline).to.equal(newDeadline);
                expect(lot.itemIds).to.deep.equal(newItemIds);
                expect(lot.itemCounts).to.deep.equal(newItemCounts);
                expect(lot.restrictedItems).to.deep.equal(newRestrictedItems);
            });
        });
    });

    describe("Purchases", function () {
        const lotId = 1;
        const priceInTrax = ethers.parseEther("100");
        const priceInTraxTurbo = ethers.parseEther("80");
        const itemIds = [101, 102];
        const itemCounts = [1, 2];
        const restrictedItems = [200];
        let startTime: number;
        let deadline: number;

        beforeEach(async function () {
            startTime = await time.latest();
            deadline = startTime + 86400;

            // Create a lot
            await shop.createLot(
                lotId,
                priceInTrax,
                priceInTraxTurbo,
                startTime,
                deadline,
                itemIds,
                itemCounts,
                restrictedItems
            );

            // Setup buyer with TRAX
            await mockTRAX.mint(buyer.address, ethers.parseEther("1000"));
            await mockTRAX.connect(buyer).approve(await shop.getAddress(), ethers.MaxUint256);
        });

        describe("buyForTRAX", function () {
            it("Should process purchase successfully", async function () {
                const signId = 1;
                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTRAX(
                    lotId,
                    1, // count
                    priceInTrax,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
                ))
                    .to.emit(shop, "Purchase")
                    .withArgs(buyer.address, lotId, priceInTrax, signId);

                expect(await shop.totalCollected()).to.equal(priceInTrax);

                // Check items were minted
                expect(await mockInventory.balanceOf(buyer.address, itemIds[0])).to.equal(itemCounts[0]);
                expect(await mockInventory.balanceOf(buyer.address, itemIds[1])).to.equal(itemCounts[1]);
            });

            it("Should process purchase with count > 1 successfully", async function () {
                // Create a lot without restricted items
                const noRestrictedLotId = 10;
                await shop.createLot(
                    noRestrictedLotId,
                    priceInTrax,
                    priceInTraxTurbo,
                    startTime,
                    deadline,
                    itemIds,
                    itemCounts,
                    [] // No restricted items
                );

                const count = 3;
                const totalPrice = priceInTrax * BigInt(count);
                const signId = 1;
                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTRAX(
                    noRestrictedLotId,
                    count,
                    totalPrice,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
                ))
                    .to.emit(shop, "Purchase")
                    .withArgs(buyer.address, noRestrictedLotId, totalPrice, signId);

                expect(await shop.totalCollected()).to.equal(totalPrice);

                // Check items were minted with multiplied counts
                expect(await mockInventory.balanceOf(buyer.address, itemIds[0])).to.equal(itemCounts[0] * count);
                expect(await mockInventory.balanceOf(buyer.address, itemIds[1])).to.equal(itemCounts[1] * count);
            });

            it("Should revert if count > 1 with restricted items", async function () {
                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTRAX(
                    lotId,
                    2, // count > 1
                    priceInTrax * 2n,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "RestrictedItemsCannotBeBulkPurchased");
            });

            it("Should revert if lot doesn't exist", async function () {
                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTRAX(
                    999, // Non-existent lot
                    1,
                    priceInTrax,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "InvalidLot");
            });

            it("Should revert if insufficient payment", async function () {
                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTRAX(
                    lotId,
                    1,
                    ethers.parseEther("50"), // Less than required
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "InsufficientPayment");
            });

            it("Should revert if insufficient payment for count > 1", async function () {
                const noRestrictedLotId = 11;
                await shop.createLot(
                    noRestrictedLotId,
                    priceInTrax,
                    priceInTraxTurbo,
                    startTime,
                    deadline,
                    itemIds,
                    itemCounts,
                    []
                );

                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };
                const count = 3;
                const insufficientAmount = priceInTrax * BigInt(count - 1);

                await expect(shop.connect(buyer).buyForTRAX(
                    noRestrictedLotId,
                    count,
                    insufficientAmount,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "InsufficientPayment");
            });

            it("Should revert if lot not active yet", async function () {
                const futureStartTime = (await time.latest()) + 3600;
                const futureLotId = 2;

                await shop.createLot(
                    futureLotId,
                    priceInTrax,
                    priceInTraxTurbo,
                    futureStartTime,
                    futureStartTime + 86400,
                    itemIds,
                    itemCounts,
                    []
                );

                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTRAX(
                    futureLotId,
                    1,
                    priceInTrax,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "LotNotActive");
            });

            it("Should revert if lot expired", async function () {
                await time.increase(86401); // Move past deadline

                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTRAX(
                    lotId,
                    1,
                    priceInTrax,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "LotNotActive");
            });

            it("Should revert if buyer owns restricted item", async function () {
                // Mint restricted item to buyer
                await mockInventory.mint(buyer.address, restrictedItems[0], 1, "0x");

                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTRAX(
                    lotId,
                    1,
                    priceInTrax,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "AlreadyOwnsRestrictedItem");
            });
        });

        describe("buyForTraxTurbo", function () {
            beforeEach(async function () {
                // Mint lootbox to buyer
                await mockLootbox.mint(buyer.address, 1);
            });

            it("Should process turbo purchase successfully", async function () {
                const signId = 1;
                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTraxTurbo(
                    lotId,
                    1, // count
                    priceInTraxTurbo,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
                ))
                    .to.emit(shop, "Purchase")
                    .withArgs(buyer.address, lotId, priceInTraxTurbo, signId);

                expect(await shop.totalCollected()).to.equal(priceInTraxTurbo);
            });

            it("Should process turbo purchase with count > 1 successfully", async function () {
                // Create a lot without restricted items
                const noRestrictedLotId = 12;
                await shop.createLot(
                    noRestrictedLotId,
                    priceInTrax,
                    priceInTraxTurbo,
                    startTime,
                    deadline,
                    itemIds,
                    itemCounts,
                    [] // No restricted items
                );

                const count = 2;
                const totalPrice = priceInTraxTurbo * BigInt(count);
                const signId = 1;
                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTraxTurbo(
                    noRestrictedLotId,
                    count,
                    totalPrice,
                    signId,
                    sig.v,
                    sig.r,
                    sig.s
                ))
                    .to.emit(shop, "Purchase")
                    .withArgs(buyer.address, noRestrictedLotId, totalPrice, signId);

                expect(await shop.totalCollected()).to.equal(totalPrice);

                // Check items were minted with multiplied counts
                expect(await mockInventory.balanceOf(buyer.address, itemIds[0])).to.equal(itemCounts[0] * count);
                expect(await mockInventory.balanceOf(buyer.address, itemIds[1])).to.equal(itemCounts[1] * count);
            });

            it("Should revert if count > 1 with restricted items", async function () {
                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTraxTurbo(
                    lotId,
                    3, // count > 1
                    priceInTraxTurbo * 3n,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "RestrictedItemsCannotBeBulkPurchased");
            });

            it("Should revert if no lootbox ownership", async function () {
                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer2).buyForTraxTurbo(
                    lotId,
                    1,
                    priceInTraxTurbo,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "NoLootboxOwnership");
            });

            it("Should revert if insufficient payment for count > 1", async function () {
                const noRestrictedLotId = 13;
                await shop.createLot(
                    noRestrictedLotId,
                    priceInTrax,
                    priceInTraxTurbo,
                    startTime,
                    deadline,
                    itemIds,
                    itemCounts,
                    []
                );

                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };
                const count = 4;
                const insufficientAmount = priceInTraxTurbo * BigInt(count - 1);

                await expect(shop.connect(buyer).buyForTraxTurbo(
                    noRestrictedLotId,
                    count,
                    insufficientAmount,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                )).to.be.revertedWithCustomError(shop, "InsufficientPayment");
            });

            it("Should allow free turbo purchase when turbo price is 0", async function () {
                const freeTurboLotId = 3;
                await shop.createLot(
                    freeTurboLotId,
                    priceInTrax,
                    0, // Free turbo price
                    startTime,
                    deadline,
                    itemIds,
                    itemCounts,
                    []
                );

                const sig = { v: 27, r: ethers.ZeroHash, s: ethers.ZeroHash };

                await expect(shop.connect(buyer).buyForTraxTurbo(
                    freeTurboLotId,
                    1,
                    0,
                    1,
                    sig.v,
                    sig.r,
                    sig.s
                ))
                    .to.emit(shop, "Purchase")
                    .withArgs(buyer.address, freeTurboLotId, 0, 1);

                // Check items were minted
                expect(await mockInventory.balanceOf(buyer.address, itemIds[0])).to.equal(itemCounts[0]);
                expect(await mockInventory.balanceOf(buyer.address, itemIds[1])).to.equal(itemCounts[1]);
            });
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to set lootbox", async function () {
            const newLootbox = await ethers.getContractFactory("MockERC721");
            const newLootboxContract = await newLootbox.deploy("NewLootbox", "NLB");

            await shop.setLootbox(await newLootboxContract.getAddress());
            expect(await shop.lootbox()).to.equal(await newLootboxContract.getAddress());
        });

        it("Should revert if non-admin tries to set lootbox", async function () {
            await expect(shop.connect(buyer).setLootbox(ethers.ZeroAddress))
                .to.be.reverted;
        });
    });
});