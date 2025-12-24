import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify, verifyContract, getDeployerPrivateKey} from "./utils/deployUtils";
import {getConfig, ROLES, INVENTORY_TOKEN_LIMITS, SOULBOUND_TOKENS, RESTRICTED_ITEMS} from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script for Inventory... 👨‍🍳`);

    // Load environment-specific configuration
    const config = getConfig();

    // Initialize the wallet using your private key.
    const wallet = new Wallet(getDeployerPrivateKey(hre), hre.ethers.provider);

    // Create deployer from hardhat-zksync and load the artifact of the contract we want to deploy.
    const deployer = new Deployer(hre, wallet);

    const inventoryArtifact = await deployer.loadArtifact("Inventory");

    // Check if proxy already exists
    const existingProxyAddress = config.contracts.inventory;
    let proxyAddress: string;
    let inventoryImplementationAddress: string;
    let inventory: any;

    if (existingProxyAddress) {
        console.log(`\n🔄 Upgrading existing Inventory proxy at ${existingProxyAddress}...`);

        // Deploy new Inventory implementation
        console.log(`\nDeploying new Inventory implementation...`);
        const inventoryImplementation = await deployer.deploy(inventoryArtifact, []);
        inventoryImplementationAddress = await inventoryImplementation.getAddress();
        console.log(`New Inventory implementation deployed at ${inventoryImplementationAddress}`);

        // Verify new implementation
        await verifyContract(inventoryImplementationAddress, [], hre);

        // Attach to existing proxy
        inventory = inventoryImplementation.attach(existingProxyAddress);
        proxyAddress = existingProxyAddress;

        // Upgrade the proxy to the new implementation
        console.log(`\nUpgrading proxy to new implementation...`);
        const upgradeTx = await inventory.upgradeToAndCall(inventoryImplementationAddress, "0x");
        await upgradeTx.wait();
        console.log(`✅ Proxy upgraded successfully`);

    } else {
        console.log(`\n📦 Deploying new Inventory with proxy...`);

        // Deploy Inventory implementation
        console.log(`\nDeploying Inventory implementation...`);
        const inventoryImplementation = await deployer.deploy(inventoryArtifact, []);
        inventoryImplementationAddress = await inventoryImplementation.getAddress();
        console.log(`Inventory implementation deployed at ${inventoryImplementationAddress}`);

        // Verify Inventory implementation
        await verifyContract(inventoryImplementationAddress, [], hre);

        // Encode initialize function call - use deployer as initial admin
        const initializeData = inventoryImplementation.interface.encodeFunctionData("initialize", [
            wallet.address,
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
        proxyAddress = await proxy.getAddress();
        console.log(`Inventory proxy deployed at ${proxyAddress}`);

        // Verify InventoryProxy
        await verifyContract(proxyAddress, [inventoryImplementationAddress, initializeData], hre);

        // Get Inventory contract interface at proxy address
        inventory = inventoryImplementation.attach(proxyAddress);

        // Grant roles
        console.log(`\nGranting roles...`);
        await inventory.grantRole(ROLES.WITHDRAW_ROLE, config.withdraw);
        await inventory.grantRole(ROLES.MINTER_ROLE, config.minter);
        for (const admin of config.admin) {
            await inventory.grantRole(ROLES.PAUSER_ROLE, admin);
        }
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

        // Transfer admin rights from deployer to config.admin
        console.log(`\nTransferring admin rights...`);

        // Grant DEFAULT_ADMIN_ROLE to all configured admin addresses
        for (const admin of config.admin) {
            await inventory.grantRole(ROLES.DEFAULT_ADMIN_ROLE, admin);
            console.log(`✅ Granted DEFAULT_ADMIN_ROLE to ${admin}`);
        }

        // Revoke DEFAULT_ADMIN_ROLE from deployer (only if not in admin list)
        if (!config.admin.includes(wallet.address)) {
            await inventory.revokeRole(ROLES.DEFAULT_ADMIN_ROLE, wallet.address);
            console.log(`✅ Revoked DEFAULT_ADMIN_ROLE from deployer ${wallet.address}`);
        } else {
            console.log(`⚠️  Deployer ${wallet.address} is in admin list, keeping DEFAULT_ADMIN_ROLE`);
        }
    }

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  Inventory (Proxy): ${proxyAddress}`);
    console.log(`  Inventory (Implementation): ${inventoryImplementationAddress}`);
    console.log(`  Admins: ${config.admin.join(', ')}`);
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
