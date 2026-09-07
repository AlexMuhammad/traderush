import type { DuelView, MarketSummary, Room, Seat } from '@traderush/sdk';

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

export async function apiMarkets(): Promise<MarketSummary[]> {
  return api<MarketSummary[]>('/api/markets', reviveMarket);
}

export async function apiDuels(address: `0x${string}`): Promise<DuelView[]> {
  return api<DuelView[]>(`/api/duels?address=${encodeURIComponent(address)}`, reviveDuel);
}

export async function apiRooms(address: `0x${string}`): Promise<{ room: Room; seat: Seat }[]> {
  return api<{ room: Room; seat: Seat }[]>(
    `/api/rooms?address=${encodeURIComponent(address)}`,
    (rows: any[]) => rows.map((r) => ({ room: reviveRoom(r.room), seat: reviveSeat(r.seat) })),
  );
}

async function api<T>(url: string, revive: (value: any) => T): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`API ${url} returned ${res.status}`);
  const body = await res.json() as ApiEnvelope<unknown>;
  if (!body.ok) throw new Error(body.error);
  return revive(body.data);
}

function reviveMarket(rows: any[]): MarketSummary[] {
  return rows.map((m) => ({
    ...m,
    ref: m.ref ? {
      ...m.ref,
      nonce: BigInt(m.ref.nonce),
      upId: BigInt(m.ref.upId),
      downId: BigInt(m.ref.downId),
    } : m.ref,
  }));
}

function reviveDuel(rows: any[]): DuelView[] {
  return rows.map((d) => ({
    ...d,
    id: BigInt(d.id),
    stake: BigInt(d.stake),
    pot: BigInt(d.pot),
  }));
}

function reviveRoom(room: any): Room {
  return {
    ...room,
    id: BigInt(room.id),
    entryDeadline: Number(room.entryDeadline),
    totalUp: BigInt(room.totalUp),
    totalDown: BigInt(room.totalDown),
    pot: BigInt(room.pot),
  };
}

function reviveSeat(seat: any): Seat {
  return {
    ...seat,
    up: BigInt(seat.up),
    down: BigInt(seat.down),
    shareUp: BigInt(seat.shareUp),
    shareDown: BigInt(seat.shareDown),
  };
}
