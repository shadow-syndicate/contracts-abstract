import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify, getDeployerPrivateKey} from "./utils/deployUtils";

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script for test contracts... 👨‍🍳`);

    // Initialize the wallet using your private key.
    const wallet = new Wallet(getDeployerPrivateKey(hre));

    // Create deployer from hardhat-zksync
    const deployer = new Deployer(hre, wallet);
    const deployerAddress = await wallet.getAddress();

    // Deploy ERC20Token
    console.log(`\nDeploying ERC20Token...`);
    const erc20Token = await deployAndVerify("ERC20Token", [], deployer, hre);
    const erc20TokenAddress = await erc20Token.getAddress();
    console.log(`✅ ERC20Token deployed at ${erc20TokenAddress}`);

    // Deploy Staking (uses ERC20Token as staking token)
    console.log(`\nDeploying Staking...`);
    const staking = await deployAndVerify("Staking", [erc20TokenAddress], deployer, hre);
    const stakingAddress = await staking.getAddress();
    console.log(`✅ Staking deployed at ${stakingAddress}`);

    console.log(`\n✅ Deployment Summary:`);
    console.log(`  ERC20Token: ${erc20TokenAddress}`);
    console.log(`  Staking: ${stakingAddress}`);
    console.log(`  Deployer: ${deployerAddress}`);
}