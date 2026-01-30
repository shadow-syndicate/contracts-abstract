import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig, ROLES } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Deploying ShopV2 contract on ${hre.network.name} (${networkType})...`);

    const deployer = await createDeployer(hre);
    const deployerAddress = await deployer.getAddress();

    // Load environment-specific configuration
    const config = getConfig();

    // Validate required contract addresses
    if (!config.contracts.acid) {
        throw new Error("ACID contract address not configured for this environment");
    }
    if (!config.contracts.roach) {
        throw new Error("ROACH contract address not configured for this environment");
    }
    if (!config.contracts.inventoryProxy) {
        throw new Error("Inventory contract address not configured for this environment");
    }
    if (!config.manager) {
        throw new Error("Manager address not configured for this environment");
    }

    console.log("Using ACID at:", config.contracts.acid);
    console.log("Using ROACH at:", config.contracts.roach);
    console.log("Using Inventory at:", config.contracts.inventoryProxy);

    // Deploy ShopV2 contract
    const shopV2Deployed = await deployAndVerify("ShopV2", [
        config.contracts.acid,           // ACID token address
        config.contracts.roach,          // ROACH token address
        config.contracts.inventoryProxy, // Inventory contract address
        deployerAddress,                 // Admin role
        deployerAddress                  // Withdraw role
    ], deployer, hre, "contracts/ShopV2.sol:ShopV2");

    const shopV2Address = await shopV2Deployed.getAddress();
    console.log("ShopV2 deployed to:", shopV2Address);

    // Get typed contract instance
    const shopV2Contract = await hre.ethers.getContractAt("ShopV2", shopV2Address, deployer.getSigner());

    // Grant necessary roles
    const inventoryContract = await hre.ethers.getContractAt("Inventory", config.contracts.inventoryProxy, deployer.getSigner());

    console.log("Granting MINTER_ROLE to ShopV2 contract...");
    await inventoryContract.grantRole(ROLES.MINTER_ROLE, await shopV2Contract.getAddress());

    // Grant MANAGER_ROLE to manager address
    if (config.manager) {
        console.log("Granting MANAGER_ROLE to manager address...");
        await shopV2Contract.grantRole(ROLES.MANAGER_ROLE, config.manager);
    }

    console.log("\n✅ Deployment Summary:");
    console.log(`  Network: ${hre.network.name} (${networkType})`);
    console.log(`  ShopV2: ${await shopV2Contract.getAddress()}`);
    console.log(`  ACID: ${config.contracts.acid}`);
    console.log(`  ROACH: ${config.contracts.roach}`);
    console.log(`  Inventory: ${config.contracts.inventoryProxy}`);
    console.log(`  Manager: ${config.manager}`);
}

// Support for hardhat run (EVM networks)
if (require.main === module) {
    const hre = require("hardhat");
    module.exports.default(hre)
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}
