import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, verifyContract, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig } from "./config";

// Upgrade script for Reactor proxy
// Usage: DEPLOY_ENV=devAbs npx hardhat deploy-zksync --script deploy/upgrade-reactor.ts

export default async function (hre: HardhatRuntimeEnvironment) {
    const env = process.env.DEPLOY_ENV || "devAbs";
    const config = getConfig();
    const proxyAddress = config.contracts.reactorProxy;

    if (!proxyAddress) {
        throw new Error(`Reactor proxy address not configured for environment: ${env}`);
    }

    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`\n🔄 Upgrading Reactor on ${hre.network.name} (${networkType})...`);
    console.log(`Environment: ${env}`);
    console.log(`Proxy Address: ${proxyAddress}`);

    const deployer = await createDeployer(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(`Deployer: ${deployerAddress}`);

    // Deploy new Reactor implementation
    console.log("\n📦 Deploying new Reactor implementation...");
    const reactorArtifact = await deployer.loadArtifact("Reactor");
    const reactorImplementation = await reactorArtifact.deploy([]);
    const newImplementationAddress = await reactorImplementation.getAddress();
    console.log(`New implementation deployed at: ${newImplementationAddress}`);

    // Verify new implementation
    await verifyContract(newImplementationAddress, [], hre, "contracts/Reactor.sol:Reactor");

    // Get the Reactor contract interface at proxy address
    const reactorContract = await hre.ethers.getContractAt("Reactor", proxyAddress, deployer.getSigner());

    // Check current admin
    const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
    const hasRole = await reactorContract.hasRole(DEFAULT_ADMIN_ROLE, deployerAddress);
    console.log(`\nDeployer has DEFAULT_ADMIN_ROLE: ${hasRole}`);

    if (!hasRole) {
        console.error("❌ Deployer does not have admin role!");
        return;
    }

    // Perform upgrade
    console.log(`\n🔄 Upgrading proxy to new implementation...`);
    const upgradeTx = await reactorContract.upgradeToAndCall(newImplementationAddress, "0x");
    console.log(`Transaction hash: ${upgradeTx.hash}`);

    await upgradeTx.wait();
    console.log(`✅ Upgrade completed successfully!`);

    // Verify upgrade
    const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    const implAddress = await hre.ethers.provider.getStorage(proxyAddress, implSlot);
    const actualImpl = "0x" + implAddress.slice(-40);

    console.log(`\nVerification:`);
    console.log(`  Expected implementation: ${newImplementationAddress.toLowerCase()}`);
    console.log(`  Actual implementation:   ${actualImpl.toLowerCase()}`);
    console.log(`  Match: ${actualImpl.toLowerCase() === newImplementationAddress.toLowerCase()}`);
}