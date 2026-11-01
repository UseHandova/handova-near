/**
 * Test helper: deploy RentFlowEscrow / RentFlowNFT the way production does — implementation behind an ERC1967 proxy,
 * initialized in the same transaction. Returns the proxy address (the one the app talks to).
 */

import { readFileSync } from 'node:fs';
import { encodeFunctionData, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';

const art = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { abi: unknown[]; bytecode: { object: Hex } };

export async function deployProxied(wallet: WalletClient, pc: PublicClient, name: 'RentFlowEscrow' | 'RentFlowNFT', initArgs: unknown[]): Promise<Address> {
  const impl = art(`contracts/out/${name}.sol/${name}.json`);
  const proxy = art('contracts/out/ERC1967Proxy.sol/ERC1967Proxy.json');
  const deploy = async (abi: unknown[], bytecode: Hex, args: unknown[]) => {
    const hash = await wallet.deployContract({ abi, bytecode, args, account: wallet.account!, chain: wallet.chain } as never);
    return (await pc.waitForTransactionReceipt({ hash })).contractAddress!;
  };
  const implAddress = await deploy(impl.abi, impl.bytecode.object, []);
  const data = encodeFunctionData({ abi: impl.abi as never, functionName: 'initialize' as never, args: [...initArgs, wallet.account!.address] as never });
  return deploy(proxy.abi, proxy.bytecode.object, [implAddress, data]);
}
