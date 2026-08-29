import { useState } from 'react';
import { erc20Abi } from '@traderush/sdk';
import { formatUnits, isAddress } from 'viem';
import { useBalance, useSdk } from '../../sdk';
import { useWallet } from '../../walletContext';
import { useMoney } from '../components/money';
import { Key } from '../components/Key';
import { Fault, Readout, TxLine } from '../components/Readout';

/**
 * Take money out.
 *
 * A plain ERC-20 transfer of the collateral to an address you name. There is no
 * escrow involved and nothing to unwind: what is in a room or a duel is not in
 * this balance, so this screen can never move money that is already committed.
 *
 * The address is checked here rather than left to the node. A transfer to a
 * mistyped address is final, and a wallet's confirmation dialog is the wrong
 * place to notice.
 */
export function WithdrawPanel({ onBack }: { onBack: () => void }) {
  const { cfg, market } = useSdk();
  const { conn } = useWallet();
  const money = useMoney();
  const balance = useBalance(conn?.account.address as `0x${string}` | undefined);

  const [to, setTo] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hash, setHash] = useState<string | null>(null);

  if (!conn) {
    return <Readout title="Withdraw"><p className="note err">Sign in first.</p></Readout>;
  }

  let amount = 0n;
  try { amount = money.parse(amountStr || '0'); } catch { /* surfaced below */ }

  const toOk = isAddress(to.trim());
  const self = toOk && to.trim().toLowerCase() === conn.account.address.toLowerCase();
  const enough = balance !== null && amount > 0n && amount <= balance;
  const ready = toOk && !self && enough && !pending;

  // Why the key is dead, said once, in the place the eye already is.
  const blocker = !to ? 'enter a destination'
    : !toOk ? 'that is not an address on this chain'
    : self ? 'that is this wallet'
    : amount === 0n ? 'enter an amount'
    : balance !== null && amount > balance ? 'more than the balance'
    : null;

  const send = async () => {
    setPending(true); setError(null);
    try {
      const { request } = await market.publicClient.simulateContract({
        account: conn.account, address: cfg.addresses.collateral, abi: erc20Abi,
        functionName: 'transfer', args: [to.trim() as `0x${string}`, amount],
      });
      const tx = await conn.wallet.writeContract({ ...request, chain: cfg.chain });
      await market.publicClient.waitForTransactionReceipt({ hash: tx });
      setHash(tx);
      setAmountStr('');
    } catch (e) { setError(e); }
    finally { setPending(false); }
  };

  return (
    <>
      <div className="q">
        <span className="exp">{cfg.chainName}</span>
        Send <b>{cfg.collateralSymbol}</b> out of this wallet. It goes straight
        there — there is nothing to undo.
      </div>

      <div className="order">
        <div className="trayrow">
          <div className="calc">
            <span>balance</span>
            <span className="lamp">
              {balance === null ? '…' : formatUnits(balance, cfg.decimals)}
            </span>
          </div>
          <div className="calc">
            <span>sending</span>
            <span>{amount > 0n ? money.format(amount) : '—'}</span>
          </div>
        </div>
      </div>

      <div className="order">
        <label className="field">
          <span>to address</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
          />
        </label>
        <label className="field field--inline">
          <span>amount ({money.symbol})</span>
          <input value={amountStr} onChange={(e) => setAmountStr(e.target.value)} inputMode="decimal" />
        </label>
        <div className="calc">
          <span>{blocker ? 'blocked' : 'ready'}</span>
          <span className={blocker ? 'dn' : 'up'}>{blocker ?? 'the key is live'}</span>
        </div>
      </div>

      {/* Money already in a room or a duel is not in this balance, so there is
          no way to accidentally withdraw a position from here. Worth saying,
          because "withdraw" on a betting app usually implies otherwise. */}
      <p className="hint">
        Stakes already in a room or duel are not part of this balance and cannot be
        sent from here. Collect them first.
      </p>

      <div className="calls calls--act">
        <Key onPress={onBack}><span className="nm">back</span></Key>
        <Key lit={ready} disabled={!ready} onPress={() => void send()}>
          <span className="nm">{pending ? 'sending…' : 'withdraw'}</span>
        </Key>
      </div>

      {hash && <TxLine hash={hash} label="sent" />}
      {error ? <Fault error={error} /> : null}
    </>
  );
}
