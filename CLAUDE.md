# Claude Code Instructions

## Deploying to BSC

When deploying to BSC networks (bscTestnet, bscMainnet), **always** use `--config hardhat.config.evm.ts`:

```bash
DEPLOY_ENV=danBsc npx hardhat run deploy/deploy-script.ts --config hardhat.config.evm.ts
```

The main `hardhat.config.ts` (zkSync) has no optimizer enabled, resulting in bytecode exceeding BSC's 24KB limit.

## Environments

- `danBsc` / `devBsc` - BSC testnet
- `danAbs` / `devAbs` - Abstract testnet (zkSync)
- `prodAbs` - Abstract mainnet

## Key Contracts

- **ROACH** - ERC20 token with `useFrom()` for signature-verified burns
- **ACID** - Similar to ROACH but non-transferable
- **ShopV2** - Uses `IROACH.useFrom()` and `IACID.useFrom()` for purchases
- **VotingEscrow** - Locks ROACH tokens, depends on ROACH address (immutable)