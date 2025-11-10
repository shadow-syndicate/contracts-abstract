import {Deployer} from "@matterlabs/hardhat-zksync";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {getConfig, REACTOR_CONFIG, SHOP_LOTS, ROLES} from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"), hre.ethers.provider);
    const deployer = new Deployer(hre, wallet);

    console.log("Deploying Shop and Reactor contracts...");

    // Load environment-specific configuration
    const config = getConfig();

    // Validate required contract addresses
    if (!config.contracts.trax) {
        throw new Error("TRAX contract address not configured for this environment");
    }
    if (!config.contracts.inventory) {
        throw new Error("Inventory contract address not configured for this environment");
    }
    if (!config.contracts.lootbox) {
        throw new Error("Lootbox contract address not configured for this environment");
    }
    if (!config.manager) {
        throw new Error("Manager address not configured for this environment");
    }

    console.log("Using TRAX at:", config.contracts.trax);
    console.log("Using Inventory at:", config.contracts.inventory);
    console.log("Using Lootbox at:", config.contracts.lootbox);

    // Deploy Shop contract
    const shopContract = await deployAndVerify("Shop", [
        config.contracts.trax,      // TRAX token address
        config.contracts.inventory, // Inventory contract address
        config.contracts.lootbox,   // Lootbox contract address
        deployer.zkWallet.address,  // Admin role
        deployer.zkWallet.address   // Withdraw role
    ], deployer, hre);

    console.log("Shop deployed to:", await shopContract.getAddress());

    // Deploy Reactor contract with proxy (UUPS upgradeable pattern)
    console.log("\n📦 Deploying Reactor with proxy...");

    // Deploy Reactor implementation
    console.log("Deploying Reactor implementation...");
    const reactorArtifact = await deployer.loadArtifact("Reactor");
    const reactorImplementation = await deployer.deploy(reactorArtifact, []);
    const reactorImplementationAddress = await reactorImplementation.getAddress();
    console.log(`Reactor implementation deployed at ${reactorImplementationAddress}`);

    // Verify Reactor implementation
    await hre.run("verify:verify", {
        address: reactorImplementationAddress,
        constructorArguments: [],
    }).catch((e: any) => {
        if (e.message.includes("Already Verified")) {
            console.log("✅ Reactor implementation already verified");
        } else {
            console.log("⚠️  Reactor implementation verification failed:", e.message);
        }
    });

    // Encode initialize function call
    const initializeData = reactorImplementation.interface.encodeFunctionData("initialize", [
        config.contracts.inventory,          // Inventory contract address
        deployer.zkWallet.address,           // Admin role
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
    const proxy = await deployer.deploy(proxyArtifact, [
        reactorImplementationAddress,
        initializeData
    ]);
    const proxyAddress = await proxy.getAddress();
    console.log(`Reactor proxy deployed at ${proxyAddress}`);

    // Verify ReactorProxy
    await hre.run("verify:verify", {
        address: proxyAddress,
        constructorArguments: [reactorImplementationAddress, initializeData],
    }).catch((e: any) => {
        if (e.message.includes("Already Verified")) {
            console.log("✅ Reactor proxy already verified");
        } else {
            console.log("⚠️  Reactor proxy verification failed:", e.message);
        }
    });

    // Get Reactor contract interface at proxy address
    const reactorContract = reactorImplementation.attach(proxyAddress);
    console.log("Reactor (via proxy) ready at:", proxyAddress);

    // Grant necessary roles
    const inventoryContract = await hre.ethers.getContractAt("Inventory", config.contracts.inventory, deployer.zkWallet);

    console.log("Granting MINTER_ROLE to Shop contract...");
    await inventoryContract.grantRole(ROLES.MINTER_ROLE, await shopContract.getAddress());

    console.log("Granting MINTER_ROLE and BURNER_ROLE to Reactor contract...");
    await inventoryContract.grantRole(ROLES.MINTER_ROLE, await reactorContract.getAddress());
    await inventoryContract.grantRole(ROLES.BURNER_ROLE, await reactorContract.getAddress());

    // Grant MANAGER_ROLE to manager address on both contracts
    console.log("Granting MANAGER_ROLE to manager address...");
    await shopContract.grantRole(ROLES.MANAGER_ROLE, config.manager);
    await reactorContract.grantRole(ROLES.MANAGER_ROLE, config.manager);

    // Create shop lots from configuration
    console.log("Creating shop lots...");
    const now = Math.floor(Date.now() / 1000);
    const endTime = now + (300 * 24 * 60 * 60); // 300 days

    for (const lot of SHOP_LOTS) {
        await shopContract.createLot(
            lot.lotId,
            hre.ethers.parseEther(lot.priceInTrax),
            hre.ethers.parseEther(lot.priceInTraxTurbo),
            now,
            endTime,
            lot.itemIds(REACTOR_CONFIG),
            lot.amounts,
            lot.restrictedItems(REACTOR_CONFIG)
        );
    }
    console.log(`Created ${SHOP_LOTS.length} shop lots`);

    console.log("\n✅ Deployment Summary:");
    console.log(`  Shop: ${await shopContract.getAddress()}`);
    console.log(`  Reactor (Proxy): ${proxyAddress}`);
    console.log(`  Reactor (Implementation): ${reactorImplementationAddress}`);
    console.log(`  TRAX: ${config.contracts.trax}`);
    console.log(`  Inventory: ${config.contracts.inventory}`);
    console.log(`  Lootbox: ${config.contracts.lootbox}`);
    console.log(`  Manager: ${config.manager}`);
    console.log(`\n🔋 Reactor Configuration:`);
    console.log(`  Battery IDs: ${REACTOR_CONFIG.batteryItemIds.join(', ')}`);
    console.log(`  Battery Durations: ${config.reactor.batteryDurations.map(d => `${d / 60}min`).join(', ')}`);
    console.log(`  Battery Reactor Offsets: ${REACTOR_CONFIG.batteryReactorOffsets.join(', ')}`);
    console.log(`  Reactor ID Range: ${REACTOR_CONFIG.minReactorId} - ${REACTOR_CONFIG.maxReactorId} (step: ${REACTOR_CONFIG.reactorIdStep})`);
    console.log(`  Activation Count: ${REACTOR_CONFIG.activationCount}`);
    console.log(`  Lots Created: ${SHOP_LOTS.length}`);
}
