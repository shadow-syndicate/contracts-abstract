import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";
import {getConfig, ROLES} from "./config";

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
    const deployerAddress = await wallet.getAddress();

    // Deploy TimelockController
    console.log(`Deploying TimelockController with ${config.timelock.minDelay}s delay...`);
    const timelock = await deployAndVerify(
        "TimelockController",
        [config.timelock.minDelay, config.timelock.proposers, config.timelock.executors, config.admin],
        deployer,
        hre
    );
    const timelockAddress = await timelock.getAddress();
    console.log(`Deployed TimelockController at ${timelockAddress}`);

    // Deploy Inventory implementation
    console.log(`Deploying Inventory implementation...`);
    const inventoryArtifact = await deployer.loadArtifact("Inventory");
    const inventoryImplementation = await deployer.deploy(inventoryArtifact, []);
    const inventoryImplementationAddress = await inventoryImplementation.getAddress();
    console.log(`Inventory implementation deployed at ${inventoryImplementationAddress}`);

    // Encode initialize function call
    const initializeData = inventoryImplementation.interface.encodeFunctionData("initialize", [
        config.admin,
        config.signer,
        config.metadataBaseUrl
    ]);

    // Deploy ERC1967Proxy
    console.log(`Deploying ERC1967Proxy for Inventory...`);
    const proxyArtifact = await deployer.loadArtifact("ERC1967Proxy");
    const proxy = await deployer.deploy(proxyArtifact, [
        inventoryImplementationAddress,
        initializeData
    ]);
    const proxyAddress = await proxy.getAddress();
    console.log(`Inventory proxy deployed at ${proxyAddress}`);

    // Get Inventory contract interface at proxy address
    const inventory = inventoryImplementation.attach(proxyAddress);

    // Grant roles
    await inventory.grantRole(ROLES.WITHDRAW_ROLE, config.admin);
    await inventory.grantRole(ROLES.MINTER_ROLE, config.minter1);

    console.log(`Deployed Inventory at ${proxyAddress} (proxy)`);
    console.log(`Implementation at ${inventoryImplementationAddress}`);
    console.log(`\n✅ Deployment Summary:`);
    console.log(`  TimelockController: ${timelockAddress}`);
    console.log(`  Inventory (Proxy): ${proxyAddress}`);
    console.log(`  Inventory (Implementation): ${inventoryImplementationAddress}`);
    console.log(`  Admin: ${config.admin}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  Minter: ${config.minter1}`);

}
