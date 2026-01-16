import { HardhatRuntimeEnvironment } from "hardhat/types";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running deploy script for test contracts on ${hre.network.name} (${networkType})...`);

    const deployer = await createDeployer(hre);
    const deployerAddress = await deployer.getAddress();

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

// Support for hardhat run (EVM networks)
if (require.main === module) {
    const hre = require("hardhat");
    module.exports.default(hre)
        .then(() => process.exit(0))
        .catch((error: Error) => {
            console.error(error);
            process.exit(1);
        });
}
