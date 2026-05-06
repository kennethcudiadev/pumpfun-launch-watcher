/**
 * Shared types for pumpfun-launch-watcher.
 *
 * Numeric on-chain values that originate as `u64` are kept as `bigint`
 * so we never lose precision. Convert to `number` only at the display
 * boundary (with explicit lamport->SOL division).
 */

export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Pump.fun bonding-curve constants (mainnet). */
export const BC_INITIAL_VIRTUAL_SOL_RESERVES = 30_000_000_000n; // 30 SOL
export const BC_INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_000_000_000n;
export const BC_GRADUATION_REAL_SOL_RESERVES = 85_000_000_000n; // ~85 SOL deposited triggers raydium migration

/** Anchor 8-byte instruction discriminators (sha256("global:<name>")[:8], hex). */
export const DISCRIMINATORS = {
  create: '181ec828051c0777',
  buy: '66063d1201daebea',
  sell: '33e685a4017f83ad',
} as const;

export type EventKind = 'create' | 'buy' | 'sell';

/** A decoded create instruction. */
export interface CreateEvent {
  kind: 'create';
  signature: string;
  slot: number;
  blockTime: number | null; // unix seconds
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  bondingCurve: string;
  initialVirtualSolReserves: bigint;
  initialVirtualTokenReserves: bigint;
}

/** A decoded buy or sell instruction. */
export interface TradeEvent {
  kind: 'buy' | 'sell';
  signature: string;
  slot: number;
  blockTime: number | null;
  mint: string;
  user: string;
  /** Token amount traded (raw, in token base units). */
  tokenAmount: bigint;
  /** SOL amount paid (buy) or received (sell), in lamports. Best-effort from logs/balance deltas. */
  solAmount: bigint;
}

export type PumpEvent = CreateEvent | TradeEvent;

/** A single buy/sell observed during the post-launch tracking window. */
export interface TrackedTrade {
  kind: 'buy' | 'sell';
  user: string;
  tokenAmount: bigint;
  solAmount: bigint;
  /** Milliseconds since launch detection. */
  msSinceLaunch: number;
  signature: string;
}

/** Sample of the bonding curve state at a checkpoint. */
export interface CurveSample {
  /** Seconds since launch detection. */
  tSeconds: number;
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  complete: boolean;
  /** 0..100 — % of the way to graduation by deposited real SOL. */
  curvePercent: number;
}

export type CreatorFlag =
  | 'NEW_CREATOR'
  | 'REPEAT_CREATOR'
  | 'SERIAL_GRADUATOR'
  | 'KNOWN_RUGGER';

export type TokenStatus = 'active' | 'graduated' | 'rugged';

export interface CreatorRecord {
  creator: string;
  launches: number;
  graduated: number;
  rugged: number;
  /** Mints launched by this creator, oldest first. Bounded to last 50. */
  recentMints: string[];
  firstSeen: number; // unix ms
  lastSeen: number;  // unix ms
}

/** Aggregated record of one launch — the row shown in the dashboard and written to JSONL. */
export interface LaunchRecord {
  // identity
  signature: string;
  slot: number;
  detectedAt: number; // unix ms
  blockTime: number | null;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
  bondingCurve: string;

  // creator context (snapshot at launch)
  creatorFlag: CreatorFlag;
  creatorPriorLaunches: number;
  creatorPriorGraduated: number;
  creatorPriorRugged: number;

  // post-launch tracking
  initialVirtualSolReserves: bigint;
  trades: TrackedTrade[];
  curveSamples: CurveSample[];
  uniqueBuyers: number;
  uniqueSellers: number;
  totalBuySol: bigint;
  totalSellSol: bigint;
  /** Final status decision, written when the tracker closes the window. */
  status: TokenStatus;
  /** Window-end timestamp; null while still tracking. */
  closedAt: number | null;
  flags: string[]; // free-form: ['WHALE_BUYER_PRESENT', ...]
}

/** App-wide config, loaded from env with defaults. */
export interface Config {
  heliusApiKey: string;
  rpcHttpUrl: string;
  wsUrl: string;
  pumpfunProgramId: string;
  logFile: string;
  trackingWindowSeconds: number;
  trackingCheckpoints: number[];
  maxCreatorsCached: number;
  dashboardRecentRows: number;
  dashboardRefreshMs: number;
  headless: boolean;
}
