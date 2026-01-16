import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, verifyContract, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig, REACTOR_CONFIG, SHOP_LOTS, ROLES } from "./config";
import { ethers } from "hardhat";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Deploying Shop and Reactor contracts on ${hre.network.name} (${networkType})...`);

    const deployer = await createDeployer(hre);
    const deployerAddress = await deployer.getAddress();

    // Load environment-specific configuration
    const config = getConfig();

    // Validate required contract addresses
    if (!config.contracts.trax) {
        throw new Error("TRAX contract address not configured for this environment");
    }
    if (!config.contracts.inventoryProxy) {
        throw new Error("Inventory contract address not configured for this environment");
    }
    if (!config.manager) {
        throw new Error("Manager address not configured for this environment");
    }

    console.log("Using TRAX at:", config.contracts.trax);
    console.log("Using Inventory at:", config.contracts.inventoryProxy);
    console.log("Using Lootbox at:", config.contracts.lootbox || "Not configured (zero address)");

    // Deploy Shop contract
    const shopDeployed = await deployAndVerify("Shop", [
        config.contracts.trax,      // TRAX token address
        config.contracts.inventoryProxy, // Inventory contract address
        config.contracts.lootbox || ethers.ZeroAddress,   // Lootbox contract address (optional)
        deployerAddress,            // Admin role
        deployerAddress             // Withdraw role
    ], deployer, hre, "contracts/Shop.sol:Shop");

    const shopAddress = await shopDeployed.getAddress();
    console.log("Shop deployed to:", shopAddress);

    // Get typed contract instance
    const shopContract = await hre.ethers.getContractAt("Shop", shopAddress, deployer.getSigner());

    // Deploy Reactor contract with proxy (UUPS upgradeable pattern)
    console.log("\n📦 Deploying Reactor with proxy...");

    // Deploy Reactor implementation
    console.log("Deploying Reactor implementation...");
    const reactorArtifact = await deployer.loadArtifact("Reactor");
    const reactorImplementation = await reactorArtifact.deploy([]);
    const reactorImplementationAddress = await reactorImplementation.getAddress();
    console.log(`Reactor implementation deployed at ${reactorImplementationAddress}`);

    // Verify Reactor implementation
    await verifyContract(reactorImplementationAddress, [], hre, "contracts/Reactor.sol:Reactor");

    // Encode initialize function call
    const initializeData = reactorArtifact.interface.encodeFunctionData("initialize", [
        config.contracts.inventoryProxy,          // Inventory contract address
        deployerAddress,                     // Admin role
        REACTOR_CONFIG.batteryItemIds,       // Battery item IDs array
        config.reactor.batteryDurations,     // Battery durations array (env-specific)
        REACTOR_CONFIG.batteryReactorOffsets, // Battery reactor offsets array
        REACTOR_CONFIG.minReactorId,         // Min reactor ID
        REACTOR_CONFIG.maxReactorId,         // Max reactor ID
        REACTOR_CONFIG.reactorIdStep,        // Reactor ID step
        REACTOR_CONFIG.activationCount       // Activation count
    ]);

    // Deploy ReactorProxy
    console.log("Deploying ReactorProxy...");
    const proxyArtifact = await deployer.loadArtifact("ReactorProxy");
    const proxy = await proxyArtifact.deploy([reactorImplementationAddress, initializeData]);
    const proxyAddress = await proxy.getAddress();
    console.log(`Reactor proxy deployed at ${proxyAddress}`);

    // Verify ReactorProxy
    await verifyContract(proxyAddress, [reactorImplementationAddress, initializeData], hre, "contracts/utils/ReactorProxy.sol:ReactorProxy");

    // Get Reactor contract interface at proxy address
    const reactorContract = await hre.ethers.getContractAt("Reactor", proxyAddress, deployer.getSigner());
    console.log("Reactor (via proxy) ready at:", proxyAddress);

    // Grant necessary roles
    const inventoryContract = await hre.ethers.getContractAt("Inventory", config.contracts.inventoryProxy, deployer.getSigner());

    console.log("Granting MINTER_ROLE to Shop contract...");
    await inventoryContract.grantRole(ROLES.MINTER_ROLE, await shopContract.getAddress());

    console.log("Granting MINTER_ROLE and BURNER_ROLE to Reactor contract...");
    await inventoryContract.grantRole(ROLES.MINTER_ROLE, await reactorContract.getAddress());
    await inventoryContract.grantRole(ROLES.BURNER_ROLE, await reactorContract.getAddress());

    // Grant MANAGER_ROLE to manager address on both contracts
    if (config.manager) {
        console.log("Granting MANAGER_ROLE to manager address...");
        await shopContract.grantRole(ROLES.MANAGER_ROLE, config.manager);
        await reactorContract.grantRole(ROLES.MANAGER_ROLE, config.manager);
    }

    // Create shop lots from configuration
    console.log("Creating shop lots...");
    const now = Math.floor(Date.now() / 1000);
    const endTime = now + (300 * 24 * 60 * 60); // 300 days

    for (const lot of SHOP_LOTS) {
        await shopContract.createLot(
            lot.lotId,
            ethers.parseEther(lot.priceInTrax),
            ethers.parseEther(lot.priceInTraxTurbo),
            now,
            endTime,
            lot.itemIds(REACTOR_CONFIG),
            lot.amounts,
            lot.restrictedItems(REACTOR_CONFIG)
        );
    }
    console.log(`Created ${SHOP_LOTS.length} shop lots`);

    console.log("\n✅ Deployment Summary:");
    console.log(`  Network: ${hre.network.name} (${networkType})`);
    console.log(`  Shop: ${await shopContract.getAddress()}`);
    console.log(`  Reactor (Proxy): ${proxyAddress}`);
    console.log(`  Reactor (Implementation): ${reactorImplementationAddress}`);
    console.log(`  TRAX: ${config.contracts.trax}`);
    console.log(`  Inventory: ${config.contracts.inventoryProxy}`);
    console.log(`  Lootbox: ${config.contracts.lootbox || "Not configured"}`);

    console.log(`  Manager: ${config.manager}`);
    console.log(`\n🔋 Reactor Configuration:`);
    console.log(`  Battery IDs: ${REACTOR_CONFIG.batteryItemIds.join(', ')}`);
    console.log(`  Battery Durations: ${config.reactor.batteryDurations.map(d => `${d / 60}min`).join(', ')}`);
    console.log(`  Battery Reactor Offsets: ${REACTOR_CONFIG.batteryReactorOffsets.join(', ')}`);
    console.log(`  Reactor ID Range: ${REACTOR_CONFIG.minReactorId} - ${REACTOR_CONFIG.maxReactorId} (step: ${REACTOR_CONFIG.reactorIdStep})`);
    console.log(`  Activation Count: ${REACTOR_CONFIG.activationCount}`);
    console.log(`  Lots Created: ${SHOP_LOTS.length}`);
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
