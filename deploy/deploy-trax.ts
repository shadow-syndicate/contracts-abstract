import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig, ROLES } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running deploy script on ${hre.network.name} (${networkType})...`);

    // Load environment-specific configuration
    const config = getConfig();

    // Create universal deployer
    const deployer = await createDeployer(hre);
    const deployerAddress = await deployer.getAddress();
    console.log(`Deployer: ${deployerAddress}`);

    if (!config.contracts.usdc) {
        throw new Error('USDC contract address not configured for this environment');
    }

    const trax = await deployAndVerify("TRAX", [deployerAddress, deployerAddress, config.signer], deployer, hre);
    const traxAddress = await trax.getAddress();

    console.log('Deploying TraxExchange...');
    const traxExchange = await deployAndVerify("TraxExchange", [traxAddress, config.admin[0], config.withdraw, config.admin[0]], deployer, hre);
    const traxExchangeAddress = await traxExchange.getAddress();
    console.log('traxExchangeAddress', traxExchangeAddress);

    await trax.grantRole(ROLES.MINTER_ROLE, traxExchangeAddress);
    await trax.grantRole(ROLES.MINTER_ROLE, config.minter);

    await traxExchange.setPrice(config.contracts.usdc, 70_000);

    const redeem = await deployAndVerify("TraxRedeem", [traxAddress, traxExchangeAddress, config.contracts.usdc, config.admin[0], config.withdraw], deployer, hre);
    const redeemAddress = await redeem.getAddress();

    await traxExchange.grantRole(ROLES.WITHDRAW_ROLE, redeemAddress);

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  Network: ${hre.network.name} (${networkType})`);
    console.log(`  TRAX: ${traxAddress}`);
    console.log(`  TraxExchange: ${traxExchangeAddress}`);
    console.log(`  TraxRedeem: ${redeemAddress}`);
    console.log(`  Admins: ${config.admin.join(', ')}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  Minter: ${config.minter}`);
    console.log(`  Withdraw: ${config.withdraw}`);
    console.log(`  USDC: ${config.contracts.usdc}`);
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