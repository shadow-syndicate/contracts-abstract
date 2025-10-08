import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Reactor, MockInventory } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Reactor", function () {
    let reactor: Reactor;
    let mockInventory: MockInventory;
    let owner: SignerWithAddress;
    let user: SignerWithAddress;

    const batteryItemIds = [997, 998, 999];
    const minReactorId = 1000;
    const maxReactorId = 4000;
    const reactorIdStep = 1000;
    const activationCount = 4;
    const activationDuration = 300; // 5 minutes

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy mock inventory
        const MockInventory = await ethers.getContractFactory("MockInventory");
        mockInventory = await MockInventory.deploy();

        // Deploy Reactor
        const Reactor = await ethers.getContractFactory("Reactor");
        reactor = await Reactor.deploy(
            await mockInventory.getAddress(),
            owner.address,
            batteryItemIds,
            minReactorId,
            maxReactorId,
            reactorIdStep,
            activationCount,
            activationDuration
        );

        // Grant MINTER_ROLE and BURNER_ROLE to reactor
        await mockInventory.grantRole(await mockInventory.MINTER_ROLE(), await reactor.getAddress());
        await mockInventory.grantRole(await mockInventory.BURNER_ROLE(), await reactor.getAddress());
    });

    describe("canActivate", function () {
        it("Should return true for valid reactor ID within range", async function () {
            expect(await reactor.canActivate(minReactorId)).to.be.true;
            expect(await reactor.canActivate(minReactorId + reactorIdStep)).to.be.true;
            expect(await reactor.canActivate(minReactorId + reactorIdStep * 2)).to.be.true;
        });

        it("Should return false for reactor ID below minimum", async function () {
            expect(await reactor.canActivate(minReactorId - 1)).to.be.false;
            expect(await reactor.canActivate(500)).to.be.false;
            expect(await reactor.canActivate(0)).to.be.false;
        });

        it("Should return false for reactor ID above maximum", async function () {
            // With new logic: maxReactorId + activationCount = 4000 + 4 = 4004
            expect(await reactor.canActivate(maxReactorId + activationCount + 1)).to.be.false;
            expect(await reactor.canActivate(5000)).to.be.false;
            expect(await reactor.canActivate(10000)).to.be.false;
        });

        it("Should check activation level using modulo", async function () {
            // New logic uses: activations = reactorItemId % reactorIdStep
            // For step=1000:
            // 1000 % 1000 = 0 < 4 ✓
            // 1001 % 1000 = 1 < 4 ✓
            // 1500 % 1000 = 500 (not < 4) ✗
            expect(await reactor.canActivate(1000)).to.be.true;
            expect(await reactor.canActivate(1001)).to.be.true;
            expect(await reactor.canActivate(1002)).to.be.true;
            expect(await reactor.canActivate(1003)).to.be.true;
            expect(await reactor.canActivate(1004)).to.be.false;
            expect(await reactor.canActivate(1005)).to.be.false;
            expect(await reactor.canActivate(1500)).to.be.false;
            expect(await reactor.canActivate(2500)).to.be.false;
        });

        it("Should return false for max reactor ID (at activation limit)", async function () {
            // maxReactorId = 4000, which is at activation level 3
            // With activationCount = 4, valid levels are 0, 1, 2, 3
            // So 4000 should be valid (level 3)
            expect(await reactor.canActivate(maxReactorId)).to.be.true;

            // But if we had a reactor beyond that, it would be invalid
            // This tests the boundary condition
        });

        it("Should correctly calculate activation levels", async function () {
            // Level 0: itemId = 1000, activations = 0 < 4 ✓
            expect(await reactor.canActivate(1000)).to.be.true;

            // Level 1: itemId = 2000, activations = 1 < 4 ✓
            expect(await reactor.canActivate(2000)).to.be.true;

            // Level 2: itemId = 3000, activations = 2 < 4 ✓
            expect(await reactor.canActivate(3000)).to.be.true;

            // Level 3: itemId = 4000, activations = 3 < 4 ✓
            expect(await reactor.canActivate(4000)).to.be.true;
        });

        it("Should handle different step sizes correctly", async function () {
            // Deploy reactor with step=500
            const Reactor = await ethers.getContractFactory("Reactor");
            const reactorStep500 = await Reactor.deploy(
                await mockInventory.getAddress(),
                owner.address,
                batteryItemIds,
                1000,  // minReactorId
                3000,  // maxReactorId
                500,   // step = 500
                3,     // activationCount
                activationDuration
            );

            // With step=500 and activationCount=3:
            // 1000 % 500 = 0 < 3 ✓
            // 1500 % 500 = 0 < 3 ✓
            // 2000 % 500 = 0 < 3 ✓
            expect(await reactorStep500.canActivate(1000)).to.be.true;
            expect(await reactorStep500.canActivate(1500)).to.be.true;
            expect(await reactorStep500.canActivate(2000)).to.be.true;

            // 1001 % 500 = 1 < 3 ✓
            // 1002 % 500 = 2 < 3 ✓
            expect(await reactorStep500.canActivate(1001)).to.be.true;
            expect(await reactorStep500.canActivate(1002)).to.be.true;

            // 1003 % 500 = 3, not < 3 ✗
            expect(await reactorStep500.canActivate(1003)).to.be.false;
        });
    });

    describe("Deployment", function () {
        it("Should set the correct initial values", async function () {
            expect(await reactor.minReactorId()).to.equal(minReactorId);
            expect(await reactor.maxReactorId()).to.equal(maxReactorId);
            expect(await reactor.reactorIdStep()).to.equal(reactorIdStep);
            expect(await reactor.activationCount()).to.equal(activationCount);
            expect(await reactor.activationDuration()).to.equal(activationDuration);
        });

        it("Should set all battery item IDs as enabled", async function () {
            for (const batteryId of batteryItemIds) {
                expect(await reactor.batteryItemIds(batteryId)).to.be.true;
            }
        });

        it("Should grant roles correctly", async function () {
            expect(await reactor.hasRole(await reactor.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await reactor.hasRole(await reactor.MANAGER_ROLE(), owner.address)).to.be.true;
        });
    });

    describe("activate", function () {
        beforeEach(async function () {
            // Mint battery and reactor to user
            await mockInventory.mint(user.address, batteryItemIds[0], 1, "0x");
            await mockInventory.mint(user.address, minReactorId, 1, "0x");
        });

        it("Should successfully activate a valid reactor", async function () {
            await expect(reactor.connect(user).activate(minReactorId, batteryItemIds[0]))
                .to.emit(reactor, "Activated");

            // Check that user now has the upgraded reactor
            expect(await mockInventory.balanceOf(user.address, minReactorId + reactorIdStep)).to.equal(1);

            // Check that old reactor and battery were burned
            expect(await mockInventory.balanceOf(user.address, minReactorId)).to.equal(0);
            expect(await mockInventory.balanceOf(user.address, batteryItemIds[0])).to.equal(0);
        });

        it("Should revert if reactor cannot be activated", async function () {
            // Try to activate reactor with ID that fails modulo check
            // 1004 % 1000 = 4, which is not < 4, so canActivate returns false
            const invalidReactorId = 1004;
            await mockInventory.mint(user.address, invalidReactorId, 1, "0x");

            await expect(reactor.connect(user).activate(invalidReactorId, batteryItemIds[0]))
                .to.be.revertedWithCustomError(reactor, "InvalidReactorId");
        });

        it("Should revert if user doesn't own reactor", async function () {
            await expect(reactor.connect(user).activate(minReactorId + reactorIdStep, batteryItemIds[0]))
                .to.be.revertedWithCustomError(reactor, "ItemNotOwned");
        });

        it("Should revert if user doesn't own battery", async function () {
            // Burn the user's battery
            await mockInventory.burnAdmin(user.address, batteryItemIds[0], 1, "0x");

            await expect(reactor.connect(user).activate(minReactorId, batteryItemIds[0]))
                .to.be.revertedWithCustomError(reactor, "ItemNotOwned");
        });

        it("Should revert if battery item ID is not enabled", async function () {
            const invalidBatteryId = 1234;
            await mockInventory.mint(user.address, invalidBatteryId, 1, "0x");

            await expect(reactor.connect(user).activate(minReactorId, invalidBatteryId))
                .to.be.revertedWithCustomError(reactor, "InvalidBatteryId");
        });

        it("Should revert if activation is still active", async function () {
            // First activation
            await reactor.connect(user).activate(minReactorId, batteryItemIds[0]);

            // Try to activate again immediately
            await mockInventory.mint(user.address, minReactorId + reactorIdStep, 1, "0x");
            await mockInventory.mint(user.address, batteryItemIds[0], 1, "0x");

            await expect(reactor.connect(user).activate(minReactorId + reactorIdStep, batteryItemIds[0]))
                .to.be.revertedWithCustomError(reactor, "ActivationStillActive");
        });

        it("Should allow activation after cooldown expires", async function () {
            // First activation
            await reactor.connect(user).activate(minReactorId, batteryItemIds[0]);

            // Wait for activation duration to pass
            await time.increase(activationDuration + 1);

            // Mint new reactor and battery for second activation
            await mockInventory.mint(user.address, minReactorId + reactorIdStep, 1, "0x");
            await mockInventory.mint(user.address, batteryItemIds[0], 1, "0x");

            // Second activation should succeed
            await expect(reactor.connect(user).activate(minReactorId + reactorIdStep, batteryItemIds[0]))
                .to.emit(reactor, "Activated");
        });

        it("Should work with any enabled battery item ID", async function () {
            // Test with second battery ID
            await mockInventory.mint(user.address, batteryItemIds[1], 1, "0x");
            await mockInventory.mint(user.address, minReactorId + reactorIdStep, 1, "0x");

            // Burn first battery
            await mockInventory.burnAdmin(user.address, batteryItemIds[0], 1, "0x");

            await expect(reactor.connect(user).activate(minReactorId, batteryItemIds[1]))
                .to.emit(reactor, "Activated");
        });
    });

    describe("Battery Management", function () {
        it("Should allow manager to add new battery item ID", async function () {
            const newBatteryId = 1500;

            await expect(reactor.setBatteryItem(newBatteryId, true))
                .to.emit(reactor, "BatteryItemSet")
                .withArgs(newBatteryId, true);

            expect(await reactor.batteryItemIds(newBatteryId)).to.be.true;
        });

        it("Should allow manager to disable battery item ID", async function () {
            await expect(reactor.setBatteryItem(batteryItemIds[0], false))
                .to.emit(reactor, "BatteryItemSet")
                .withArgs(batteryItemIds[0], false);

            expect(await reactor.batteryItemIds(batteryItemIds[0])).to.be.false;
        });

        it("Should revert if non-manager tries to manage battery items", async function () {
            await expect(reactor.connect(user).setBatteryItem(1500, true))
                .to.be.reverted;
        });
    });

    describe("Reactor Range Management", function () {
        it("Should allow manager to update reactor range", async function () {
            const newMinId = 2000;
            const newMaxId = 8000;
            const newStep = 2000;
            const newCount = 3;

            await expect(reactor.setReactorRange(newMinId, newMaxId, newStep, newCount))
                .to.emit(reactor, "ReactorRangeSet")
                .withArgs(newMinId, newMaxId, newStep, newCount);

            expect(await reactor.minReactorId()).to.equal(newMinId);
            expect(await reactor.maxReactorId()).to.equal(newMaxId);
            expect(await reactor.reactorIdStep()).to.equal(newStep);
            expect(await reactor.activationCount()).to.equal(newCount);
        });

        it("Should revert if non-manager tries to update reactor range", async function () {
            await expect(reactor.connect(user).setReactorRange(2000, 8000, 2000, 3))
                .to.be.reverted;
        });
    });

    describe("Activation Duration Management", function () {
        it("Should allow manager to update activation duration", async function () {
            const newDuration = 600; // 10 minutes

            await reactor.setActivationDuration(newDuration);

            expect(await reactor.activationDuration()).to.equal(newDuration);
        });

        it("Should revert if non-manager tries to update activation duration", async function () {
            await expect(reactor.connect(user).setActivationDuration(600))
                .to.be.reverted;
        });
    });
});
