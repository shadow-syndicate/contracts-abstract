import {Deployer} from "@matterlabs/hardhat-zksync";
import {HardhatRuntimeEnvironment} from "hardhat/types";

export function sleep(timeMs: number) {
    return new Promise(resolve => setTimeout(resolve, timeMs));
}

export async function deployOnly(artifact: string, args: any[], deployer: Deployer) {
    const contract = await deployer.deploy(await deployer.loadArtifact(artifact), args);
    console.log("Deployed", artifact, "at", await contract.getAddress());
    return contract;
}

export async function deployAndVerify(artifact: string, args: any[], deployer: Deployer, hre: HardhatRuntimeEnvironment) {
    const contract = await deployer.deploy(await deployer.loadArtifact(artifact), args);
    console.log("Deployed", await contract.getAddress());
    
    let attempts = 0;
    const maxAttempts = 3;
    
    for (;;) {
        try {
            await hre.run("verify:verify", {
                address: await contract.getAddress(),
                constructorArguments: args,
            });
            console.log("Contract verified successfully");
            break;
        } catch (e) {
            attempts++;
            console.error(`Verification attempt ${attempts} failed:`, e);
            
            if (attempts >= maxAttempts) {
                console.log(`Skipping verification after ${maxAttempts} attempts. Contract deployed successfully but not verified.`);
                break;
            }
            
            await sleep(6000);
        }
    }

    return contract;
}