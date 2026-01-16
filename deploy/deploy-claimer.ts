import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig, ROLES } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running deploy script for Claimer on ${hre.network.name} (${networkType})...`);

    const config = getConfig();
    const deployer = await createDeployer(hre);

    if (!config.contracts.trax) {
        throw new Error('TRAX contract address not configured for this environment');
    }

    const claimer = await deployAndVerify(
        "Claimer",
        [config.admin[0], config.signer, config.contracts.trax],
        deployer,
        hre
    );
    const claimerAddress = await claimer.getAddress();

    // Grant WITHDRAW_ROLE
    console.log(`\nGranting WITHDRAW_ROLE...`);
    await claimer.grantRole(ROLES.WITHDRAW_ROLE, config.withdraw);
    console.log(`✅ WITHDRAW_ROLE granted to ${config.withdraw}`);

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  Claimer: ${claimerAddress}`);
    console.log(`  Admins: ${config.admin.join(', ')}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  TRAX Token: ${config.contracts.trax}`);
    console.log(`\n⚠️  Note: Remember to grant MINTER_ROLE to Claimer on the TRAX token contract`);
    console.log(`  Command: await trax.grantRole(MINTER_ROLE, "${claimerAddress}")`);
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
