import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify, getDeployerPrivateKey} from "./utils/deployUtils";
import {getConfig} from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script for Bank...`);

    // Load environment-specific configuration
    const config = getConfig();

    // Initialize the wallet using your private key.
    const wallet = new Wallet(getDeployerPrivateKey(hre), hre.ethers.provider);

    // Create deployer from hardhat-zksync
    const deployer = new Deployer(hre, wallet);

    const bank = await deployAndVerify(
        "Bank",
        [config.admin[0], config.signer],
        deployer,
        hre
    );
    const bankAddress = await bank.getAddress();

    console.log(`\n Deployment Summary:`);
    console.log(`  Bank: ${bankAddress}`);
    console.log(`  Admin: ${config.admin[0]}`);
    console.log(`  Signer: ${config.signer}`);
}