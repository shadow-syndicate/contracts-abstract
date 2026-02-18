import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig, ROLES } from "./config";
import { parseEther } from "ethers";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running deploy script for RetroDrop on ${hre.network.name} (${networkType})...`);

    const config = getConfig();
    const deployer = await createDeployer(hre);

    if (!config.contracts.roach) {
        throw new Error('ROACH contract address not configured for this environment');
    }

    if (!config.contracts.votingEscrow) {
        throw new Error('VotingEscrow contract address not configured for this environment');
    }

    // Dev: 5 minutes epoch, 3 max lock weeks
    // Prod: 1 week epoch, 208 max lock weeks
    const isTestnet = config.network.toLowerCase().includes('testnet');
    const epoch = isTestnet ? 5 * 60 : 7 * 24 * 60 * 60; // 5 min or 1 week
    const maxLockWeeks = isTestnet ? 3 : 208;

    console.log(`Using ${isTestnet ? 'DEV' : 'PROD'} params: epoch=${epoch}s, maxLockWeeks=${maxLockWeeks}`);

    const retroDrop = await deployAndVerify(
        "RetroDrop",
        [config.admin[0], config.signer, config.contracts.roach, config.contracts.votingEscrow, epoch, maxLockWeeks],
        deployer,
        hre
    );
    const retroDropAddress = await retroDrop.getAddress();

    // Grant WITHDRAW_ROLE to withdraw address
    console.log(`\nGranting WITHDRAW_ROLE...`);
    await retroDrop.grantRole(ROLES.WITHDRAW_ROLE, config.withdraw);
    console.log(`✅ WITHDRAW_ROLE granted to ${config.withdraw}`);

    // Mint ROACH tokens to RetroDrop on testnets
    if (isTestnet) {
        const mintAmount = parseEther("1000000"); // 1M ROACH
        console.log(`\nMinting ${mintAmount} ROACH to RetroDrop...`);
        const roachArtifact = await deployer.loadArtifact("ROACH");
        const roach = new (await import("ethers")).Contract(
            config.contracts.roach,
            roachArtifact.interface,
            deployer.getSigner()
        );
        await roach.mint(retroDropAddress, mintAmount);
        console.log(`✅ Minted 1,000,000 ROACH to RetroDrop`);
    }

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  RetroDrop: ${retroDropAddress}`);
    console.log(`  Admins: ${config.admin.join(', ')}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  ROACH Token: ${config.contracts.roach}`);
    console.log(`  VotingEscrow: ${config.contracts.votingEscrow}`);
    console.log(`  Epoch: ${epoch}s (${isTestnet ? '5 min' : '1 week'})`);
    console.log(`  Max Lock Weeks: ${maxLockWeeks}`);
    if (!isTestnet) {
        console.log(`\n⚠️  Note: Remember to fund the RetroDrop contract with ROACH tokens`);
        console.log(`  Command: await roach.transfer("${retroDropAddress}", amount)`);
    }
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