import { useDuel, useMarket } from '../sdk';
import { Countdown, StatusBadge, StaleWrapper, OracleLink, useMoney } from '../components/ui';

/** S6 — Live duel. Read-only. There is no bail-out in duel mode: there is nobody to sell to. */
export function LiveDuel({ duelId }: { duelId: bigint }) {
  const duel = useDuel(duelId);
  const market = useMarket(duel?.marketId ?? null);
  const money = useMoney();

  if (!duel || duel.status !== 'Matched') return null;
  if (!market) return <p className="muted">loading market state…</p>;
  // Once the window has settled, S7 takes over.
  if (market.status === 'Resolved' || market.status === 'Voided') return null;

  const upWinning = market.spot > market.strike;
  const challengerWinning = duel.challengerUp === upWinning;
  const delta = market.spot - market.strike;

  return (
    <section>
      <h2>Duel #{String(duelId)} · live <StatusBadge status={market.status} /></h2>
      <StaleWrapper state={market}>
        <dl>
          <dt>challenger</dt>
          <dd>
            <code>{duel.challenger}</code> — {duel.challengerUp ? 'UP' : 'DOWN'} ·
            {' '}{money.format(duel.stake)}
            {challengerWinning ? <span className="ok"> · currently winning</span> : <span className="muted"> · currently behind</span>}
          </dd>
          <dt>opponent</dt>
          <dd>
            <code>{duel.opponent}</code> — {duel.challengerUp ? 'DOWN' : 'UP'} ·
            {' '}{money.format(duel.stake)}
            {!challengerWinning ? <span className="ok"> · currently winning</span> : <span className="muted"> · currently behind</span>}
          </dd>
          <dt>pot</dt><dd>{money.format(duel.pot)} — winner takes all</dd>
          <dt>strike</dt><dd>{market.strike}</dd>
          <dt>spot</dt><dd>{market.spot}</dd>
          <dt>delta</dt>
          <dd className={delta >= 0 ? 'ok' : 'err'}>{delta >= 0 ? '+' : ''}{delta.toFixed(4)} — {upWinning ? 'UP' : 'DOWN'} ahead</dd>
          <dt>expiry</dt><dd><Countdown to={market.expiryTime} /></dd>
          <dt>oracle</dt><dd><OracleLink questionId={market.oracleQuestionId} /></dd>
        </dl>
      </StaleWrapper>
      <p className="muted">
        Read-only. A duel has no exit: both legs are already minted and there is nobody to
        sell to. Settlement lands by itself — there is no claim button.
      </p>
    </section>
  );
}
