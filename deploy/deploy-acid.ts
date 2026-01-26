import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running ACID deploy script on ${hre.network.name} (${networkType})...`);

    const config = getConfig();
    const deployer = await createDeployer(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(`Deployer: ${deployerAddress}`);

    console.log('Deploying ACID token...');
    const acid = await deployAndVerify("ACID", [config.admin[0], config.minter, config.signer], deployer, hre);
    const acidAddress = await acid.getAddress();

    console.log(`\n✅ ACID Deployment Summary:`);
    console.log(`  Network: ${hre.network.name} (${networkType})`);
    console.log(`  ACID: ${acidAddress}`);
    console.log(`  Admin: ${config.admin[0]}`);
    console.log(`  Minter: ${config.minter}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`\n📝 Add to config-env.ts: acid: '${acidAddress}'`);
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
