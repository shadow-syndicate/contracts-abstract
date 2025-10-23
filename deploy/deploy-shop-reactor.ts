import {Deployer} from "@matterlabs/hardhat-zksync";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {deployAndVerify} from "./utils/deployUtils";
import {Wallet} from "zksync-ethers";
import {vars} from "hardhat/config";

export default async function (hre: HardhatRuntimeEnvironment) {
    const wallet = new Wallet(vars.get("DEPLOYER_PRIVATE_KEY"));
    const deployer = new Deployer(hre, wallet);

    console.log("Deploying Shop and Reactor contracts...");

    // Get existing contract addresses (assuming they're already deployed)
    const traxAddress = '0x7FAC607CA837D5fd709F713Ee8FA14E529156dA5';
    const inventoryAddress = '0x2A7172BC6B79CE0922CD2344a735ce3425e7F040';
    const lootboxAddress = '0xd2f05949D6F5f1453B692af06F8d00094469D1c7';
    const managerAddress = '0x140FF0190E5be1a23Ba4e8c5abCdA585997a22e9';

    if (!traxAddress || !inventoryAddress) {
        throw new Error("TRAX_ADDRESS and INVENTORY_ADDRESS must be set in environment variables");
    }

    console.log("Using TRAX at:", traxAddress);
    console.log("Using Inventory at:", inventoryAddress);
    console.log("Using Lootbox at:", lootboxAddress);

    // Deploy Shop contract
    const shopContract = await deployAndVerify("Shop", [
        traxAddress,      // TRAX token address
        inventoryAddress, // Inventory contract address
        lootboxAddress,   // Lootbox contract address
        deployer.zkWallet.address, // Admin role
        deployer.zkWallet.address  // Withdraw role
    ], deployer, hre);

    console.log("Shop deployed to:", await shopContract.getAddress());

    // Deploy Reactor contract
    const batteryItemId = [1000, 1010, 1100, 1900]; // Battery item IDs
    const batteryDurations = [5* 60, 15 * 60, 15 * 60, 15 * 60]; // Durations: 5 mins, 15 mins, 1 hour
    const minReactorId = 2000;
    const maxReactorId = 20000;
    const reactorIdStep = 1000;
    const activationCount = 4;

    const reactorContract = await deployAndVerify("Reactor", [
        inventoryAddress,           // Inventory contract address
        deployer.zkWallet.address, // Admin role
        batteryItemId,             // Battery item IDs array
        batteryDurations,          // Battery durations array
        minReactorId,              // Min reactor ID
        maxReactorId,              // Max reactor ID
        reactorIdStep,             // Reactor ID step
        activationCount            // Activation count
    ], deployer, hre);

    console.log("Reactor deployed to:", await reactorContract.getAddress());

    // Grant necessary roles
    const inventoryContract = await hre.ethers.getContractAt("Inventory", inventoryAddress, deployer.zkWallet);

    console.log("Granting MINTER_ROLE to Shop contract...");
    const minterRole = await inventoryContract.MINTER_ROLE();
    await inventoryContract.grantRole(minterRole, await shopContract.getAddress());

    console.log("Granting MINTER_ROLE and BURNER_ROLE to Reactor contract...");
    const burnerRole = await inventoryContract.BURNER_ROLE();
    await inventoryContract.grantRole(minterRole, await reactorContract.getAddress());
    await inventoryContract.grantRole(burnerRole, await reactorContract.getAddress());

    // Grant MANAGER_ROLE to managerAddress on both contracts
    console.log("Granting MANAGER_ROLE to manager address...");
    const shopManagerRole = await shopContract.MANAGER_ROLE();
    const reactorManagerRole = await reactorContract.MANAGER_ROLE();

    await shopContract.grantRole(shopManagerRole, managerAddress);
    await reactorContract.grantRole(reactorManagerRole, managerAddress);

    // Create an example lot in the Shop
    console.log("Creating example lot in Shop...");
    await shopContract.createLot(
        1,
        hre.ethers.parseEther("100"),
        0, // free for lootbox holders
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000) + (300 * 24 * 60 * 60),
        [minReactorId, batteryItemId[0]],
        [1, 4],
        [minReactorId, minReactorId + 1, minReactorId + 2, minReactorId + 3, minReactorId + 4]
    );
    await shopContract.createLot(
        2,
        hre.ethers.parseEther("20"),
        hre.ethers.parseEther("14"), // priceInTraxTurbo (30% discount for lootbox holders)
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000) + (300 * 24 * 60 * 60),
        [minReactorId],
        [1],
        [minReactorId, minReactorId + 1, minReactorId + 2, minReactorId + 3, minReactorId + 4]
    );
    await shopContract.createLot(
        3,
        hre.ethers.parseEther("10"),
        hre.ethers.parseEther("7"), // priceInTraxTurbo (30% discount for lootbox holders)
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000) + (300 * 24 * 60 * 60),
        [batteryItemId[0]],
        [1],
        []
    );
    await shopContract.createLot(
        4,
        hre.ethers.parseEther("100"),
        hre.ethers.parseEther("70"), // priceInTraxTurbo (30% discount for lootbox holders)
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000) + (300 * 24 * 60 * 60),
        [batteryItemId[1]],
        [1],
        []
    );
    await shopContract.createLot(
        5,
        hre.ethers.parseEther("1000"),
        hre.ethers.parseEther("700"), // priceInTraxTurbo (30% discount for lootbox holders)
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000) + (300 * 24 * 60 * 60),
        [batteryItemId[2]],
        [1],
        []
    );
    await shopContract.createLot(
        6,
        hre.ethers.parseEther("20"),
        hre.ethers.parseEther("14"), // priceInTraxTurbo (30% discount for lootbox holders)
        Math.floor(Date.now() / 1000),
        Math.floor(Date.now() / 1000) + (300 * 24 * 60 * 60),
        [minReactorId + reactorIdStep],
        [1],
        [minReactorId + reactorIdStep, minReactorId + reactorIdStep + 1, minReactorId + reactorIdStep + 2, minReactorId + reactorIdStep + 3, minReactorId + reactorIdStep + 4]
    );
    console.log(`Created lot ${1} with price ${hre.ethers.formatEther(hre.ethers.parseEther("100"))} TRAX`);

    console.log("✅ All contracts deployed and configured successfully!");
    console.log({
        Shop: await shopContract.getAddress(),
        Reactor: await reactorContract.getAddress(),
        TRAX: traxAddress,
        Inventory: inventoryAddress,
        ExampleLotId: 1
    });
}
