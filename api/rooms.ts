import { addressParam, fail, json, limitParam, method, roomAdapter } from './_lib';

export default async function handler(req: any, res: any) {
  if (!method(req, res)) return;
  const address = addressParam(req);
  if (!address) {
    json(res, 400, { ok: false, error: 'address query param must be a 0x address' });
    return;
  }

  try {
    const rooms = await roomAdapter();
    const rows = await rooms.listFor(address, limitParam(req, 40, 100));
    json(res, 200, { ok: true, data: rows }, 'public, max-age=0, s-maxage=5, stale-while-revalidate=30');
  } catch (e) {
    fail(res, e);
  }
}
