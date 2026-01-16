import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "hardhat";
import { createDeployer, deployAndVerify, isZkSyncNetwork } from "./utils/deployUtils";
import { getConfig, ROLES } from "./config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const networkType = isZkSyncNetwork(hre) ? 'zkSync' : 'EVM';
    console.log(`Running Gridle deploy script on ${hre.network.name} (${networkType})...`);

    const config = getConfig();
    const deployer = await createDeployer(hre);

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
    const [signer] = await hre.ethers.getSigners();
    await signer.sendTransaction({
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
