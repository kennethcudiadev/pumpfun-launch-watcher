#!/usr/bin/env node
import { Connection } from '@solana/web3.js';
import { loadConfig } from './config';
import { LogsStream } from './stream';
import { decodeTransaction } from './parser';
import { CreatorHistory } from './creator-history';
import { Tracker } from './tracker';
import { JsonlLogger } from './logger';
import { Dashboard, DashboardState, formatLaunchLine } from './ui';
import { LaunchRecord } from './types';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const conn = new Connection(cfg.rpcHttpUrl, 'confirmed');
  const history = new CreatorHistory(cfg.maxCreatorsCached);
  const tracker = new Tracker(cfg, conn, history);
  const logger = new JsonlLogger(cfg.logFile);
  const stream = new LogsStream(cfg.wsUrl, cfg.pumpfunProgramId);

  // Dedup signatures across reconnects/duplicates. Bounded simple set.
  const seen = new Set<string>();
  const recentClosed: LaunchRecord[] = [];
  const stats = { totalLaunches: 0, totalGraduated: 0, totalRugged: 0 };
  let wsState: DashboardState['wsState'] = 'connecting';

  stream.on('open', () => (wsState = 'open'));
  stream.on('close', () => (wsState = 'closed'));
  stream.on('error', (err) => {
    if (cfg.headless) process.stderr.write(`[ws] error: ${err}\n`);
  });

  stream.on('signature', async ({ signature }: { signature: string }) => {
    if (seen.has(signature)) return;
    seen.add(signature);
    if (seen.size > 50_000) {
      // Periodically prune. Set iteration order is insertion order, so
      // dropping the first N evicts the oldest signatures.
      const it = seen.values();
      for (let i = 0; i < 25_000; i++) {
        const v = it.next();
        if (v.done) break;
        seen.delete(v.value);
      }
    }

    let tx;
    try {
      tx = await conn.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    } catch (err) {
      if (cfg.headless) process.stderr.write(`[rpc] getParsedTransaction failed: ${err}\n`);
      return;
    }
    if (!tx) return;

    const events = decodeTransaction(tx, cfg.pumpfunProgramId);
    for (const ev of events) {
      if (ev.kind === 'create') {
        stats.totalLaunches++;
        const rec = tracker.onLaunch(ev);
        if (cfg.headless) process.stdout.write('LAUNCH ' + formatLaunchLine(rec) + '\n');
      } else {
        tracker.onTrade(ev);
      }
    }
  });

  tracker.on('record', (rec: LaunchRecord) => {
    logger.write(rec);
    if (rec.status === 'graduated') stats.totalGraduated++;
    if (rec.status === 'rugged') stats.totalRugged++;
    recentClosed.unshift(rec);
    if (recentClosed.length > 100) recentClosed.pop();
    if (cfg.headless) process.stdout.write('CLOSE  ' + formatLaunchLine(rec) + '\n');
  });

  tracker.on('error', (err) => {
    if (cfg.headless) process.stderr.write(`[tracker] ${err}\n`);
  });

  const dashboard = new Dashboard(
    () => ({
      recent: recentClosed,
      live: tracker.snapshot().sort((a, b) => b.detectedAt - a.detectedAt),
      startedAt: startTime,
      totalLaunches: stats.totalLaunches,
      totalGraduated: stats.totalGraduated,
      totalRugged: stats.totalRugged,
      wsState,
      cachedCreators: history.size(),
      logFile: logger.path(),
    }),
    {
      rows: cfg.dashboardRecentRows,
      refreshMs: cfg.dashboardRefreshMs,
      headless: cfg.headless,
    },
  );

  const startTime = Date.now();
  stream.start();
  dashboard.start();

  if (cfg.headless) {
    process.stdout.write(
      `[startup] watching ${cfg.pumpfunProgramId} via ${cfg.wsUrl}\n` +
        `[startup] log=${logger.path()} window=${cfg.trackingWindowSeconds}s\n`,
    );
  }

  const shutdown = (signal: string) => {
    process.stdout.write(`\n[shutdown] received ${signal}, draining...\n`);
    dashboard.stop();
    stream.stop();
    const drained = tracker.drain();
    for (const rec of drained) logger.write(rec);
    // Restore cursor.
    process.stdout.write('\x1b[?25h');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  process.stderr.write(`[fatal] ${err.stack ?? err}\n`);
  process.exit(1);
});
