import {Deployer} from "@matterlabs/hardhat-zksync";
import {HardhatRuntimeEnvironment} from "hardhat/types";

export function sleep(timeMs: number) {
    return new Promise(resolve => setTimeout(resolve, timeMs));
}

export async function deployAndVerify(artifact: string, args: any[], deployer: Deployer, hre: HardhatRuntimeEnvironment) {
    const contract = await deployer.deploy(await deployer.loadArtifact(artifact), args);
    console.log("Deployed", await contract.getAddress());
    for (;;) {
        try {
            await hre.run("verify:verify", {
                address: await contract.getAddress(),
                constructorArguments: args,
            });
            break;
        } catch (e) {
            console.error(e);
            await sleep(6000);
        }
    }

    return contract;
}