import { loadConfig } from '@bullrun/sdk';

export const cfg = loadConfig(process.env as Record<string, string | undefined>);

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return v;
}

export const fmt = {
  ok: (s: string) => `\x1b[32m✔\x1b[0m ${s}`,
  bad: (s: string) => `\x1b[31mx\x1b[0m ${s}`,
  warn: (s: string) => `\x1b[33m!\x1b[0m ${s}`,
  head: (s: string) => `\n\x1b[1m${s}\x1b[0m`,
};
