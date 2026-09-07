import type {
  DuelAdapter,
  MarketAdapter,
  RoomAdapter,
  TradeRushConfig,
} from '../packages/sdk/dist/index.js';

type Sdk = typeof import('../packages/sdk/dist/index.js');

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function sdk(): Promise<Sdk> {
  return import('../packages/sdk/dist/index.js');
}

export async function config(): Promise<TradeRushConfig> {
  const { loadConfig } = await sdk();
  return loadConfig(process.env as Record<string, string | undefined>);
}

export function json(res: any, status: number, body: unknown, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', cache);
  res.end(JSON.stringify(body, bigintJson));
}

export function method(req: any, res: any): boolean {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.end();
    return false;
  }
  if (req.method !== 'GET') {
    json(res, 405, { ok: false, error: 'method_not_allowed' });
    return false;
  }
  return true;
}

export function addressParam(req: any): `0x${string}` | null {
  const raw = new URL(req.url ?? '/', 'https://trade-rush.vercel.app').searchParams.get('address')?.trim();
  return raw && ADDRESS_RE.test(raw) ? (raw as `0x${string}`) : null;
}

export function limitParam(req: any, fallback: number, max: number): number {
  const raw = new URL(req.url ?? '/', 'https://trade-rush.vercel.app').searchParams.get('limit');
  const n = raw ? Number(raw) : fallback;
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : fallback;
}

export async function marketAdapter(cfg?: TradeRushConfig): Promise<MarketAdapter> {
  const [{ MarketAdapter }, resolved] = await Promise.all([sdk(), cfg ?? config()]);
  return new MarketAdapter(resolved);
}

export async function duelAdapter(cfg?: TradeRushConfig): Promise<DuelAdapter> {
  const [{ DuelAdapter }, resolved] = await Promise.all([sdk(), cfg ?? config()]);
  return new DuelAdapter(resolved);
}

export async function roomAdapter(cfg?: TradeRushConfig): Promise<RoomAdapter> {
  const [{ RoomAdapter }, resolved] = await Promise.all([sdk(), cfg ?? config()]);
  return new RoomAdapter(resolved);
}

export function fail(res: any, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  json(res, 500, { ok: false, error: message });
}

function bigintJson(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}
