/**
 * The wording people actually see when something fails.
 *
 * The first case is verbatim what the console showed for a rejected wallet
 * prompt: five lines of chain id, addresses and calldata for "you pressed no".
 * Each case asserts the title is one short line with no hex in it — a rule that
 * is easy to break by adding a rule that falls through to viem's own text.
 */
import { explainError } from '../dist/errors.js';
const cases = [
  ['wallet reject', Object.assign(new Error(
`User rejected the request. Request Arguments: chain: Somnia Shannon Testnet (id: 50312) from: 0xE11825b13C96CcBE49CFF970932375ce13daaeB4 to: 0x622259fcdeea1e09502ef03bbf1f5dc614882264 data: 0x6b7e073f0000...
Contract Call: address: 0x6222 function: open(bytes32,bool,uint128,uint64)
Docs: https://viem.sh/docs/contract/writeContract Details: User rejected the request. Version: viem@2.56.0`),
    { name: 'UserRejectedRequestError' })],
  ['revert EntryClosed', Object.assign(new Error('The contract function "join" reverted.'), {
     cause: { name: 'ContractFunctionRevertedError', data: { errorName: 'EntryClosed' } } })],
  ['allowance', new Error('reverted with custom error ERC20InsufficientAllowance(address,uint256,uint256)')],
  ['balance', new Error('ERC20InsufficientBalance(0x1, 0, 1000000)')],
  ['gas', new Error('insufficient funds for gas * price + value')],
  ['nothing to claim', Object.assign(new Error('execution reverted'), { cause: { data: { errorName: 'NothingToClaim' } } })],
  ['one sided', Object.assign(new Error('execution reverted'), { cause: { cause: { errorName: 'RoomIsOneSided' } } })],
  ['offline', new Error('HttpRequestError: Failed to fetch')],
  ['chain', new Error('The current chain of the wallet (id: 1) does not match the target chain for the transaction (id: 50312)')],
  ['unknown', new Error('Something nobody mapped\nsecond line with junk')],
];
let bad = 0;
for (const [name, e] of cases) {
  const r = explainError(e);
  const ok = r.title.length <= 120 && !/0x[0-9a-f]{20}/i.test(r.title) && !r.title.includes('\n');
  if (!ok) bad++;
  console.log(`${ok ? '✔' : '✘'} ${name.padEnd(16)} ${r.benign ? '[benign] ' : ''}${r.title}${r.detail ? '  — ' + r.detail : ''}`);
}
console.log(bad ? `\nFAILED ${bad}` : `\nPASS ${cases.length} cases, raw always retained`);
process.exit(bad ? 1 : 0);
