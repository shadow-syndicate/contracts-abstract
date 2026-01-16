import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig, ROLES } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running deploy script for Badges on ${hre.network.name} (${networkType})...`);

    const config = getConfig();
    const deployer = await createDeployer(hre);

    const badges = await deployAndVerify(
        "Badges",
        [config.admin[0], config.signer, config.metadata.badges],
        deployer,
        hre
    );
    const badgesAddress = await badges.getAddress();

    await badges.grantRole(ROLES.WITHDRAW_ROLE, config.withdraw);

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  Badges: ${badgesAddress}`);
    console.log(`  Admins: ${config.admin.join(', ')}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  Withdraw: ${config.withdraw}`);
    console.log(`  Metadata URL: ${config.metadata.badges}`);
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
