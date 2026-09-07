import { fail, json, marketAdapter, method } from './_lib';

export default async function handler(req: any, res: any) {
  if (!method(req, res)) return;
  const market = await marketAdapter();
  try {
    const rows = await market.listMarkets();
    json(res, 200, { ok: true, data: rows }, 'public, max-age=0, s-maxage=5, stale-while-revalidate=30');
  } catch (e) {
    fail(res, e);
  }
  // Deliberately NOT closed: the adapter is shared across invocations and holds
  // the caches. close() only stops the price feed, which no handler starts.
}
