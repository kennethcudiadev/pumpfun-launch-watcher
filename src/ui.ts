import Table from 'cli-table3';
import chalk from 'chalk';
import { LaunchRecord, LAMPORTS_PER_SOL } from './types';

/**
 * Lightweight terminal dashboard. Clears the screen and reprints on each
 * tick. We intentionally avoid blessed/ink here — both pull in a lot of
 * dependency surface and have rough edges on Windows PowerShell.
 *
 * `recent` holds the most recent N completed launches; `live` holds the
 * in-flight ones being tracked. Both are merged for display, with live
 * entries highlighted.
 */
export interface DashboardState {
  recent: LaunchRecord[]; // closed launches, newest first
  live: LaunchRecord[];   // currently being tracked, newest first
  startedAt: number;
  totalLaunches: number;
  totalGraduated: number;
  totalRugged: number;
  wsState: 'connecting' | 'open' | 'closed';
  cachedCreators: number;
  logFile: string;
}

export class Dashboard {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private getState: () => DashboardState,
    private opts: { rows: number; refreshMs: number; headless: boolean },
  ) {}

  start(): void {
    if (this.opts.headless) return;
    if (this.timer) return;
    this.timer = setInterval(() => this.render(), this.opts.refreshMs);
    this.render();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private render(): void {
    const s = this.getState();
    const out: string[] = [];

    out.push(chalk.bold.cyan('pumpfun-launch-watcher') + chalk.gray(' — live'));
    out.push(headerLine(s));
    out.push('');

    const merged = [...s.live, ...s.recent].slice(0, this.opts.rows);
    out.push(renderTable(merged));

    out.push('');
    out.push(footerLine(s));

    // Hide cursor + clear + redraw — cheap and robust.
    process.stdout.write('\x1b[?25l\x1b[2J\x1b[H' + out.join('\n') + '\n');
  }
}

function headerLine(s: DashboardState): string {
  const wsColor =
    s.wsState === 'open' ? chalk.green : s.wsState === 'connecting' ? chalk.yellow : chalk.red;
  const upMs = Date.now() - s.startedAt;
  return [
    `ws=${wsColor(s.wsState)}`,
    chalk.gray(`up=${formatDuration(upMs)}`),
    chalk.gray(`launches=${s.totalLaunches}`),
    chalk.green(`graduated=${s.totalGraduated}`),
    chalk.red(`rugged=${s.totalRugged}`),
    chalk.gray(`creators_cached=${s.cachedCreators}`),
  ].join('  ');
}

function footerLine(s: DashboardState): string {
  const gradPct = s.totalLaunches > 0 ? ((s.totalGraduated / s.totalLaunches) * 100).toFixed(1) : '0.0';
  const rugPct = s.totalLaunches > 0 ? ((s.totalRugged / s.totalLaunches) * 100).toFixed(1) : '0.0';
  return chalk.gray(
    `log=${s.logFile}   graduated=${gradPct}%   rugged=${rugPct}%   ` +
      `(rug stats are within-window only; real rug detection needs longer horizon)`,
  );
}

function renderTable(rows: LaunchRecord[]): string {
  const t = new Table({
    head: ['age', 'symbol', 'mint', 'creator', 'flag', 'BC%', 'buyers', 'flags', 'status'].map((h) =>
      chalk.bold(h),
    ),
    colWidths: [8, 10, 14, 14, 18, 7, 8, 26, 11],
    wordWrap: true,
    style: { head: [], border: ['gray'] },
  });

  for (const r of rows) {
    const ageMs = Date.now() - r.detectedAt;
    const lastSample = r.curveSamples[r.curveSamples.length - 1];
    const bcPct = lastSample ? `${lastSample.curvePercent.toFixed(1)}` : '–';
    const status =
      r.status === 'graduated'
        ? chalk.green('graduated')
        : r.status === 'rugged'
          ? chalk.red('rugged')
          : chalk.yellow('active');

    t.push([
      formatDuration(ageMs),
      r.symbol || '?',
      shortAddr(r.mint),
      shortAddr(r.creator),
      colorFlag(r.creatorFlag),
      bcPct,
      String(r.uniqueBuyers),
      r.flags.join(',') || '–',
      status,
    ]);
  }
  return t.toString();
}

function shortAddr(a: string): string {
  if (!a) return '–';
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function colorFlag(f: string): string {
  switch (f) {
    case 'NEW_CREATOR':
      return chalk.gray(f);
    case 'REPEAT_CREATOR':
      return chalk.cyan(f);
    case 'SERIAL_GRADUATOR':
      return chalk.green(f);
    case 'KNOWN_RUGGER':
      return chalk.red(f);
    default:
      return f;
  }
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

/** Used in headless mode and on shutdown to print one-line summaries. */
export function formatLaunchLine(r: LaunchRecord): string {
  const sol = Number(r.totalBuySol) / Number(LAMPORTS_PER_SOL);
  const lastSample = r.curveSamples[r.curveSamples.length - 1];
  const bc = lastSample ? `${lastSample.curvePercent.toFixed(1)}%` : 'n/a';
  return [
    new Date(r.detectedAt).toISOString(),
    `${r.symbol}/${shortAddr(r.mint)}`,
    `creator=${shortAddr(r.creator)}`,
    `flag=${r.creatorFlag}`,
    `buyers=${r.uniqueBuyers}`,
    `buy_sol=${sol.toFixed(3)}`,
    `bc=${bc}`,
    `status=${r.status}`,
    r.flags.length ? `flags=${r.flags.join(',')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
