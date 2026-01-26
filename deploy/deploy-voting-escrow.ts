import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running VotingEscrow deploy script on ${hre.network.name} (${networkType})...`);

    const config = getConfig();
    const deployer = await createDeployer(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(`Deployer: ${deployerAddress}`);

    if (!config.contracts.roach) {
        throw new Error('ROACH contract address not configured. Deploy ROACH first with deploy-roach.ts');
    }

    const roachAddress = config.contracts.roach;
    console.log('Using ROACH:', roachAddress);

    // Deploy VeArtProxy
    console.log('Deploying VeArtProxy...');
    const veArtProxy = await deployAndVerify("contracts/velodrome/VeArtProxy.sol:VeArtProxy", [], deployer, hre);
    const veArtProxyAddress = await veArtProxy.getAddress();
    console.log('VeArtProxy:', veArtProxyAddress);

    // Deploy VotingEscrow
    console.log('Deploying VotingEscrow...');
    const votingEscrow = await deployAndVerify(
        "contracts/velodrome/VotingEscrow.sol:VotingEscrow",
        [roachAddress, veArtProxyAddress],
        deployer,
        hre
    );
    const votingEscrowAddress = await votingEscrow.getAddress();
    console.log('VotingEscrow:', votingEscrowAddress);

    console.log(`\n✅ VotingEscrow Deployment Summary:`);
    console.log(`  Network: ${hre.network.name} (${networkType})`);
    console.log(`  ROACH Token: ${roachAddress}`);
    console.log(`  VeArtProxy: ${veArtProxyAddress}`);
    console.log(`  VotingEscrow: ${votingEscrowAddress}`);
}

if (require.main === module) {
    const hre = require("hardhat");
    module.exports.default(hre)
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}
