import { config, json, method } from './_lib';

export default async function handler(req: any, res: any) {
  if (!method(req, res)) return;
  const cfg = await config();
  json(res, 200, {
    ok: true,
    network: cfg.network,
    chainId: cfg.chainId,
    duels: Boolean(cfg.escrowAddress),
    rooms: Boolean(cfg.roomEscrowAddress),
  }, 'public, max-age=0, s-maxage=30');
}
