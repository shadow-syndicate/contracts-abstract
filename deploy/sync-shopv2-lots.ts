import {HardhatRuntimeEnvironment} from "hardhat/types";
import {Wallet} from "zksync-ethers";
import {getConfig, REACTOR_CONFIG, SHOP_LOTS, SHOP_CONFIG} from "./config";
import {getDeployerPrivateKey} from "./utils/deployUtils";
import * as readline from "readline";

interface LotChange {
    lotId: number;
    action: 'create' | 'update' | 'unchanged' | 'delete';
    differences?: string[];
    currentLot?: any;
    expectedData?: any;
}

export default async function (hre: HardhatRuntimeEnvironment) {
    const wallet = new Wallet(getDeployerPrivateKey(hre), hre.ethers.provider);

    console.log("Syncing ShopV2 lots with configuration... 🔄");

    // Load environment-specific configuration
    const config = getConfig();

    // Validate required contract addresses
    if (!config.contracts.inventoryProxy) {
        throw new Error("Inventory contract address not configured for this environment");
    }

    // Get ShopV2 contract address (env var overrides config)
    const shopV2Address = process.env.SHOP_V2_ADDRESS || config.contracts.shopV2;
    if (!shopV2Address) {
        throw new Error("ShopV2 contract address not configured. Either set SHOP_V2_ADDRESS environment variable or update config.ts");
    }

    console.log(`Connected to ShopV2 at: ${shopV2Address}\n`);

    const shop = await hre.ethers.getContractAt("ShopV2", shopV2Address, wallet);

    // Define lot parameters
    const now = Math.floor(Date.now() / 1000);
    const endTime = now + (300 * 24 * 60 * 60); // 300 days

    // STEP 1: Analyze all lots and collect changes
    console.log("📊 Analyzing differences...\n");

    const changes: LotChange[] = [];

    for (const lotConfig of SHOP_LOTS) {
        const lotId = lotConfig.lotId;

        // Get current lot from contract
        let currentLot;
        try {
            currentLot = await shop.getLot(lotId);
        } catch (error) {
            currentLot = null;
        }

        // Expected values from config
        const expectedPriceInAcid = hre.ethers.parseEther(lotConfig.priceInAcid);
        const expectedPriceInRoach = hre.ethers.parseEther(lotConfig.priceInRoach);
        const expectedItemIds = lotConfig.itemIds(REACTOR_CONFIG);
        const expectedAmounts = lotConfig.amounts;
        const expectedRestrictedItems = lotConfig.restrictedItems(REACTOR_CONFIG);

        const expectedData = {
            priceInAcid: expectedPriceInAcid,
            priceInRoach: expectedPriceInRoach,
            itemIds: expectedItemIds,
            amounts: expectedAmounts,
            restrictedItems: expectedRestrictedItems,
            startTime: now,
            endTime: endTime
        };

        // Check if lot needs to be created or updated
        if (!currentLot || currentLot.priceInAcid === 0n) {
            // Needs creation
            changes.push({
                lotId,
                action: 'create',
                expectedData,
                differences: [
                    `Price ACID: ${lotConfig.priceInAcid}`,
                    `Price ROACH: ${lotConfig.priceInRoach}`,
                    `Items: ${expectedItemIds.join(', ')}`,
                    `Amounts: ${expectedAmounts.join(', ')}`,
                    `Restricted: ${expectedRestrictedItems.length > 0 ? expectedRestrictedItems.join(', ') : 'none'}`
                ]
            });
        } else {
            // Compare with existing lot
            const differences: string[] = [];

            if (currentLot.priceInAcid !== expectedPriceInAcid) {
                differences.push(`Price ACID: ${hre.ethers.formatEther(currentLot.priceInAcid)} → ${lotConfig.priceInAcid}`);
            }
            if (currentLot.priceInRoach !== expectedPriceInRoach) {
                differences.push(`Price ROACH: ${hre.ethers.formatEther(currentLot.priceInRoach)} → ${lotConfig.priceInRoach}`);
            }
            if (!arraysEqual(currentLot.itemIds, expectedItemIds)) {
                differences.push(`Item IDs: [${currentLot.itemIds.join(', ')}] → [${expectedItemIds.join(', ')}]`);
            }
            if (!arraysEqual(currentLot.itemCounts, expectedAmounts)) {
                differences.push(`Amounts: [${currentLot.itemCounts.join(', ')}] → [${expectedAmounts.join(', ')}]`);
            }
            if (!arraysEqual(currentLot.restrictedItems, expectedRestrictedItems)) {
                const currentRestricted = currentLot.restrictedItems.length > 0 ? currentLot.restrictedItems.join(', ') : 'none';
                const expectedRestricted = expectedRestrictedItems.length > 0 ? expectedRestrictedItems.join(', ') : 'none';
                differences.push(`Restricted: [${currentRestricted}] → [${expectedRestricted}]`);
            }

            if (differences.length > 0) {
                changes.push({
                    lotId,
                    action: 'update',
                    differences,
                    currentLot,
                    expectedData
                });
            } else {
                changes.push({
                    lotId,
                    action: 'unchanged'
                });
            }
        }
    }

    // Check for deleted lots (exist on-chain but not in config)
    const configuredLotIds = new Set(SHOP_LOTS.map(lot => lot.lotId));

    for (let lotId = SHOP_CONFIG.minLotId; lotId <= SHOP_CONFIG.maxLotId; lotId++) {
        // Skip if this lot is in our config
        if (configuredLotIds.has(lotId)) {
            continue;
        }

        // Check if lot exists on-chain
        try {
            const currentLot = await shop.getLot(lotId);

            // If lot exists and has non-zero price, it should be deleted
            if (currentLot && currentLot.priceInAcid > 0n) {
                changes.push({
                    lotId,
                    action: 'delete',
                    currentLot,
                    differences: [
                        `Price ACID: ${hre.ethers.formatEther(currentLot.priceInAcid)}`,
                        `Price ROACH: ${hre.ethers.formatEther(currentLot.priceInRoach)}`,
                        `Items: ${currentLot.itemIds.join(', ')}`,
                        `Amounts: ${currentLot.itemCounts.join(', ')}`
                    ]
                });
            }
        } catch (error) {
            // Lot doesn't exist, skip
        }
    }

    // STEP 2: Display summary
    const toCreate = changes.filter(c => c.action === 'create');
    const toUpdate = changes.filter(c => c.action === 'update');
    const toDelete = changes.filter(c => c.action === 'delete');
    const unchanged = changes.filter(c => c.action === 'unchanged');

    console.log("═══════════════════════════════════════════════════════");
    console.log("                    CHANGE SUMMARY");
    console.log("═══════════════════════════════════════════════════════\n");

    if (toCreate.length > 0) {
        console.log(`➕ LOTS TO CREATE (${toCreate.length}):`);
        for (const change of toCreate) {
            console.log(`\n  Lot ${change.lotId}:`);
            change.differences?.forEach(diff => console.log(`    • ${diff}`));
        }
        console.log();
    }

    if (toUpdate.length > 0) {
        console.log(`🔄 LOTS TO UPDATE (${toUpdate.length}):`);
        for (const change of toUpdate) {
            console.log(`\n  Lot ${change.lotId}:`);
            change.differences?.forEach(diff => console.log(`    • ${diff}`));
        }
        console.log();
    }

    if (toDelete.length > 0) {
        console.log(`🗑️  LOTS TO DELETE (${toDelete.length}):`);
        for (const change of toDelete) {
            console.log(`\n  Lot ${change.lotId} (not in config):`);
            change.differences?.forEach(diff => console.log(`    • ${diff}`));
        }
        console.log();
    }

    if (unchanged.length > 0) {
        console.log(`✓ LOTS UNCHANGED (${unchanged.length}): ${unchanged.map(c => c.lotId).join(', ')}\n`);
    }

    console.log("═══════════════════════════════════════════════════════\n");

    // STEP 3: Ask for confirmation
    if (toCreate.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
        console.log("✅ All lots are already in sync. Nothing to do!");
        return;
    }

    const confirmed = await askConfirmation(`\nProceed with ${toCreate.length} creation(s), ${toUpdate.length} update(s), and ${toDelete.length} deletion(s)?`);

    if (!confirmed) {
        console.log("\n❌ Sync cancelled by user.");
        return;
    }

    // STEP 4: Execute changes
    console.log("\n⚙️  Executing changes...\n");

    let created = 0;
    let updated = 0;
    let deleted = 0;

    for (const change of changes) {
        if (change.action === 'create') {
            console.log(`➕ Creating lot ${change.lotId}...`);
            const tx = await shop.createLot(
                change.lotId,
                change.expectedData!.priceInAcid,
                change.expectedData!.priceInRoach,
                change.expectedData!.startTime,
                change.expectedData!.endTime,
                change.expectedData!.itemIds,
                change.expectedData!.amounts,
                change.expectedData!.restrictedItems
            );
            await tx.wait();
            console.log(`  ✅ Created lot ${change.lotId}`);
            created++;
        } else if (change.action === 'update') {
            console.log(`🔄 Updating lot ${change.lotId}...`);
            const tx = await shop.updateLot(
                change.lotId,
                change.expectedData!.priceInAcid,
                change.expectedData!.priceInRoach,
                change.currentLot!.startTime, // Keep original start time
                change.currentLot!.deadline,  // Keep original deadline
                change.expectedData!.itemIds,
                change.expectedData!.amounts,
                change.expectedData!.restrictedItems
            );
            await tx.wait();
            console.log(`  ✅ Updated lot ${change.lotId}`);
            updated++;
        } else if (change.action === 'delete') {
            console.log(`🗑️  Deleting lot ${change.lotId}...`);
            // Delete by setting prices to 0 and deadline to 0
            const tx = await shop.updateLot(
                change.lotId,
                0, // priceInAcid
                0, // priceInRoach
                0, // startTime
                0, // deadline
                [], // empty itemIds
                [], // empty itemCounts
                []  // empty restrictedItems
            );
            await tx.wait();
            console.log(`  ✅ Deleted lot ${change.lotId}`);
            deleted++;
        }
    }

    console.log(`\n✅ Sync Complete!`);
    console.log(`  Created: ${created} lot(s)`);
    console.log(`  Updated: ${updated} lot(s)`);
    console.log(`  Deleted: ${deleted} lot(s)`);
    console.log(`  Unchanged: ${unchanged.length} lot(s)`);
    console.log(`  Total configured: ${SHOP_LOTS.length} lot(s)`);
}

/**
 * Ask user for confirmation
 */
async function askConfirmation(question: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(`${question} (y/N): `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

/**
 * Helper function to compare two arrays of BigInts or numbers
 */
function arraysEqual(arr1: any[], arr2: any[]): boolean {
    if (arr1.length !== arr2.length) return false;

    for (let i = 0; i < arr1.length; i++) {
        // Convert to BigInt for comparison if needed
        const val1 = typeof arr1[i] === 'bigint' ? arr1[i] : BigInt(arr1[i]);
        const val2 = typeof arr2[i] === 'bigint' ? arr2[i] : BigInt(arr2[i]);

        if (val1 !== val2) return false;
    }

    return true;
}
