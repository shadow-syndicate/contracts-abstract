# Roach Racing Club smart contracts for Abstract Blockchain

This repository contains smart contracts for Abstract Blockchain.


- [Hardhat](/hardhat/deploy)
- [Ethers.js](/clients/src/ethers.ts)
- [Viem](/clients/src/viem.ts)

### Hardhat

1. Change directory into the `hardhat` folder and install the dependencies.

   ```bash
   npm install
   ```

This is the setup instructions for the smart contracts of this repository.

2. Compiling the contracts.

   ```bash
   npx hardhat compile
   ```

3. Create a new [Hardhat configuration variable](https://hardhat.org/hardhat-runner/docs/guides/configuration-variables) for your wallet private key.

   When prompted, enter the private key of the wallet you want to use to deploy the contract.
   It is strongly recommended to use a new wallet for this purpose.

   ```bash
   npx hardhat vars set WALLET_PRIVATE_KEY
   ```

4. Run the [deploy script](./deploy/deploy.ts) to deploy the smart contracts.

   ```bash
   npx hardhat deploy --script deploy/deploy.ts
   ```
5. Verify sources

   [Verify docs](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify)

