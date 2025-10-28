import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify, verifyContract} from "./utils/deployUtils";
import {getConfig, ROLES, INVENTORY_TOKEN_LIMITS} from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script for Inventory... 👨‍🍳`);

    // Load environment-specific configuration
    const config = getConfig();

    // Initialize the wallet using your private key.
    // https://hardhat.org/hardhat-runner/docs/guides/configuration-variables
    // Run npx hardhat vars set DEPLOYER_PRIVATE_KEY and put a new wallet's private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));

    // Create deployer from hardhat-zksync and load the artifact of the contract we want to deploy.
    const deployer = new Deployer(hre, wallet);

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

    // Deploy Inventory implementation
    console.log(`\nDeploying Inventory implementation...`);
    const inventoryArtifact = await deployer.loadArtifact("Inventory");
    const inventoryImplementation = await deployer.deploy(inventoryArtifact, []);
    const inventoryImplementationAddress = await inventoryImplementation.getAddress();
    console.log(`Inventory implementation deployed at ${inventoryImplementationAddress}`);

    // Verify Inventory implementation
    await verifyContract(inventoryImplementationAddress, [], hre);

    // Encode initialize function call
    const initializeData = inventoryImplementation.interface.encodeFunctionData("initialize", [
        config.admin,
        config.signer,
        config.metadata.inventory
    ]);

    // Deploy InventoryProxy (ERC1967Proxy wrapper)
    console.log(`\nDeploying InventoryProxy for Inventory...`);
    const proxyArtifact = await deployer.loadArtifact("InventoryProxy");
    const proxy = await deployer.deploy(proxyArtifact, [
        inventoryImplementationAddress,
        initializeData
    ]);
    const proxyAddress = await proxy.getAddress();
    console.log(`Inventory proxy deployed at ${proxyAddress}`);

    // Verify InventoryProxy
    await verifyContract(proxyAddress, [inventoryImplementationAddress, initializeData], hre);

    // Get Inventory contract interface at proxy address
    const inventory = inventoryImplementation.attach(proxyAddress);
    const inventoryAddress = proxyAddress;

    // Grant roles
    console.log(`\nGranting roles...`);
    await inventory.grantRole(ROLES.WITHDRAW_ROLE, config.admin);
    await inventory.grantRole(ROLES.MINTER_ROLE, config.minter);
    console.log(`✅ Roles granted successfully`);

    // Set token limits if configured
    if (INVENTORY_TOKEN_LIMITS.length > 0) {
        console.log(`\nSetting token limits...`);
        const tokenIds = INVENTORY_TOKEN_LIMITS.map(limit => limit.tokenId);
        const maxBalances = INVENTORY_TOKEN_LIMITS.map(limit => limit.maxBalancePerOwner);

        const tx = await inventory.setMaxBalancePerOwnerBatch(tokenIds, maxBalances);
        await tx.wait();

        console.log(`✅ Token limits set for ${INVENTORY_TOKEN_LIMITS.length} token(s):`);
        INVENTORY_TOKEN_LIMITS.forEach(limit => {
            console.log(`  Token ${limit.tokenId}: max ${limit.maxBalancePerOwner} per owner`);
        });
    }

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  TimelockController: ${timelockAddress}`);
    console.log(`  Inventory (Proxy): ${inventoryAddress}`);
    console.log(`  Inventory (Implementation): ${inventoryImplementationAddress}`);
    console.log(`  Admin: ${config.admin}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  Minter: ${config.minter}`);
    if (INVENTORY_TOKEN_LIMITS.length > 0) {
        console.log(`  Token Limits: ${INVENTORY_TOKEN_LIMITS.length} token(s) configured`);
    }

}
