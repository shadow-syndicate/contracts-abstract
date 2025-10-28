import {HardhatRuntimeEnvironment} from "hardhat/types";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {Deployer} from "@matterlabs/hardhat-zksync";
import {getConfig, ROLES} from "../config";
import {deployAndVerify} from "../utils/deployUtils";
import * as readline from "readline";

/**
 * Script to deploy TimelockController and transfer Inventory admin role to it
 * This adds a timelock delay to all admin operations including upgrades
 */
export default async function (hre: HardhatRuntimeEnvironment) {
    console.log("Deploying TimelockController and transferring Inventory admin...");

    const config = getConfig();
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"), hre.ethers.provider);
    const deployer = new Deployer(hre, wallet);

    // Get Inventory address from config or environment
    const inventoryAddress = process.env.INVENTORY_ADDRESS || config.contracts.inventory;

    if (!inventoryAddress) {
        throw new Error("Inventory address not found. Set INVENTORY_ADDRESS or update config.ts");
    }

    console.log(`Inventory: ${inventoryAddress}`);

    // Deploy TimelockController
    console.log(`\nDeploying TimelockController with ${config.timelock.minDelay}s delay...`);
    const timelock = await deployAndVerify(
        "TimelockController",
        [config.timelock.minDelay, config.timelock.proposers, config.timelock.executors, config.admin],
        deployer,
        hre
    );
    const timelockAddress = await timelock.getAddress();
    console.log(`Deployed TimelockController at ${timelockAddress}`);

    console.log(`\nInventory: ${inventoryAddress}`);
    console.log(`Timelock: ${timelockAddress}`);

    const inventory = await hre.ethers.getContractAt("Inventory", inventoryAddress, wallet);

    // Get timelock delay
    const delay = await timelock.getMinDelay();
    const delayMinutes = Number(delay) / 60;
    const delayHours = delayMinutes / 60;
    const delayDays = delayHours / 24;

    let delayDisplay: string;
    if (delayDays >= 1) {
        delayDisplay = `${delayDays} day(s)`;
    } else if (delayHours >= 1) {
        delayDisplay = `${delayHours} hour(s)`;
    } else {
        delayDisplay = `${delayMinutes} minute(s)`;
    }

    console.log(`\nTimelock delay: ${delay} seconds (${delayDisplay})`);

    // Grant DEFAULT_ADMIN_ROLE to TimelockController
    console.log("\nGranting DEFAULT_ADMIN_ROLE to TimelockController...");
    const grantTx = await inventory.grantRole(ROLES.DEFAULT_ADMIN_ROLE, timelockAddress);
    await grantTx.wait();
    console.log("✅ Admin role granted to TimelockController");

    // Verify timelock has admin role
    const hasRole = await inventory.hasRole(ROLES.DEFAULT_ADMIN_ROLE, timelockAddress);
    if (!hasRole) {
        throw new Error("Failed to grant admin role to TimelockController");
    }

    // Check if deployer should renounce admin role
    console.log("\n" + "=".repeat(60));
    console.log("⚠️  IMPORTANT: Renounce Deployer Admin Role");
    console.log("=".repeat(60));
    console.log("\nDeployer address:", wallet.address);
    console.log("Current status: Has DEFAULT_ADMIN_ROLE");
    console.log("\nIf you renounce this role:");
    console.log("  ✓ Only TimelockController will have admin access");
    console.log(`  ✓ All admin operations require ${delayDisplay} delay`);
    console.log("  ✗ Deployer loses immediate admin access");
    console.log("  ⚠️  CANNOT BE UNDONE without timelock governance!");

    const shouldRevoke = await askConfirmation("\nDo you want to revoke the deployer's admin role now?");

    if (shouldRevoke) {
        console.log("\n⚙️  Revoking deployer's DEFAULT_ADMIN_ROLE...");
        const revokeTx = await inventory.renounceRole(ROLES.DEFAULT_ADMIN_ROLE, wallet.address);
        await revokeTx.wait();
        console.log("✅ Deployer admin role revoked");

        // Verify deployer no longer has admin role
        const stillHasRole = await inventory.hasRole(ROLES.DEFAULT_ADMIN_ROLE, wallet.address);
        if (stillHasRole) {
            throw new Error("Failed to revoke admin role from deployer");
        }

        console.log("\n✅ Complete Transfer!");
        console.log("TimelockController is now the sole admin");
        console.log("All admin operations require timelock delay");
    } else {
        console.log("\n⚠️  Deployer still has admin role");
        console.log("To revoke later, run:");
        console.log(`  inventory.renounceRole(ROLES.DEFAULT_ADMIN_ROLE, "${wallet.address}")`);
    }

    console.log("\n✅ Deployment and Transfer Summary:");
    console.log(`  TimelockController: ${timelockAddress}`);
    console.log(`  Inventory: ${inventoryAddress}`);
    console.log(`  Timelock Delay: ${delayDisplay}`);
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