import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running deploy script on ${hre.network.name} (${networkType})...`);

    const deployer = await createDeployer(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(`Deployer: ${deployerAddress}`);

    const lootbox = await deployAndVerify("RoachRacingClubLootBoxes", [], deployer, hre);
    const lootboxAddress = await lootbox.getAddress();

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  Lootbox: ${lootboxAddress}`);
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
