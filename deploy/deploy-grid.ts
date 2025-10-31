import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";
import {getConfig, ROLES} from "./config";
import {ethers} from "ethers";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running Gridle deploy script... 🎯`);

    // Load environment-specific configuration
    const config = getConfig();

    // Initialize the wallet using your private key.
    // https://hardhat.org/hardhat-runner/docs/guides/configuration-variables
    // Run npx hardhat vars set DEPLOYER_PRIVATE_KEY and put a new wallet's private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));

    // Create deployer from hardhat-zksync and load the artifact of the contract we want to deploy.
    const deployer = new Deployer(hre, wallet);

    const grid = await deployAndVerify(
        "Gridle",
        [config.admin[0], config.signer],
        deployer,
        hre
    );
    const gridAddress = await grid.getAddress();

    // Grant additional roles
    await grid.grantRole(ROLES.WITHDRAW_ROLE, config.withdraw);
    await grid.grantRole(ROLES.REFUND_ROLE, config.minter);
    await grid.setReserveParameters(11000, 12000, ethers.parseEther("0.1"));

    // Topup contract with initial reserves
    const connectedWallet = deployer.zkWallet;
    await connectedWallet.sendTransaction({
        to: gridAddress,
        value: ethers.parseEther("0.001")
    });

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  Gridle: ${gridAddress}`);
    console.log(`  Admins: ${config.admin.join(', ')}`);
    console.log(`  Signer: ${config.signer}`);
    console.log(`  Withdraw: ${config.withdraw}`);
    console.log(`  Minter (REFUND_ROLE): ${config.minter}`);
    console.log(`  Contract topped up with 0.001 ETH initial reserves`);
}
