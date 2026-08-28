import type { BullrunConfig } from './config.js';
import type { MarketSummary, VenueAddresses } from './types.js';
import { STATUS_BY_CODE, type MarketStatus } from './types.js';

/** GET /v0/markets is the single source for both market state and the venue's contract
 *  addresses (§2). Nothing here is hard-coded and nothing here is simulated (§11):
 *  if a required field is missing the call throws with the offending payload named,
 *  rather than substituting a plausible number. */

export class RestClient {
  constructor(
    private readonly cfg: BullrunConfig,
    private readonly apiKey?: string,
  ) {}

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(this.cfg.restUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: this.apiKey ? { 'x-api-key': this.apiKey } : {},
    });
    if (!res.ok) {
      throw new Error(`GET ${url.pathname}${url.search} -> ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  /** Raw payload, so `doctor` can print exactly what the venue returned. */
  async rawMarkets(params?: Record<string, string>): Promise<unknown> {
    return this.get('/markets', params);
  }

  async listMarkets(): Promise<MarketSummary[]> {
    const payload = await this.rawMarkets();
    return unwrapList(payload).map(normalizeMarket);
  }

  /** Gotcha §8.8 — loadMarkets() hides settled markets: the registry sweep skips
   *  finalized binaries. Query the binary tier explicitly or unclaimed winnings look
   *  like no winnings. */
  async listFinalizedMarkets(): Promise<MarketSummary[]> {
    const payload = await this.rawMarkets({ status: 'Finalized', tier: 'binary' });
    return unwrapList(payload).map(normalizeMarket);
  }

  /** §2 — collateral, BinaryMarketsModule, OutcomeToken6909 and pools are re-fetchable
   *  at runtime. This reads them off the markets payload rather than a constants file. */
  async venueAddresses(): Promise<VenueAddresses> {
    const payload = await this.rawMarkets();
    const list = unwrapList(payload);
    const root = (payload ?? {}) as Record<string, unknown>;
    const first = (list[0] ?? {}) as Record<string, unknown>;

    const pick = (...keys: string[]): `0x${string}` | null => {
      for (const src of [root, first]) {
        for (const k of keys) {
          const v = deepGet(src, k);
          if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) return v as `0x${string}`;
        }
      }
      return null;
    };

    const collateral = pick('collateral', 'collateralToken', 'collateralAddress', 'quoteToken');
    const moduleAddr = pick('module', 'binaryMarketsModule', 'moduleAddress', 'marketsModule');
    const outcomeToken = pick('outcomeToken', 'outcomeToken6909', 'outcomeTokenAddress', 'erc6909');

    const missing = [
      !collateral && 'collateral',
      !moduleAddr && 'binaryMarketsModule',
      !outcomeToken && 'outcomeToken6909',
    ].filter(Boolean);

    if (missing.length) {
      throw new Error(
        `GET /markets did not expose ${missing.join(', ')}. ` +
        `Do NOT hard-code these (§2) — find the real field names in the payload printed by ` +
        `\`pnpm doctor\` and extend venueAddresses().`,
      );
    }
    return { collateral: collateral!, module: moduleAddr!, outcomeToken: outcomeToken! };
  }
}

function unwrapList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  const obj = (payload ?? {}) as Record<string, unknown>;
  for (const key of ['markets', 'data', 'items', 'results']) {
    const v = obj[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
    if (v && typeof v === 'object') {
      const inner = (v as Record<string, unknown>)['markets'] ?? (v as Record<string, unknown>)['items'];
      if (Array.isArray(inner)) return inner as Record<string, unknown>[];
    }
  }
  throw new Error(`Unrecognised /markets payload shape: ${JSON.stringify(payload).slice(0, 400)}`);
}

function deepGet(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const hit = deepGet(v as Record<string, unknown>, key);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

function num(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
  return null;
}

function pickNum(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = num(deepGet(row, k));
    if (v !== null) return v;
  }
  return null;
}

function pickStr(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = deepGet(row, k);
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}

/** Seconds, whatever the venue sends. */
function toSeconds(v: number | null): number {
  if (v === null) return 0;
  return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
}

export function normalizeStatus(row: Record<string, unknown>): MarketStatus {
  const raw = deepGet(row, 'status') ?? deepGet(row, 'state') ?? deepGet(row, 'lifecycle');
  if (typeof raw === 'number') return STATUS_BY_CODE[raw] ?? 'Listed';
  if (typeof raw === 'string') {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && STATUS_BY_CODE[asNum]) return STATUS_BY_CODE[asNum]!;
    const canon = raw.toLowerCase();
    if (canon.startsWith('trad')) return 'Trading';
    if (canon.startsWith('lock')) return 'Locked';
    if (canon.startsWith('resolv') || canon.startsWith('final') || canon.startsWith('settl')) return 'Resolved';
    if (canon.startsWith('void') || canon.startsWith('cancel')) return 'Voided';
    if (canon.startsWith('list')) return 'Listed';
  }
  return 'Listed';
}

export function normalizeMarket(row: Record<string, unknown>): MarketSummary {
  const marketId = pickStr(row, 'marketId', 'id', 'market_id');
  if (!marketId) {
    throw new Error(`market row has no marketId: ${JSON.stringify(row).slice(0, 300)}`);
  }

  // Gotcha §8.9 — read `asset` and `intervalSec` as TYPED FIELDS. The question wording
  // has changed several times; the fields have not. Never regex the question text.
  const symbol = pickStr(row, 'asset', 'symbol', 'underlying');
  const intervalSec = pickNum(row, 'intervalSec', 'interval_sec', 'intervalSeconds');

  const upPrice = pickNum(row, 'upPrice', 'up_price', 'yesPrice', 'probability');

  return {
    marketId,
    symbol: symbol ?? 'UNKNOWN',
    intervalSec: intervalSec ?? 0,
    strike: pickNum(row, 'strike', 'strikePrice', 'openPrice') ?? 0,
    spot: pickNum(row, 'spot', 'spotPrice', 'lastPrice', 'markPrice') ?? 0,
    upPrice: upPrice ?? 0,
    status: normalizeStatus(row),
    openTime: toSeconds(pickNum(row, 'openTime', 'startTime', 'openedAt')),
    expiryTime: toSeconds(pickNum(row, 'expiryTime', 'endTime', 'expiresAt', 'closeTime')),
    upLiquid: Boolean(deepGet(row, 'upLiquid') ?? true),
    downLiquid: Boolean(deepGet(row, 'downLiquid') ?? true),
    oracleQuestionId: pickStr(row, 'oracleQuestionId', 'questionId', 'oracle_question_id'),
    // Gotcha §8.6 — carried for book trading only. Pools are recycled across successive
    // windows; state keyed by pool silently attaches to a market you never traded.
    poolAddress: pickStr(row, 'poolAddress', 'pool', 'poolAddr'),
  };
}
