import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running deploy script for Bank on ${hre.network.name} (${networkType})...`);

    const config = getConfig();
    const deployer = await createDeployer(hre);

    const bank = await deployAndVerify(
        "Bank",
        [config.admin[0], config.signer],
        deployer,
        hre,
        "contracts/Bank.sol:Bank"
    );
    const bankAddress = await bank.getAddress();

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  Bank: ${bankAddress}`);
    console.log(`  Admin: ${config.admin[0]}`);
    console.log(`  Signer: ${config.signer}`);
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
