import {HardhatRuntimeEnvironment} from "hardhat/types";
import {ethers} from "hardhat";
import {getConfig, SOULBOUND_TOKENS, INVENTORY_TOKEN_LIMITS, RESTRICTED_ITEMS} from "./config";
import {createDeployer, isZkSyncNetwork} from "./utils/deployUtils";
import * as readline from "readline";

interface SoulboundChange {
    tokenId: number;
    action: 'disable' | 'enable' | 'unchanged';
    currentState: boolean;
    expectedState: boolean;
}

interface LimitChange {
    tokenId: number;
    action: 'set' | 'unchanged';
    currentLimit: bigint;
    expectedLimit: number;
}

interface RestrictedChange {
    tokenId: number;
    action: 'set' | 'unchanged';
    currentRestricted: number[];
    expectedRestricted: number[];
}

export default async function (hre: HardhatRuntimeEnvironment) {
    const deployer = await createDeployer(hre);
    const signer = deployer.getSigner();

    console.log(`Syncing Inventory configuration${isZkSyncNetwork(hre) ? ' (zkSync)' : ' (EVM)'}... 🔄\n`);

    // Load environment-specific configuration
    const config = getConfig();

    // Get Inventory contract address (env var overrides config)
    const inventoryAddress = process.env.INVENTORY_ADDRESS || config.contracts.inventoryProxy;
    if (!inventoryAddress) {
        throw new Error("Inventory contract address not configured. Either set INVENTORY_ADDRESS environment variable or update config.ts");
    }

    console.log(`Connected to Inventory at: ${inventoryAddress}\n`);

    const inventory = await ethers.getContractAt("Inventory", inventoryAddress, signer);

    // STEP 1: Analyze soulbound tokens
    console.log("📊 Analyzing soulbound tokens...");
    const soulboundChanges: SoulboundChange[] = [];

    // Get all unique token IDs to check (from config + potentially on-chain)
    const allTokenIds = new Set<number>();
    SOULBOUND_TOKENS.forEach(id => allTokenIds.add(id));
    INVENTORY_TOKEN_LIMITS.forEach(({tokenId}) => allTokenIds.add(tokenId));
    RESTRICTED_ITEMS.forEach(({tokenId}) => allTokenIds.add(tokenId));

    const soulboundSet = new Set(SOULBOUND_TOKENS);

    for (const tokenId of allTokenIds) {
        const currentState = await inventory.transfersDisabled(tokenId);
        const expectedState = soulboundSet.has(tokenId);

        if (currentState !== expectedState) {
            soulboundChanges.push({
                tokenId,
                action: expectedState ? 'disable' : 'enable',
                currentState,
                expectedState
            });
        } else {
            soulboundChanges.push({
                tokenId,
                action: 'unchanged',
                currentState,
                expectedState
            });
        }
    }

    // STEP 2: Analyze token limits
    console.log("📊 Analyzing token limits...");
    const limitChanges: LimitChange[] = [];

    for (const {tokenId, maxBalancePerOwner} of INVENTORY_TOKEN_LIMITS) {
        const currentLimit = await inventory.maxBalancePerOwner(tokenId);
        const expectedLimit = maxBalancePerOwner;

        if (currentLimit !== BigInt(expectedLimit)) {
            limitChanges.push({
                tokenId,
                action: 'set',
                currentLimit,
                expectedLimit
            });
        } else {
            limitChanges.push({
                tokenId,
                action: 'unchanged',
                currentLimit,
                expectedLimit
            });
        }
    }

    // STEP 3: Analyze restricted items
    console.log("📊 Analyzing restricted items...\n");
    const restrictedChanges: RestrictedChange[] = [];

    for (const {tokenId, restricted} of RESTRICTED_ITEMS) {
        const currentRestricted = await inventory.getRestrictedItems(tokenId);
        const currentRestrictedArray = currentRestricted.map(id => Number(id));
        const expectedRestricted = restricted;

        if (!arraysEqual(currentRestrictedArray, expectedRestricted)) {
            restrictedChanges.push({
                tokenId,
                action: 'set',
                currentRestricted: currentRestrictedArray,
                expectedRestricted
            });
        } else {
            restrictedChanges.push({
                tokenId,
                action: 'unchanged',
                currentRestricted: currentRestrictedArray,
                expectedRestricted
            });
        }
    }

    // STEP 4: Display summary
    const soulboundToDisable = soulboundChanges.filter(c => c.action === 'disable');
    const soulboundToEnable = soulboundChanges.filter(c => c.action === 'enable');
    const soulboundUnchanged = soulboundChanges.filter(c => c.action === 'unchanged');

    const limitsToSet = limitChanges.filter(c => c.action === 'set');
    const limitsUnchanged = limitChanges.filter(c => c.action === 'unchanged');

    const restrictedToSet = restrictedChanges.filter(c => c.action === 'set');
    const restrictedUnchanged = restrictedChanges.filter(c => c.action === 'unchanged');

    console.log("═══════════════════════════════════════════════════════");
    console.log("                  CHANGE SUMMARY");
    console.log("═══════════════════════════════════════════════════════\n");

    // Soulbound tokens summary
    console.log("🔒 SOULBOUND TOKENS (Transfer Restrictions):");
    if (soulboundToDisable.length > 0) {
        console.log(`\n  ➕ To Make Soulbound (${soulboundToDisable.length}):`);
        console.log(`     Token IDs: ${soulboundToDisable.map(c => c.tokenId).join(', ')}`);
    }
    if (soulboundToEnable.length > 0) {
        console.log(`\n  ➖ To Remove Soulbound (${soulboundToEnable.length}):`);
        console.log(`     Token IDs: ${soulboundToEnable.map(c => c.tokenId).join(', ')}`);
    }
    if (soulboundUnchanged.length > 0) {
        const soulbound = soulboundUnchanged.filter(c => c.currentState).length;
        const transferable = soulboundUnchanged.filter(c => !c.currentState).length;
        console.log(`\n  ✓ Unchanged: ${soulboundUnchanged.length} tokens (${soulbound} soulbound, ${transferable} transferable)`);
    }
    console.log();

    // Token limits summary
    console.log("📊 TOKEN LIMITS (Max Balance Per Owner):");
    if (limitsToSet.length > 0) {
        console.log(`\n  🔄 To Update (${limitsToSet.length}):`);
        for (const change of limitsToSet.slice(0, 10)) { // Show first 10
            console.log(`     Token ${change.tokenId}: ${change.currentLimit.toString()} → ${change.expectedLimit}`);
        }
        if (limitsToSet.length > 10) {
            console.log(`     ... and ${limitsToSet.length - 10} more`);
        }
    }
    if (limitsUnchanged.length > 0) {
        console.log(`\n  ✓ Unchanged: ${limitsUnchanged.length} tokens`);
    }
    console.log();

    // Restricted items summary
    console.log("🚫 RESTRICTED ITEMS (Mutually Exclusive Ownership):");
    if (restrictedToSet.length > 0) {
        console.log(`\n  🔄 To Update (${restrictedToSet.length}):`);
        for (const change of restrictedToSet.slice(0, 5)) { // Show first 5
            console.log(`     Token ${change.tokenId}:`);
            console.log(`       Current: [${change.currentRestricted.join(', ') || 'none'}]`);
            console.log(`       Expected: [${change.expectedRestricted.join(', ') || 'none'}]`);
        }
        if (restrictedToSet.length > 5) {
            console.log(`     ... and ${restrictedToSet.length - 5} more`);
        }
    }
    if (restrictedUnchanged.length > 0) {
        console.log(`\n  ✓ Unchanged: ${restrictedUnchanged.length} tokens`);
    }
    console.log();

    console.log("═══════════════════════════════════════════════════════\n");

    // STEP 5: Ask for confirmation
    const totalChanges = soulboundToDisable.length + soulboundToEnable.length + limitsToSet.length + restrictedToSet.length;

    if (totalChanges === 0) {
        console.log("✅ All inventory configurations are already in sync. Nothing to do!");
        return;
    }

    const confirmed = await askConfirmation(
        `\nProceed with ${soulboundToDisable.length} make soulbound, ${soulboundToEnable.length} remove soulbound, ${limitsToSet.length} limit update(s), and ${restrictedToSet.length} restriction update(s)?`
    );

    if (!confirmed) {
        console.log("\n❌ Sync cancelled by user.");
        return;
    }

    // STEP 6: Execute changes
    console.log("\n⚙️  Executing changes...\n");

    let soulboundDisabled = 0;
    let soulboundEnabled = 0;
    let limitsUpdated = 0;
    let restrictionsUpdated = 0;

    // Update soulbound tokens - batch by ranges for efficiency
    if (soulboundToDisable.length > 0) {
        console.log(`🔒 Disabling transfers for ${soulboundToDisable.length} token(s)...`);
        const ranges = findRanges(soulboundToDisable.map(c => c.tokenId));

        for (const range of ranges) {
            if (range.start === range.end) {
                const tx = await inventory.disableTransfer([range.start]);
                await tx.wait();
                console.log(`  ✅ Disabled transfers for token ${range.start}`);
                soulboundDisabled++;
            } else {
                const tx = await inventory.disableTransferRange(range.start, range.end);
                await tx.wait();
                console.log(`  ✅ Disabled transfers for tokens ${range.start}-${range.end}`);
                soulboundDisabled += (range.end - range.start + 1);
            }
        }
    }

    if (soulboundToEnable.length > 0) {
        console.log(`🔓 Enabling transfers for ${soulboundToEnable.length} token(s)...`);
        const ranges = findRanges(soulboundToEnable.map(c => c.tokenId));

        for (const range of ranges) {
            if (range.start === range.end) {
                const tx = await inventory.enableTransfer([range.start]);
                await tx.wait();
                console.log(`  ✅ Enabled transfers for token ${range.start}`);
                soulboundEnabled++;
            } else {
                const tx = await inventory.enableTransferRange(range.start, range.end);
                await tx.wait();
                console.log(`  ✅ Enabled transfers for tokens ${range.start}-${range.end}`);
                soulboundEnabled += (range.end - range.start + 1);
            }
        }
    }

    // Update token limits - use batch function
    if (limitsToSet.length > 0) {
        console.log(`📊 Updating token limits for ${limitsToSet.length} token(s)...`);

        // Process in batches of 50 to avoid gas limits
        const batchSize = 50;
        for (let i = 0; i < limitsToSet.length; i += batchSize) {
            const batch = limitsToSet.slice(i, i + batchSize);
            const tokenIds = batch.map(c => c.tokenId);
            const maxBalances = batch.map(c => c.expectedLimit);

            const tx = await inventory.setMaxBalancePerOwnerBatch(tokenIds, maxBalances);
            await tx.wait();
            console.log(`  ✅ Updated limits for ${batch.length} token(s) (batch ${Math.floor(i / batchSize) + 1})`);
            limitsUpdated += batch.length;
        }
    }

    // Update restricted items - use batch function
    if (restrictedToSet.length > 0) {
        console.log(`🚫 Updating restricted items for ${restrictedToSet.length} token(s)...`);

        // Process in batches of 20 (smaller due to nested arrays)
        const batchSize = 20;
        for (let i = 0; i < restrictedToSet.length; i += batchSize) {
            const batch = restrictedToSet.slice(i, i + batchSize);
            const tokenIds = batch.map(c => c.tokenId);
            const restrictedArrays = batch.map(c => c.expectedRestricted);

            const tx = await inventory.setRestrictedItemsBatch(tokenIds, restrictedArrays);
            await tx.wait();
            console.log(`  ✅ Updated restrictions for ${batch.length} token(s) (batch ${Math.floor(i / batchSize) + 1})`);
            restrictionsUpdated += batch.length;
        }
    }

    console.log(`\n✅ Sync Complete!`);
    console.log(`  Made soulbound: ${soulboundDisabled} token(s)`);
    console.log(`  Removed soulbound: ${soulboundEnabled} token(s)`);
    console.log(`  Limits updated: ${limitsUpdated} token(s)`);
    console.log(`  Restrictions updated: ${restrictionsUpdated} token(s)`);
    console.log(`  Total unchanged: ${soulboundUnchanged.length + limitsUnchanged.length + restrictedUnchanged.length} config(s)`);
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
 * Helper function to compare two arrays
 */
function arraysEqual(arr1: number[], arr2: number[]): boolean {
    if (arr1.length !== arr2.length) return false;

    const sorted1 = [...arr1].sort((a, b) => a - b);
    const sorted2 = [...arr2].sort((a, b) => a - b);

    for (let i = 0; i < sorted1.length; i++) {
        if (sorted1[i] !== sorted2[i]) return false;
    }

    return true;
}

/**
 * Find consecutive ranges in an array of numbers for efficient batch operations
 */
function findRanges(numbers: number[]): Array<{start: number, end: number}> {
    if (numbers.length === 0) return [];

    const sorted = [...numbers].sort((a, b) => a - b);
    const ranges: Array<{start: number, end: number}> = [];

    let start = sorted[0];
    let end = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === end + 1) {
            end = sorted[i];
        } else {
            ranges.push({start, end});
            start = sorted[i];
            end = sorted[i];
        }
    }

    ranges.push({start, end});
    return ranges;
}

// Support for `hardhat run` (EVM networks)
if (require.main === module) {
    const hre = require("hardhat") as HardhatRuntimeEnvironment;
    module.exports.default(hre)
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}
