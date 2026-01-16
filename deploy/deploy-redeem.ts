import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running deploy script for TraxRedeem on ${hre.network.name} (${networkType})...`);

    const config = getConfig();
    const deployer = await createDeployer(hre);

    // Validate required contract addresses
    if (!config.contracts.trax) {
        throw new Error('TRAX contract address not configured for this environment');
    }
    if (!config.contracts.traxExchange) {
        throw new Error('TraxExchange contract address not configured for this environment');
    }
    if (!config.contracts.usdc) {
        throw new Error('USDC contract address not configured for this environment');
    }

    const redeem = await deployAndVerify(
        "TraxRedeem",
        [
            config.contracts.trax,
            config.contracts.traxExchange,
            config.contracts.usdc,
            config.admin[0],
            config.admin[0]
        ],
        deployer,
        hre
    );
    const redeemAddress = await redeem.getAddress();

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  TraxRedeem: ${redeemAddress}`);
    console.log(`  Admins: ${config.admin.join(', ')}`);
    console.log(`  TRAX Token: ${config.contracts.trax}`);
    console.log(`  TraxExchange: ${config.contracts.traxExchange}`);
    console.log(`  USDC: ${config.contracts.usdc}`);
    console.log(`\n⚠️  Note: If needed, grant WITHDRAW_ROLE to TraxRedeem on the TraxExchange contract`);
    console.log(`  Command: await traxExchange.grantRole(WITHDRAW_ROLE, "${redeemAddress}")`);
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
