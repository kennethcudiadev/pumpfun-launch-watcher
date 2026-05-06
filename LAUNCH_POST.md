# How I built a real-time pump.fun launch monitor in TypeScript

If you've spent any time building Solana trading bots, you've hit the same wall: before you can write a single line of actual filter logic, you need a real-time feed of every new token launch on pump.fun. That sounds like a one-afternoon problem. It isn't. The first three afternoons go to WebSocket plumbing, Anchor instruction decoding, bonding-curve account parsing, and figuring out why your "real-time" feed is somehow 12 seconds behind the dashboards everyone else watches.

I finally got tired of rewriting it in every project, extracted it into a standalone CLI, and open-sourced it: [pumpfun-launch-watcher](https://github.com/YOUR_USERNAME/pumpfun-launch-watcher). This post walks through the wrong approaches I tried, why Geyser/WebSocket is the right primitive, and the architecture that ended up working.

## The problem

A trading bot or alerter that targets new launches needs three things, in order:

1. **Notification that a new mint exists** — within ~1 slot (≈400ms) of confirmation.
2. **Enough metadata to score it** — creator wallet, name/symbol, initial bonding-curve state.
3. **Continuous post-launch flow** — every buy and sell in the first 30–120 seconds, with wallet, SOL amount, and time-since-launch.

If any of those three is missing or late, your filter has nothing to work with. The whole pipeline downstream — scoring, filtering, alerting, sniping — is bottlenecked by the freshness of the upstream feed.

## The wrong approaches

**Polling `getProgramAccounts`.** The first thing everyone tries. Hit the RPC every few seconds, ask for all accounts owned by the pump.fun program, diff against the previous response, and the new ones are launches. This works until you measure latency. By the time the response comes back, the launch is 5–15 seconds old; the first 50 trades have already happened; any sniper that mattered is already in profit or out. You're not running a launch monitor, you're running a delayed launch ledger.

**Scraping the pump.fun frontend.** Tempting because the data is right there. But the frontend is rate-limited, the API is undocumented and changes without warning, you're now adding a layer of latency *and* fragility, and you're one Cloudflare update away from a broken bot. Don't.

**Subscribing to slot updates and decoding every tx.** You can do this, but you'll be decoding ~5,000 transactions per slot to find the ~2 you care about. Burns CPU and RPC quota for nothing.

## Why Geyser/WebSocket is the right primitive

Solana RPC providers expose a method called `logsSubscribe` over WebSocket. You hand it a program ID and a commitment level; it pushes a notification every time a transaction touching that program is confirmed. That's the entire interface. No polling, no diffing, no scraping. Latency is one slot plus network — typically under a second end-to-end.

For applications that need even lower latency (sub-slot), Helius and a few other providers expose a Geyser-enhanced endpoint that streams account state changes ahead of confirmation. Same architectural shape, different transport. The watcher defaults to standard `logsSubscribe` (works on Helius's free tier) and lets you swap in Atlas Geyser via a one-line `.env` change.

The full subscription is small enough to fit in a paragraph:

```ts
const msg = {
  jsonrpc: '2.0',
  id: this.reqId++,
  method: 'logsSubscribe',
  params: [
    { mentions: [this.programId] },
    { commitment: 'confirmed' },
  ],
};
this.ws.send(JSON.stringify(msg));
```

Every notification gives you a transaction signature, which you then fetch and decode.

## Architecture

The watcher splits into five small modules so each concern can be replaced without touching the others:

```
WS logsSubscribe → parser → tracker → { logger, dashboard }
                              ↑
                       creator-history (LRU)
```

- **stream.ts** holds the WebSocket connection, handles reconnect with exponential backoff, deduplicates signatures across reconnects.
- **parser.ts** Anchor-decodes the pump.fun `create`, `buy`, and `sell` instructions plus the bonding-curve account.
- **tracker.ts** opens a 120-second window per launch, dispatches incoming trades into the right window by mint, samples the bonding curve at 30s/60s/120s, and finalizes the record at window close.
- **creator-history.ts** is an LRU-bounded cache that tags each launch's creator with one of `NEW_CREATOR`, `REPEAT_CREATOR`, `SERIAL_GRADUATOR`, `KNOWN_RUGGER`.
- **logger.ts** appends every closed record to `launches.jsonl` for offline analysis.
- **ui.ts** renders a `cli-table3` dashboard that redraws once per second.

The cleanest part of the design ended up being the tracker. It exposes two methods — `onLaunch` (start a window) and `onTrade` (route a trade into an open window) — and emits a single `'record'` event when the window closes. Everything downstream subscribes to that:

```ts
tracker.on('record', (rec: LaunchRecord) => {
  logger.write(rec);
  if (rec.status === 'graduated') stats.totalGraduated++;
  recentClosed.unshift(rec);
});
```

Decoupling the window state machine from disk I/O and rendering meant I could swap `cli-table3` for a future `blessed` UI, or add a Postgres sink, without touching the tracking logic.

## The annoying details

Two things ate disproportionate time:

**Anchor instruction layouts.** Pump.fun uses Anchor, so every instruction has an 8-byte sha256-derived discriminator followed by Borsh-encoded args. The discriminator for `create` is `181ec828051c0777`. Once you know that, parsing is straightforward — but the IDL isn't published in a clean form, so account-index conventions (`mint=accounts[0]`, `creator=accounts[7]` for `create`; `mint=accounts[2]`, `user=accounts[6]` for trades) come from reading other people's source. Documenting them in the parser is half the value of this repo.

**SOL amounts on trades.** The `buy`/`sell` instruction args contain `max_sol_cost` / `min_sol_output`, which are *bounds*, not actual amounts. Real SOL flow has to come from pre/post balance deltas in the transaction meta. The watcher computes per-account deltas once per transaction and joins them onto each trade event:

```ts
function buildSolDeltas(tx: ParsedTransactionWithMeta): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const meta = tx.meta;
  if (!meta) return out;
  const keys = tx.transaction.message.accountKeys;
  for (let i = 0; i < keys.length; i++) {
    const delta = BigInt(meta.postBalances[i]) - BigInt(meta.preBalances[i]);
    out.set(keys[i].pubkey.toBase58(), delta < 0n ? -delta : delta);
  }
  return out;
}
```

Approximate (off by transaction-fee lamports) but accurate enough for filtering and analytics.

## What I learned

- **WebSocket reconnect is non-optional.** Helius will close idle sockets after about 60 seconds, so the watcher pings every 30s and reconnects with exponential backoff (1s → 30s cap). Without this, a single network blip kills the feed.
- **Bigints everywhere.** Anything that originates as a Solana `u64` lives as a `bigint` in memory and as a string in the JSONL. Trying to use `number` will silently lose precision on token amounts above 2^53.
- **Creator history is the strongest non-flow signal.** Order-flow signals (first buyers, buy/sell ratio) are noisy. A wallet's prior behavior — graduation rate, rug rate — is the most predictive thing you can compute cheaply.
- **120 seconds is the right post-launch window for this tool.** Long enough to see meaningful flow, short enough to keep the in-flight tracking set bounded. Real rug detection needs hours and belongs in a separate process.

## Try it

```bash
git clone https://github.com/YOUR_USERNAME/pumpfun-launch-watcher.git
cd pumpfun-launch-watcher
npm install
cp .env.example .env  # add your HELIUS_API_KEY
npm run dev
```

Code, README, and roadmap on GitHub: **https://github.com/YOUR_USERNAME/pumpfun-launch-watcher**

PRs welcome — the most useful next contribution is a long-horizon outcome scanner so the rug stats become genuinely meaningful. If you build something downstream of the JSONL feed, drop a link in the issues; I'd like to see it.
