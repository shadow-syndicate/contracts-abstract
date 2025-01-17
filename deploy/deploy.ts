import {Deployer} from "@matterlabs/hardhat-zksync";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";
import {HardhatRuntimeEnvironment} from "hardhat/types";

async function deployAndVerify(artifact: string, args: any[], deployer: Deployer, hre: HardhatRuntimeEnvironment) {
    const contract = await deployer.deploy(await deployer.loadArtifact(artifact), args);

    await hre.run("verify:verify", {
        address: await contract.getAddress(),
        constructorArguments: args,
    });

    return contract;
}

export default async function (hre: HardhatRuntimeEnvironment) {
    console.log(`Running deploy script... 👨‍🍳`);

    // Initialize the wallet using your private key.
    // https://hardhat.org/hardhat-runner/docs/guides/configuration-variables
    // Run npx hardhat vars set DEPLOYER_PRIVATE_KEY and put a new wallet's private key.
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));

    // Create deployer from hardhat-zksync and load the artifact of the contract we want to deploy.
    const deployer = new Deployer(hre, wallet);
    const adminRole = await wallet.getAddress();
    const minter = adminRole;
    const setPriceRole = adminRole;
    const withdrawRole = adminRole;

    const trax = await deployAndVerify("TRAX", [adminRole, minter], deployer, hre);
    const traxAddress = await trax.getAddress();
    const traxExchange = await deployAndVerify("TraxExchange", [traxAddress, adminRole, setPriceRole, withdrawRole], deployer, hre);
    const traxExchangeAddress = await traxExchange.getAddress();

    await trax.grantRole('0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6', traxExchangeAddress);
    console.log(`Deployed TRAX at ${traxAddress}`);
    console.log(`Deployed TraxExchange at ${traxExchangeAddress}`);

}
