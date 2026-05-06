import { Connection, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';
import {
  BC_GRADUATION_REAL_SOL_RESERVES,
  Config,
  CreateEvent,
  CurveSample,
  LaunchRecord,
  TokenStatus,
  TradeEvent,
  TrackedTrade,
} from './types';
import { CreatorHistory, classifyCreator } from './creator-history';
import { decodeBondingCurveAccount } from './parser';

const WHALE_BUYER_LAMPORTS = 1_000_000_000n; // >= 1 SOL in a single buy

/**
 * Holds an in-flight tracking window for a single launch. The Tracker
 * dispatches incoming trades into the right window by mint, samples the
 * bonding curve at the configured checkpoints, then finalizes and emits
 * a 'record' event when the window closes.
 */
interface ActiveLaunch {
  record: LaunchRecord;
  detectedAt: number;
  buyerSet: Set<string>;
  sellerSet: Set<string>;
  checkpointTimers: NodeJS.Timeout[];
  closeTimer: NodeJS.Timeout;
}

export class Tracker extends EventEmitter {
  private active = new Map<string, ActiveLaunch>(); // mint -> ActiveLaunch

  constructor(
    private cfg: Config,
    private conn: Connection,
    private history: CreatorHistory,
  ) {
    super();
  }

  /** Returns a snapshot of in-flight records for the dashboard. */
  snapshot(): LaunchRecord[] {
    return Array.from(this.active.values()).map((a) => a.record);
  }

  /**
   * Begin tracking a freshly-detected launch. Creates the LaunchRecord with a
   * snapshot of the creator's prior history, schedules curve samples and the
   * window-close, then returns the record so callers can render it immediately.
   */
  onLaunch(ev: CreateEvent): LaunchRecord {
    const now = Date.now();
    const prior = this.history.recordLaunch(ev.creator, ev.mint, now);
    const flag = classifyCreator(prior);

    const record: LaunchRecord = {
      signature: ev.signature,
      slot: ev.slot,
      detectedAt: now,
      blockTime: ev.blockTime,
      mint: ev.mint,
      name: ev.name,
      symbol: ev.symbol,
      uri: ev.uri,
      creator: ev.creator,
      bondingCurve: ev.bondingCurve,
      creatorFlag: flag,
      creatorPriorLaunches: prior.launches,
      creatorPriorGraduated: prior.graduated,
      creatorPriorRugged: prior.rugged,
      initialVirtualSolReserves: ev.initialVirtualSolReserves,
      trades: [],
      curveSamples: [],
      uniqueBuyers: 0,
      uniqueSellers: 0,
      totalBuySol: 0n,
      totalSellSol: 0n,
      status: 'active',
      closedAt: null,
      flags: [],
    };

    const checkpointTimers = this.cfg.trackingCheckpoints
      .filter((s) => s <= this.cfg.trackingWindowSeconds)
      .map((seconds) =>
        setTimeout(() => this.sampleCurve(ev.mint, seconds), seconds * 1000),
      );
    const closeTimer = setTimeout(
      () => this.close(ev.mint),
      this.cfg.trackingWindowSeconds * 1000,
    );

    const active: ActiveLaunch = {
      record,
      detectedAt: now,
      buyerSet: new Set(),
      sellerSet: new Set(),
      checkpointTimers,
      closeTimer,
    };
    this.active.set(ev.mint, active);
    this.emit('launch', record);
    return record;
  }

  /** Route a buy/sell into the matching active launch, if any. */
  onTrade(ev: TradeEvent): void {
    const a = this.active.get(ev.mint);
    if (!a) return;

    const tracked: TrackedTrade = {
      kind: ev.kind,
      user: ev.user,
      tokenAmount: ev.tokenAmount,
      solAmount: ev.solAmount,
      msSinceLaunch: Date.now() - a.detectedAt,
      signature: ev.signature,
    };
    a.record.trades.push(tracked);

    if (ev.kind === 'buy') {
      a.buyerSet.add(ev.user);
      a.record.uniqueBuyers = a.buyerSet.size;
      a.record.totalBuySol += ev.solAmount;
      if (
        ev.solAmount >= WHALE_BUYER_LAMPORTS &&
        !a.record.flags.includes('WHALE_BUYER_PRESENT')
      ) {
        a.record.flags.push('WHALE_BUYER_PRESENT');
      }
    } else {
      a.sellerSet.add(ev.user);
      a.record.uniqueSellers = a.sellerSet.size;
      a.record.totalSellSol += ev.solAmount;
    }
  }

  private async sampleCurve(mint: string, tSeconds: number): Promise<void> {
    const a = this.active.get(mint);
    if (!a) return;
    try {
      const info = await this.conn.getAccountInfo(
        new PublicKey(a.record.bondingCurve),
        { commitment: 'confirmed' },
      );
      if (!info) return;
      const state = decodeBondingCurveAccount(Buffer.from(info.data));
      if (!state) return;

      const realSol = state.realSolReserves;
      const pct =
        Number((realSol * 10_000n) / BC_GRADUATION_REAL_SOL_RESERVES) / 100;

      const sample: CurveSample = {
        tSeconds,
        virtualSolReserves: state.virtualSolReserves,
        virtualTokenReserves: state.virtualTokenReserves,
        realSolReserves: state.realSolReserves,
        realTokenReserves: state.realTokenReserves,
        complete: state.complete,
        curvePercent: Math.min(100, Math.max(0, pct)),
      };
      a.record.curveSamples.push(sample);
      if (state.complete && a.record.status !== 'graduated') {
        a.record.status = 'graduated';
        a.record.flags.push('GRADUATED_DURING_WINDOW');
      }
    } catch (err) {
      // Sampling is best-effort; a single failed checkpoint shouldn't kill
      // the rest of the window.
      this.emit('error', err);
    }
  }

  private close(mint: string): void {
    const a = this.active.get(mint);
    if (!a) return;
    for (const t of a.checkpointTimers) clearTimeout(t);
    clearTimeout(a.closeTimer);

    a.record.closedAt = Date.now();
    a.record.status = decideStatus(a.record);
    this.history.recordOutcome(a.record.creator, a.record.status, a.record.closedAt);
    this.active.delete(mint);
    this.emit('record', a.record);
  }

  /** Stop tracking everything immediately. Used on shutdown. */
  drain(): LaunchRecord[] {
    const out: LaunchRecord[] = [];
    for (const [mint] of this.active) {
      const a = this.active.get(mint)!;
      for (const t of a.checkpointTimers) clearTimeout(t);
      clearTimeout(a.closeTimer);
      a.record.closedAt = Date.now();
      a.record.status = decideStatus(a.record);
      out.push(a.record);
    }
    this.active.clear();
    return out;
  }
}

/**
 * Final status decision at window close. We can only definitively call
 * 'graduated' from inside the tracking window (the curve account told us so).
 * Genuine rug detection needs hours, not 2 minutes — so within-window dumps
 * just get tagged as 'active' with a flag, and any longer-horizon outcome
 * tracking belongs in a follow-up tool.
 */
function decideStatus(rec: LaunchRecord): TokenStatus {
  if (rec.status === 'graduated') return 'graduated';
  // Heuristic: if total sell volume in window is >2x total buy volume AND
  // there were trades, flag as suspected dump but keep status 'active' —
  // real rug detection happens post-window.
  if (
    rec.trades.length >= 5 &&
    rec.totalBuySol > 0n &&
    rec.totalSellSol > rec.totalBuySol * 2n
  ) {
    if (!rec.flags.includes('SUSPECTED_DUMP_IN_WINDOW')) {
      rec.flags.push('SUSPECTED_DUMP_IN_WINDOW');
    }
  }
  return 'active';
}
