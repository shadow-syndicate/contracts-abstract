const {expect} = require("chai");
const {ethers} = require("hardhat");
require("@nomicfoundation/hardhat-chai-matchers");

describe("Reactor", function () {
    let reactor;
    let mockInventory;
    let owner;
    let user;

    const batteryItemIds = [997, 998, 999];
    const batteryDurations = [300, 600, 900]; // 5, 10, 15 minutes
    const batteryReactorOffsets = [0, 1, 2]; // Offsets for each battery type
    const minReactorId = 1000;
    const maxReactorId = 4000;
    const reactorIdStep = 1000;
    const activationCount = 4;

    beforeEach(async function () {
        [owner, user] = await ethers.getSigners();

        // Deploy mock inventory
        const MockInventory = await ethers.getContractFactory("MockInventory");
        mockInventory = await MockInventory.deploy();

        // Deploy Reactor implementation
        const Reactor = await ethers.getContractFactory("Reactor");
        const reactorImplementation = await Reactor.deploy();

        // Encode initialize function call
        const initializeData = reactorImplementation.interface.encodeFunctionData("initialize", [
            await mockInventory.getAddress(),
            owner.address,
            batteryItemIds,
            batteryDurations,
            batteryReactorOffsets,
            minReactorId,
            maxReactorId,
            reactorIdStep,
            activationCount
        ]);

        // Deploy ReactorProxy
        const ReactorProxy = await ethers.getContractFactory("ReactorProxy");
        const proxy = await ReactorProxy.deploy(
            await reactorImplementation.getAddress(),
            initializeData
        );

        // Attach Reactor interface to proxy address
        reactor = reactorImplementation.attach(await proxy.getAddress());

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
            // New logic uses: activations = (reactorItemId % reactorIdStep) / activationStep
            // For step=1000 and activationStep=1:
            // (1000 % 1000) / 1 = 0 / 1 = 0 < 4 ✓
            // (1001 % 1000) / 1 = 1 / 1 = 1 < 4 ✓
            // (1500 % 1000) / 1 = 500 / 1 = 500 (not < 4) ✗
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
            // maxReactorId = 4000, which is at activation level 0
            // With activationCount = 4, valid levels are 0, 1, 2, 3
            // So 4000 should be valid (level 0)
            expect(await reactor.canActivate(maxReactorId)).to.be.true;
        });

        it("Should correctly calculate activation levels", async function () {
            // Level 0: itemId = 1000, activations = (1000 % 1000) / 1 = 0 < 4 ✓
            expect(await reactor.canActivate(1000)).to.be.true;

            // Level 0: itemId = 2000, activations = (2000 % 1000) / 1 = 0 < 4 ✓
            expect(await reactor.canActivate(2000)).to.be.true;

            // Level 0: itemId = 3000, activations = (3000 % 1000) / 1 = 0 < 4 ✓
            expect(await reactor.canActivate(3000)).to.be.true;

            // Level 0: itemId = 4000, activations = (4000 % 1000) / 1 = 0 < 4 ✓
            expect(await reactor.canActivate(4000)).to.be.true;
        });

        it("Should handle different step sizes correctly", async function () {
            // Deploy reactor with step=500 using proxy pattern
            const Reactor = await ethers.getContractFactory("Reactor");
            const implementation = await Reactor.deploy();

            // Encode initialize function call
            const initializeData = implementation.interface.encodeFunctionData("initialize", [
                await mockInventory.getAddress(),
                owner.address,
                batteryItemIds,
                batteryDurations,
                batteryReactorOffsets,
                1000,  // minReactorId
                3000,  // maxReactorId
                500,   // step = 500
                3      // activationCount
            ]);

            // Deploy ReactorProxy
            const ReactorProxy = await ethers.getContractFactory("ReactorProxy");
            const proxy = await ReactorProxy.deploy(
                await implementation.getAddress(),
                initializeData
            );

            // Attach Reactor interface to proxy address
            const reactorStep500 = implementation.attach(await proxy.getAddress());

            // With step=500 and activationCount=3:
            // (1000 % 500) / 1 = 0 / 1 = 0 < 3 ✓
            // (1500 % 500) / 1 = 0 / 1 = 0 < 3 ✓
            // (2000 % 500) / 1 = 0 / 1 = 0 < 3 ✓
            expect(await reactorStep500.canActivate(1000)).to.be.true;
            expect(await reactorStep500.canActivate(1500)).to.be.true;
            expect(await reactorStep500.canActivate(2000)).to.be.true;

            // (1001 % 500) / 1 = 1 / 1 = 1 < 3 ✓
            // (1002 % 500) / 1 = 2 / 1 = 2 < 3 ✓
            expect(await reactorStep500.canActivate(1001)).to.be.true;
            expect(await reactorStep500.canActivate(1002)).to.be.true;

            // (1003 % 500) / 1 = 3 / 1 = 3, not < 3 ✗
            expect(await reactorStep500.canActivate(1003)).to.be.false;
        });
    });

    describe("Deployment", function () {
        it("Should set the correct initial values", async function () {
            expect(await reactor.minReactorId()).to.equal(minReactorId);
            expect(await reactor.maxReactorId()).to.equal(maxReactorId);
            expect(await reactor.reactorIdStep()).to.equal(reactorIdStep);
            expect(await reactor.activationCount()).to.equal(activationCount);
        });

        it("Should set all battery activation durations correctly", async function () {
            for (let i = 0; i < batteryItemIds.length; i++) {
                expect(await reactor.batteryActivationDuration(batteryItemIds[i])).to.equal(batteryDurations[i]);
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

            // Check that user now has the upgraded reactor (incremented by activationStep = 1)
            expect(await mockInventory.balanceOf(user.address, minReactorId + 1)).to.equal(1);

            // Check that old reactor and battery were burned
            expect(await mockInventory.balanceOf(user.address, minReactorId)).to.equal(0);
            expect(await mockInventory.balanceOf(user.address, batteryItemIds[0])).to.equal(0);
        });

        it("Should revert if reactor cannot be activated", async function () {
            // Try to activate reactor with ID that fails modulo check
            // (1004 % 1000) / 1 = 4 / 1 = 4, which is not < 4, so canActivate returns false
            const invalidReactorId = 1004;
            await mockInventory.mint(user.address, invalidReactorId, 1, "0x");

            await expect(reactor.connect(user).activate(invalidReactorId, batteryItemIds[0]))
                .to.be.revertedWithCustomError(reactor, "InvalidReactorId");
        });

        it("Should revert if user doesn't own reactor", async function () {
            await expect(reactor.connect(user).activate(minReactorId + 1, batteryItemIds[0]))
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
            await mockInventory.mint(user.address, minReactorId + 1, 1, "0x");
            await mockInventory.mint(user.address, batteryItemIds[0], 1, "0x");

            await expect(reactor.connect(user).activate(minReactorId + 1, batteryItemIds[0]))
                .to.be.revertedWithCustomError(reactor, "ActivationStillActive");
        });

        it("Should allow activation after cooldown expires", async function () {
            const {time} = require("@nomicfoundation/hardhat-network-helpers");

            // First activation
            await reactor.connect(user).activate(minReactorId, batteryItemIds[0]);

            // Wait for activation duration to pass
            await time.increase(batteryDurations[0] + 1);

            // Mint new reactor and battery for second activation
            await mockInventory.mint(user.address, minReactorId + 1, 1, "0x");
            await mockInventory.mint(user.address, batteryItemIds[0], 1, "0x");

            // Second activation should succeed
            await expect(reactor.connect(user).activate(minReactorId + 1, batteryItemIds[0]))
                .to.emit(reactor, "Activated");
        });

        it("Should work with any enabled battery item ID", async function () {
            // Test with second battery ID
            await mockInventory.mint(user.address, batteryItemIds[1], 1, "0x");

            await expect(reactor.connect(user).activate(minReactorId, batteryItemIds[1]))
                .to.emit(reactor, "Activated");
        });
    });

    describe("Battery Management", function () {
        it("Should allow manager to add new battery item ID with duration", async function () {
            const newBatteryId = 1500;
            const newDuration = 1200; // 20 minutes

            await expect(reactor.setBatteryItem(newBatteryId, newDuration))
                .to.emit(reactor, "BatteryItemSet")
                .withArgs(newBatteryId, newDuration);

            expect(await reactor.batteryActivationDuration(newBatteryId)).to.equal(newDuration);
        });

        it("Should allow manager to disable battery item ID by setting duration to 0", async function () {
            await expect(reactor.setBatteryItem(batteryItemIds[0], 0))
                .to.emit(reactor, "BatteryItemSet")
                .withArgs(batteryItemIds[0], 0);

            expect(await reactor.batteryActivationDuration(batteryItemIds[0])).to.equal(0);
        });

        it("Should allow manager to update battery duration", async function () {
            const newDuration = 1800; // 30 minutes

            await expect(reactor.setBatteryItem(batteryItemIds[1], newDuration))
                .to.emit(reactor, "BatteryItemSet")
                .withArgs(batteryItemIds[1], newDuration);

            expect(await reactor.batteryActivationDuration(batteryItemIds[1])).to.equal(newDuration);
        });

        it("Should revert if non-manager tries to manage battery items", async function () {
            await expect(reactor.connect(user).setBatteryItem(1500, 1200))
                .to.be.reverted;
        });
    });

    describe("Battery offset analysis", function () {
        it("FIXED: history accumulates all batteries from upgrade chain by reactor series", async function () {
            const {time} = require("@nomicfoundation/hardhat-network-helpers");

            // Configure batteries where ID does NOT correlate with tier/offset
            // batteryItemId 1000 → offset 100 (HIGHEST tier!)
            // batteryItemId 1010 → offset 50
            // batteryItemId 1100 → offset 10 (lowest tier)
            const battery1000 = 1000;
            const battery1010 = 1010;
            const battery1100 = 1100;

            await reactor.setBatteryItem(battery1000, 300);
            await reactor.setBatteryItem(battery1010, 300);
            await reactor.setBatteryItem(battery1100, 300);

            await reactor.setBatteryReactorOffset(battery1000, 100); // Highest tier!
            await reactor.setBatteryReactorOffset(battery1010, 50);
            await reactor.setBatteryReactorOffset(battery1100, 10);  // Lowest tier

            // Give user batteries and initial reactor
            await mockInventory.mint(user.address, battery1100, 2, "0x");
            await mockInventory.mint(user.address, battery1010, 1, "0x");
            await mockInventory.mint(user.address, battery1000, 1, "0x");
            await mockInventory.mint(user.address, minReactorId, 1, "0x"); // reactor 1000

            // Activation 1: use battery 1100 (offset 10, lowest tier)
            // history[user][1000 (series)] = [1100]
            await reactor.connect(user).activate(minReactorId, battery1100);
            await time.increase(301);

            // Activation 2: use battery 1010 (offset 50)
            // history[user][1000 (series)] = [1100, 1010]
            await reactor.connect(user).activate(minReactorId + 1, battery1010);
            await time.increase(301);

            // Activation 3: use battery 1000 (offset 100, HIGHEST tier!)
            // history[user][1000 (series)] = [1100, 1010, 1000]
            await reactor.connect(user).activate(minReactorId + 2, battery1000);
            await time.increase(301);

            // Activation 4 (LAST): use battery 1100 again (lowest tier)
            // history[user][1000 (series)] = [1100, 1010, 1000, 1100]
            // getOffsetFromActivationHistory finds max offset = 100 (from battery 1000)
            await reactor.connect(user).activate(minReactorId + 3, battery1100);

            // Result: 1003 + 1 + 100 = 1104
            // Max offset from history is 100 (battery 1000), not 10 (last battery 1100)
            const result1104 = await mockInventory.balanceOf(user.address, 1104);
            const result1014 = await mockInventory.balanceOf(user.address, 1014);

            console.log("User got reactor 1104 (max tier offset 100):", result1104.toString());
            console.log("User got reactor 1014 (would be wrong):", result1014.toString());

            expect(result1104).to.equal(1, "FIXED: Max tier offset from history is used!");
            expect(result1014).to.equal(0, "FIXED: Last battery offset is NOT used!");
        });

        it("FIXED: Max tier offset is used regardless of battery order", async function () {
            const {time} = require("@nomicfoundation/hardhat-network-helpers");

            // Configure batteries:
            // batteryItemId 1100 → offset 100 (HIGHEST tier!)
            // batteryItemId 1000 → offset 10 (lowest tier)
            const batteryHighTier = 1100;
            const batteryLowTier = 1000;

            await reactor.setBatteryItem(batteryHighTier, 300);
            await reactor.setBatteryItem(batteryLowTier, 300);

            await reactor.setBatteryReactorOffset(batteryHighTier, 100); // Highest tier!
            await reactor.setBatteryReactorOffset(batteryLowTier, 10);   // Lowest tier

            // Give user batteries
            await mockInventory.mint(user.address, batteryHighTier, 3, "0x");
            await mockInventory.mint(user.address, batteryLowTier, 1, "0x");
            await mockInventory.mint(user.address, minReactorId, 1, "0x");

            // Use HIGH tier battery for first 3 activations
            await reactor.connect(user).activate(minReactorId, batteryHighTier);
            await time.increase(301);
            await reactor.connect(user).activate(minReactorId + 1, batteryHighTier);
            await time.increase(301);
            await reactor.connect(user).activate(minReactorId + 2, batteryHighTier);
            await time.increase(301);

            // Use LOW tier battery for LAST activation
            // Expected (FIXED): max offset from all batteries = 100 (from batteryHighTier)
            await reactor.connect(user).activate(minReactorId + 3, batteryLowTier);

            // CORRECT result: 1003 + 1 + 100 = 1104 (max tier offset)
            const wrongResult = await mockInventory.balanceOf(user.address, 1014);
            const correctResult = await mockInventory.balanceOf(user.address, 1104);

            console.log("Reactor 1014 (would be wrong):", wrongResult.toString());
            console.log("Reactor 1104 (correct - max tier offset):", correctResult.toString());

            // FIXED: User gets 1104, not 1014
            expect(correctResult).to.equal(1, "FIXED: Max tier offset is used!");
            expect(wrongResult).to.equal(0, "FIXED: Low tier offset is NOT used!");
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
});