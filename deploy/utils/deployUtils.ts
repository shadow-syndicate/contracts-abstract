import {Deployer} from "@matterlabs/hardhat-zksync";
import {HardhatRuntimeEnvironment} from "hardhat/types";
import {vars} from "hardhat/config";

export function getDeployerPrivateKey(hre: HardhatRuntimeEnvironment): string {
    if (hre.network.name === 'abstractMainnet') {
        const key = process.env.BETA_ABS_DEPLOYER_PRIVATE_KEY;
        if (!key) throw new Error("BETA_ABS_DEPLOYER_PRIVATE_KEY not set");
        return key;
    }
    return vars.get("DEPLOYER_PRIVATE_KEY");
}

export function sleep(timeMs: number) {
    return new Promise(resolve => setTimeout(resolve, timeMs));
}

export async function deployOnly(artifact: string, args: any[], deployer: Deployer) {
    const contract = await deployer.deploy(await deployer.loadArtifact(artifact), args);
    console.log("Deployed", artifact, "at", await contract.getAddress());
    return contract;
}

export async function verifyContract(address: string, args: any[], hre: HardhatRuntimeEnvironment) {
    console.log(`Verifying contract at ${address}...`);

    let attempts = 0;
    const maxAttempts = 3;

    for (;;) {
        try {
            await hre.run("verify:verify", {
                address: address,
                constructorArguments: args,
            });
            console.log("✅ Contract verified successfully");
            break;
        } catch (e) {
            attempts++;
            const errorMessage = e instanceof Error ? e.message : String(e);
            console.error(`Verification attempt ${attempts} failed:`, e);

            // Skip if already verified
            if (errorMessage.includes("Already Verified")) {
                console.log("✅ Contract already verified, skipping verification.");
                break;
            }

            if (attempts >= maxAttempts) {
                console.log(`⚠️  Skipping verification after ${maxAttempts} attempts. Contract deployed successfully but not verified.`);
                break;
            }

            console.log(`Waiting 6 seconds before retry...`);
            await sleep(6000);
        }
    }
}

export async function deployAndVerify(artifact: string, args: any[], deployer: Deployer, hre: HardhatRuntimeEnvironment) {
    const contract = await deployer.deploy(await deployer.loadArtifact(artifact), args);
    console.log("Deployed", await contract.getAddress());

    await verifyContract(await contract.getAddress(), args, hre);

    return contract;
}