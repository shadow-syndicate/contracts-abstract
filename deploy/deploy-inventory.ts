import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify, verifyContract} from "./utils/deployUtils";
import {getConfig, ROLES, INVENTORY_TOKEN_LIMITS, SOULBOUND_TOKENS, RESTRICTED_ITEMS} from "./config";

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

    console.log(`\n📦 Deploying new Inventory with proxy...`);

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

    // Grant roles
    console.log(`\nGranting roles...`);
    await inventory.grantRole(ROLES.WITHDRAW_ROLE, config.withdraw);
    await inventory.grantRole(ROLES.MINTER_ROLE, config.minter);
    await inventory.grantRole(ROLES.PAUSER_ROLE, config.admin);
    console.log(`✅ Roles granted successfully`);

    // Disable transfers for soulbound tokens (batteries and reactors)
    if (SOULBOUND_TOKENS.length > 0) {
        console.log(`\nDisabling transfers for soulbound tokens...`);
        const tx = await inventory.disableTransfer(SOULBOUND_TOKENS);
        await tx.wait();
        console.log(`✅ Transfers disabled for ${SOULBOUND_TOKENS.length} soulbound token(s) (batteries and reactors)`);
    }

    // Set token limits if configured
    if (INVENTORY_TOKEN_LIMITS.length > 0) {
        console.log(`\nSetting token limits...`);
        const tokenIds = INVENTORY_TOKEN_LIMITS.map(limit => limit.tokenId);
        const maxBalances = INVENTORY_TOKEN_LIMITS.map(limit => limit.maxBalancePerOwner);

        const tx = await inventory.setMaxBalancePerOwnerBatch(tokenIds, maxBalances);
        await tx.wait();

        console.log(`✅ Token limits set for ${INVENTORY_TOKEN_LIMITS.length} token(s)`);
    }

    // Set restricted items (mutually exclusive reactor ownership)
    if (RESTRICTED_ITEMS.length > 0) {
        console.log(`\nSetting restricted items (mutually exclusive reactor ownership)...`);
        const tokenIds = RESTRICTED_ITEMS.map(item => item.tokenId);
        const restrictedArrays = RESTRICTED_ITEMS.map(item => item.restricted);

        const tx = await inventory.setRestrictedItemsBatch(tokenIds, restrictedArrays);
        await tx.wait();

        console.log(`✅ Restricted items set for ${RESTRICTED_ITEMS.length} token(s)`);
        console.log(`   Each reactor variant is now mutually exclusive within its family`);
    }

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  TimelockController: ${timelockAddress}`);
    console.log(`  Inventory (Proxy): ${proxyAddress}`);
    console.log(`  Inventory (Implementation): ${inventoryImplementationAddress}`);
    console.log(`  Admin: ${config.admin}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  Minter: ${config.minter}`);
    console.log(`  Withdraw: ${config.withdraw}`);
    if (SOULBOUND_TOKENS.length > 0) {
        console.log(`  Soulbound Tokens: ${SOULBOUND_TOKENS.length} configured`);
    }
    if (INVENTORY_TOKEN_LIMITS.length > 0) {
        console.log(`  Token Limits: ${INVENTORY_TOKEN_LIMITS.length} token(s) configured`);
    }
    if (RESTRICTED_ITEMS.length > 0) {
        console.log(`  Restricted Items: ${RESTRICTED_ITEMS.length} token(s) configured`);
    }

}
