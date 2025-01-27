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
    const deployerAddress = await wallet.getAddress();
    const admin = '0xa1BCDC1001001B5cE854B736ED42dF781233dbe4';
    const minter = '0x333321b4C8442dA3275bbcdF9095463bdbd97191';
    const setPriceRole = admin;
    const withdrawRole = admin;
    const signerAddress = '0x22224a8b07A9f8D62f2ED19E37dee520CEb05AF5';
    const usdc = '0x855267887b95FB599DD792397A63913426a14E7e';

    const trax = await deployAndVerify("TRAX", [deployerAddress, minter, signerAddress], deployer, hre);
    const traxAddress = await trax.getAddress();
    const traxExchange = await deployAndVerify("TraxExchange", [traxAddress, deployerAddress, deployerAddress, withdrawRole], deployer, hre);
    const traxExchangeAddress = await traxExchange.getAddress();

    const MINTER_ROLE = '0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6';
    const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
    const SET_PRICE_ROLE = '0x415cb709e73494ed53475231a09b6302063bb747def39d02d8a6002d338f9436';
    await trax.grantRole(MINTER_ROLE, traxExchangeAddress);
    await trax.grantRole(DEFAULT_ADMIN_ROLE, admin);
    await trax.renounceRole(DEFAULT_ADMIN_ROLE, deployerAddress);

    await traxExchange.setPrice(usdc, 70_000);
    await traxExchange.grantRole(SET_PRICE_ROLE, setPriceRole);
    await traxExchange.renounceRole(SET_PRICE_ROLE, deployerAddress);
    await traxExchange.grantRole(DEFAULT_ADMIN_ROLE, admin);
    await traxExchange.renounceRole(DEFAULT_ADMIN_ROLE, deployerAddress);

    console.log(`Deployed TRAX at ${traxAddress}`);
    console.log(`Deployed TraxExchange at ${traxExchangeAddress}`);

}
