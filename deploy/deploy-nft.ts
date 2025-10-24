import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script... 👨‍🍳`);

    // Initialize the wallet using your private key.
    // https://hardhat.org/hardhat-runner/docs/guides/configuration-variables
    // Run npx hardhat vars set DEPLOYER_PRIVATE_KEY and put a new wallet's private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));

    // Create deployer from hardhat-zksync and load the artifact of the contract we want to deploy.
    const deployer = new Deployer(hre, wallet);
    const deployerAddress = await wallet.getAddress();
    console.log(`deployerAddress ${deployerAddress}`);
    const admin = deployerAddress;

    const lootbox = await deployAndVerify("RoachRacingClubLootBoxes", [], deployer, hre);

    console.log(`Deployed lootbox at ${lootbox}`);

}
