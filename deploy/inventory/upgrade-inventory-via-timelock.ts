import {Deployer} from "@matterlabs/hardhat-zksync";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {getConfig} from "../config";
import {verifyContract} from "../utils/deployUtils";

/**
 * Script to upgrade Inventory implementation through TimelockController
 *
 * Process:
 * 1. Deploy new implementation
 * 2. Schedule upgrade transaction in timelock
 * 3. Wait for timelock delay
 * 4. Execute the upgrade
 */
export default async function (hre: HardhatRuntimeEnvironment) {
    console.log("Upgrading Inventory via TimelockController...\n");

    const config = getConfig();
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"), hre.ethers.provider);
    const deployer = new Deployer(hre, wallet);

    // Get contract addresses from config or environment
    const inventoryProxyAddress = process.env.INVENTORY_ADDRESS || config.contracts.inventory;
    const timelockAddress = process.env.TIMELOCK_ADDRESS || config.contracts.inventoryTimelock;

    if (!inventoryProxyAddress) {
        throw new Error("Inventory proxy address not found. Set INVENTORY_ADDRESS or update config.ts");
    }
    if (!timelockAddress) {
        throw new Error("Timelock address not found. Set TIMELOCK_ADDRESS or update config.ts");
    }

    console.log(`Inventory Proxy: ${inventoryProxyAddress}`);
    console.log(`Timelock: ${timelockAddress}\n`);

    // STEP 1: Deploy new implementation
    console.log("📦 Deploying new Inventory implementation...");
    const inventoryArtifact = await deployer.loadArtifact("Inventory");
    const newImplementation = await deployer.deploy(inventoryArtifact, []);
    const newImplementationAddress = await newImplementation.getAddress();
    console.log(`New implementation deployed at: ${newImplementationAddress}`);

    // Verify new implementation
    await verifyContract(newImplementationAddress, [], hre);

    // STEP 2: Prepare upgrade transaction
    const inventory = await hre.ethers.getContractAt("Inventory", inventoryProxyAddress, wallet);
    const timelock = await hre.ethers.getContractAt("TimelockController", timelockAddress, wallet);

    // Encode the upgradeToAndCall function call
    const upgradeData = inventory.interface.encodeFunctionData("upgradeToAndCall", [
        newImplementationAddress,
        "0x" // No initialization data needed for upgrade
    ]);

    // Prepare timelock parameters
    const target = inventoryProxyAddress; // The proxy contract
    const value = 0; // No ETH sent
    const data = upgradeData;
    const predecessor = hre.ethers.ZeroHash; // No dependency on other operations
    const salt = hre.ethers.id(`upgrade-inventory-${Date.now()}`); // Unique salt
    const delay = await timelock.getMinDelay();

    console.log(`\nTimelock delay: ${delay} seconds (${Number(delay) / 60} minutes)`);

    // STEP 3: Schedule the upgrade
    console.log("\n📅 Scheduling upgrade in TimelockController...");

    const scheduleTx = await timelock.schedule(
        target,
        value,
        data,
        predecessor,
        salt,
        delay
    );
    await scheduleTx.wait();
    console.log("✅ Upgrade scheduled successfully!");

    // Get the operation ID
    const operationId = await timelock.hashOperation(target, value, data, predecessor, salt);
    console.log(`Operation ID: ${operationId}`);

    // Calculate execution timestamp
    const currentBlock = await hre.ethers.provider.getBlock("latest");
    const executionTimestamp = currentBlock!.timestamp + Number(delay);
    const executionDate = new Date(executionTimestamp * 1000);

    console.log(`\n⏰ Upgrade can be executed after: ${executionDate.toISOString()}`);
    console.log(`   (Block timestamp: ${executionTimestamp})`);

    // STEP 4: Instructions for execution
    console.log("\n" + "=".repeat(60));
    console.log("NEXT STEPS:");
    console.log("=".repeat(60));
    console.log("\n1. Wait for the timelock delay to pass");
    console.log(`   Current time: ${new Date().toISOString()}`);
    console.log(`   Can execute: ${executionDate.toISOString()}`);
    console.log(`   Delay: ${Number(delay) / 60} minutes\n`);

    console.log("2. Execute the upgrade with:");
    console.log(`   OPERATION_ID=${operationId} \\`);
    console.log(`   npx hardhat deploy-zksync --script execute-timelock-upgrade.ts --network <network>\n`);

    console.log("3. Or manually execute:");
    console.log("   ```javascript");
    console.log("   await timelock.execute(");
    console.log(`     "${target}",`);
    console.log(`     ${value},`);
    console.log(`     "${data}",`);
    console.log(`     "${predecessor}",`);
    console.log(`     "${salt}"`);
    console.log("   );");
    console.log("   ```\n");

    // Save execution parameters to file for convenience
    const executionParams = {
        target,
        value,
        data,
        predecessor,
        salt,
        operationId,
        newImplementation: newImplementationAddress,
        executionTimestamp,
        executionDate: executionDate.toISOString()
    };

    const fs = require('fs');
    fs.writeFileSync(
        'timelock-upgrade-params.json',
        JSON.stringify(executionParams, null, 2)
    );
    console.log("✅ Execution parameters saved to: timelock-upgrade-params.json\n");
}