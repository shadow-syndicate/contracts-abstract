import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";
import {getConfig} from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script for BankV2...`);

    // Load environment-specific configuration
    const config = getConfig();

    // Initialize the wallet using your private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"), hre.ethers.provider);

    // Create deployer from hardhat-zksync
    const deployer = new Deployer(hre, wallet);

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

    console.log(`\n Deployment Summary:`);
    console.log(`  BankV2: ${bankAddress}`);
    console.log(`  Admin: ${config.admin[0]}`);
    console.log(`  Withdraw: ${config.withdraw}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  TRAX Token: ${config.contracts.trax}`);
}