import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running Grid deploy script... 🎯`);

    // Initialize the wallet using your private key.
    // https://hardhat.org/hardhat-runner/docs/guides/configuration-variables
    // Run npx hardhat vars set DEPLOYER_PRIVATE_KEY and put a new wallet's private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));

    // Create deployer from hardhat-zksync and load the artifact of the contract we want to deploy.
    const deployer = new Deployer(hre, wallet);
    const deployerAddress = await wallet.getAddress();
    const admin = deployerAddress;
    const signer = '0x5000Ef9A8d4B4fd6dd694A254F8296d30Ba95d13';
    const WITHDRAW_ROLE = '0x5d8e12c39142ff96d79d04d15d1ba1269e4fe57bb9d26f43523628b34ba108ec';
    const REFUND_ROLE = '0x8502233096d909befbda0999bb8ea2f3a6be3c138b9fbf003752a4c8bce86f6c';

    const grid = await deployAndVerify(
        "Grid",
        [admin, signer],
        deployer,
        hre
    );
    const gridAddress = await grid.getAddress();

    // Grant additional roles
    await grid.grantRole(WITHDRAW_ROLE, admin);
    await grid.grantRole(REFUND_ROLE, admin);

    console.log(`Deployed Grid at ${gridAddress}`);
    console.log(`Admin: ${admin}`);
    console.log(`Signer: ${signer}`);
    console.log(`Roles granted: WITHDRAW_ROLE and REFUND_ROLE to admin`);
}
