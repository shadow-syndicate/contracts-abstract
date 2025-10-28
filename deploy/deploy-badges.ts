import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";
import {getConfig, ROLES} from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script for Badges... 👨‍🍳`);

    // Load environment-specific configuration
    const config = getConfig();

    // Initialize the wallet using your private key.
    // https://hardhat.org/hardhat-runner/docs/guides/configuration-variables
    // Run npx hardhat vars set DEPLOYER_PRIVATE_KEY and put a new wallet's private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));

    // Create deployer from hardhat-zksync and load the artifact of the contract we want to deploy.
    const deployer = new Deployer(hre, wallet);

    const badges = await deployAndVerify(
        "Badges",
        [config.admin, config.signer, config.metadata.badges],
        deployer,
        hre
    );
    const badgesAddress = await badges.getAddress();

    await badges.grantRole(ROLES.WITHDRAW_ROLE, config.withdraw);

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  Badges: ${badgesAddress}`);
    console.log(`  Admin: ${config.admin}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  Withdraw: ${config.withdraw}`);
    console.log(`  Metadata URL: ${config.metadata.badges}`);
}
