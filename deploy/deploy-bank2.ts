import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running deploy script for BankV2 on ${hre.network.name} (${networkType})...`);

    const config = getConfig();
    const deployer = await createDeployer(hre);

    if (!config.contracts.trax) {
        throw new Error("TRAX token address not configured");
    }

    const bank = await deployAndVerify(
        "BankV2",
        [config.admin[0], config.withdraw, config.signer, config.contracts.trax],
        deployer,
        hre
    );
    const bankAddress = await bank.getAddress();

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  BankV2: ${bankAddress}`);
    console.log(`  Admin: ${config.admin[0]}`);
    console.log(`  Withdraw: ${config.withdraw}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  TRAX Token: ${config.contracts.trax}`);
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
