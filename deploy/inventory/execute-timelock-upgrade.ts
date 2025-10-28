import {HardhatRuntimeEnvironment} from "hardhat/types";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {getConfig} from "../config";

/**
 * Script to execute a scheduled upgrade through TimelockController
 *
 * Prerequisites:
 * 1. Upgrade must be scheduled via upgrade-inventory-via-timelock.ts
 * 2. Timelock delay period must have passed
 * 3. Must have timelock-upgrade-params.json file (created by schedule script)
 */
export default async function (hre: HardhatRuntimeEnvironment) {
    console.log("Executing scheduled Inventory upgrade via TimelockController...\n");

    const config = getConfig();
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"), hre.ethers.provider);

    // Load execution parameters
    const fs = require('fs');
    let params;

    try {
        const paramsFile = fs.readFileSync('timelock-upgrade-params.json', 'utf8');
        params = JSON.parse(paramsFile);
    } catch (error) {
        throw new Error("Could not load timelock-upgrade-params.json. Run the schedule script first.");
    }

    // Get timelock address from config or environment
    const timelockAddress = process.env.TIMELOCK_ADDRESS || config.contracts.inventoryTimelock;
    if (!timelockAddress) {
        throw new Error("Timelock address not found. Set TIMELOCK_ADDRESS or update config.ts");
    }

    console.log("Execution Parameters:");
    console.log(`  Target (Proxy): ${params.target}`);
    console.log(`  New Implementation: ${params.newImplementation}`);
    console.log(`  Operation ID: ${params.operationId}`);
    console.log(`  Scheduled execution: ${params.executionDate}`);

    const timelock = await hre.ethers.getContractAt("TimelockController", timelockAddress, wallet);

    // Get current time
    const currentBlock = await hre.ethers.provider.getBlock("latest");
    const currentTime = currentBlock!.timestamp;
    const currentDate = new Date(currentTime * 1000);

    console.log(`  Current time: ${currentDate.toISOString()}`);

    // Check if operation is ready
    const isReady = await timelock.isOperationReady(params.operationId);
    if (!isReady) {
        const timeRemaining = params.executionTimestamp - currentTime;

        if (timeRemaining > 0) {
            // Format time remaining in a readable way
            const days = Math.floor(timeRemaining / (24 * 60 * 60));
            const hours = Math.floor((timeRemaining % (24 * 60 * 60)) / (60 * 60));
            const minutes = Math.floor((timeRemaining % (60 * 60)) / 60);
            const seconds = timeRemaining % 60;

            let timeDisplay = '';
            if (days > 0) timeDisplay += `${days}d `;
            if (hours > 0 || days > 0) timeDisplay += `${hours}h `;
            if (minutes > 0 || hours > 0 || days > 0) timeDisplay += `${minutes}m `;
            timeDisplay += `${seconds}s`;

            console.log("\n" + "=".repeat(60));
            console.log("⏳ OPERATION NOT READY YET");
            console.log("=".repeat(60));
            console.log(`\nTime remaining: ${timeDisplay.trim()}`);
            console.log(`Can execute after: ${params.executionDate}`);
            console.log(`Current time: ${currentDate.toISOString()}\n`);

            throw new Error(
                `Operation not ready. Wait ${timeDisplay.trim()} (${timeRemaining} seconds)`
            );
        }

        // Check if operation exists
        const isPending = await timelock.isOperationPending(params.operationId);
        if (!isPending) {
            throw new Error("Operation not found or already executed");
        }
    }

    console.log("\n✅ Operation is ready for execution!\n");

    // Execute the upgrade
    console.log("⚙️  Executing upgrade...");
    const executeTx = await timelock.execute(
        params.target,
        params.value,
        params.data,
        params.predecessor,
        params.salt
    );

    console.log(`Transaction hash: ${executeTx.hash}`);
    console.log("Waiting for confirmation...");

    const receipt = await executeTx.wait();
    console.log(`✅ Upgrade executed in block ${receipt!.blockNumber}`);

    // Verify the upgrade
    const inventory = await hre.ethers.getContractAt("Inventory", params.target, wallet);

    // Test the new implementation by calling testUpgrade function
    console.log("\n🧪 Testing upgraded contract...");
    try {
        const testTx = await inventory.testUpgrade("Timelock upgrade successful!", Date.now());
        await testTx.wait();
        console.log("✅ New implementation is working correctly!");
    } catch (error) {
        console.log("⚠️  Could not test new implementation (testUpgrade function might not exist)");
    }

    console.log("\n" + "=".repeat(60));
    console.log("UPGRADE COMPLETE!");
    console.log("=".repeat(60));
    console.log(`  Proxy: ${params.target}`);
    console.log(`  New Implementation: ${params.newImplementation}`);
    console.log(`  Transaction: ${executeTx.hash}`);
    console.log("=".repeat(60) + "\n");

    // Clean up params file
    fs.unlinkSync('timelock-upgrade-params.json');
    console.log("✅ Cleaned up timelock-upgrade-params.json");
}