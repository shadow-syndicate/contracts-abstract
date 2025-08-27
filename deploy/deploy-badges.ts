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
    const admin = 'xxx';
    const signer = 'xxx';
    const WITHDRAW_ROLE	= '0x5d8e12c39142ff96d79d04d15d1ba1269e4fe57bb9d26f43523628b34ba108ec';
    const badges = await deployAndVerify(
        "Badges",
        [admin,
            signer,
        'https://beta.roachracingclub.com/api/metadata/badge/'], deployer, hre);
    const badgesAddress = await badges.getAddress();

    await badges.grantRole(WITHDRAW_ROLE, admin);

    console.log(`Deployed Badges at ${badgesAddress}`);

}
