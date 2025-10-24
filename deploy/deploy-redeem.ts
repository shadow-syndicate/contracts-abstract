import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";
import {getConfig, ROLES} from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script for TraxRedeem... 👨‍🍳`);

    // Load environment-specific configuration
    const config = getConfig();

    // Initialize the wallet using your private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));

    // Create deployer from hardhat-zksync and load the artifact of the contract we want to deploy.
    const deployer = new Deployer(hre, wallet);

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
            config.admin,
            config.admin
        ],
        deployer,
        hre
    );
    const redeemAddress = await redeem.getAddress();

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  TraxRedeem: ${redeemAddress}`);
    console.log(`  Admin: ${config.admin}`);
    console.log(`  TRAX Token: ${config.contracts.trax}`);
    console.log(`  TraxExchange: ${config.contracts.traxExchange}`);
    console.log(`  USDC: ${config.contracts.usdc}`);
    console.log(`\n⚠️  Note: If needed, grant WITHDRAW_ROLE to TraxRedeem on the TraxExchange contract`);
    console.log(`  Command: await traxExchange.grantRole(WITHDRAW_ROLE, "${redeemAddress}")`);
}
