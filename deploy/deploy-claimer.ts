import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";
import {getConfig} from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script for Claimer... 👨‍🍳`);

    // Load environment-specific configuration
    const config = getConfig();

    // Initialize the wallet using your private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));

    // Create deployer from hardhat-zksync
    const deployer = new Deployer(hre, wallet);

    if (!config.contracts.trax) {
        throw new Error('TRAX contract address not configured for this environment');
    }

    const claimer = await deployAndVerify(
        "Claimer",
        [config.admin, config.signer, config.contracts.trax],
        deployer,
        hre
    );
    const claimerAddress = await claimer.getAddress();

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  Claimer: ${claimerAddress}`);
    console.log(`  Admin: ${config.admin}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  TRAX Token: ${config.contracts.trax}`);
    console.log(`\n⚠️  Note: Remember to grant MINTER_ROLE to Claimer on the TRAX token contract`);
    console.log(`  Command: await trax.grantRole(MINTER_ROLE, "${claimerAddress}")`);
}
