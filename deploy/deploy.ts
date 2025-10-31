import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";
import {getConfig, ROLES} from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script... 👨‍🍳`);

    // Load environment-specific configuration
    const config = getConfig();

    // Initialize the wallet using your private key.
    // https://hardhat.org/hardhat-runner/docs/guides/configuration-variables
    // Run npx hardhat vars set DEPLOYER_PRIVATE_KEY and put a new wallet's private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));

    // Create deployer from hardhat-zksync and load the artifact of the contract we want to deploy.
    const deployer = new Deployer(hre, wallet);
    const deployerAddress = await wallet.getAddress();

    if (!config.contracts.usdc) {
        throw new Error('USDC contract address not configured for this environment');
    }

    const trax = await deployAndVerify("TRAX", [deployerAddress, deployerAddress, config.signer], deployer, hre);
    const traxAddress = await trax.getAddress();
    console.log('deployAndVerify TraxExchange');
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
    console.log(`  TRAX: ${traxAddress}`);
    console.log(`  TraxExchange: ${traxExchangeAddress}`);
    console.log(`  TraxRedeem: ${redeemAddress}`);
    console.log(`  Admins: ${config.admin.join(', ')}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  Minter: ${config.minter}`);
    console.log(`  Withdraw: ${config.withdraw}`);
    console.log(`  USDC: ${config.contracts.usdc}`);
}
