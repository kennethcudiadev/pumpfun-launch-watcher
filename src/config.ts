import dotenv from 'dotenv';
import { Config } from './types';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '' || v.startsWith('your_')) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v;
}

function optInt(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function optBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return def;
  return v.toLowerCase() === 'true' || v === '1';
}

export function loadConfig(): Config {
  const heliusApiKey = required('HELIUS_API_KEY');
  const rpcHttpUrl =
    process.env.RPC_HTTP_URL?.trim() ||
    `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  const wsUrl =
    process.env.WS_URL?.trim() ||
    `wss://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;

  const checkpoints = (process.env.TRACKING_CHECKPOINTS || '30,60,120')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  return {
    heliusApiKey,
    rpcHttpUrl,
    wsUrl,
    pumpfunProgramId:
      process.env.PUMPFUN_PROGRAM_ID?.trim() ||
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    logFile: process.env.LOG_FILE?.trim() || './launches.jsonl',
    trackingWindowSeconds: optInt('TRACKING_WINDOW_SECONDS', 120),
    trackingCheckpoints: checkpoints.length ? checkpoints : [30, 60, 120],
    maxCreatorsCached: optInt('MAX_CREATORS_CACHED', 10_000),
    dashboardRecentRows: optInt('DASHBOARD_RECENT_ROWS', 10),
    dashboardRefreshMs: optInt('DASHBOARD_REFRESH_MS', 1000),
    headless: optBool('HEADLESS', false),
  };
}
