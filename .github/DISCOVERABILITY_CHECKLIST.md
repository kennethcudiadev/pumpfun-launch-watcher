# Pre-launch discoverability checklist

Work through this list before flipping the repo to public. Every item is something GitHub search, Google, or social platforms weight when ranking or surfacing repos. Skipping items costs reach.

## Repo metadata

- [ ] **Repo description filled** (160 characters, keyword-loaded).
  Suggested: `Real-time pump.fun token launch monitor for Solana — tracks new launches, creator history, bonding-curve velocity, first-buyer flow. Open data feed for trading bots.`
- [ ] **All 20 GitHub topic slots filled.** Repo Settings → "Topics" field. Use these exact 20:
  1. `solana`
  2. `pumpfun`
  3. `pump-fun`
  4. `trading-bot`
  5. `mev`
  6. `jito`
  7. `helius`
  8. `geyser`
  9. `defi`
  10. `memecoin`
  11. `sniper-bot`
  12. `bonding-curve`
  13. `token-launch`
  14. `real-time`
  15. `websocket`
  16. `typescript`
  17. `nodejs`
  18. `solana-bot`
  19. `copy-trading`
  20. `defi-tools`
- [ ] **Social preview image uploaded** (1280×640). See [SOCIAL_PREVIEW.md](./SOCIAL_PREVIEW.md).
- [ ] **Website link in About section** points to my profile, X handle, or personal site.
- [ ] **Sponsor button enabled** (if applicable) — Settings → "Sponsorships".

## Repo content

- [ ] **LICENSE file present** (MIT, in repo root).
- [ ] **README H1 matches repo name exactly:** `# pumpfun-launch-watcher`.
- [ ] **At least 3 H2s phrased as search queries** (currently: "How to monitor pump.fun token launches in real time", "How to track new Solana token launches and creator history", plus FAQ entries).
- [ ] **FAQ section with 8+ questions**, each phrased as a real search query.
- [ ] **Related projects section** linking sibling repos.
- [ ] **Architecture diagram** (mermaid block in README) renders correctly on GitHub.
- [ ] **Hero screenshot or animated GIF** at the top of the README. (asciinema/vhs by charm.sh).
- [ ] **Quick start gets to "running" in 4 commands or fewer.**
- [ ] **All YOUR_USERNAME placeholders replaced** in README, package.json, and Related projects links.

## Pre-publish smoke test

- [ ] `npm install && npm run build` succeeds on a fresh clone.
- [ ] `npm run dev` runs and shows the dashboard within 10 seconds.
- [ ] No secrets, API keys, or `.env` checked in (`git log -p | grep -i 'api[_-]key'` returns nothing).
- [ ] `.gitignore` covers `.env`, `node_modules`, `dist`, `*.jsonl`.

## Release

- [ ] First commit pushed to `main`.
- [ ] Repo set to **public**.
- [ ] First tagged release (`v0.1.0`) with auto-generated release notes.
- [ ] Repo URL pasted into Twitter/X composer to verify the social preview unfurls correctly.

## Distribution (the part most repos skip)

- [ ] **Launch tweet drafted** with hero GIF, 1-line value prop, repo URL, and 3-4 hashtags (`#solana #buildonsolana #solanadev #web3`).
- [ ] **Submitted as PR to [awesome-solana](https://github.com/avareum/awesome-solana)** under the appropriate category (Tools / Bots).
- [ ] **Submitted as PR to awesome-mev** lists (e.g. [paradigmxyz/awesome-mev](https://github.com/paradigmxyz/awesome-mev) or similar curated lists).
- [ ] **Cross-posted as a dev.to article** titled as a search query (e.g. "How to monitor pump.fun token launches in real time with TypeScript"). Use [LAUNCH_POST.md](../LAUNCH_POST.md) as the draft.
- [ ] **Posted in Solana Discord `#showcase`** with a 1-paragraph pitch and the repo link.
- [ ] **Posted in r/solana** and any relevant subreddits (`r/SolanaDev`, `r/CryptoCurrency` rules permitting).
- [ ] **Tagged @helius_labs and @pumpdotfun** in the launch tweet — they sometimes amplify ecosystem tooling.
- [ ] **Listed on solanacompass.com / solana.com tooling pages** if they accept submissions.

## Post-launch

- [ ] Pin a "discussion" issue inviting feature requests / good-first-issues.
- [ ] Add a "good first issue" label to 3+ small issues so contributors have an obvious entry point.
- [ ] Schedule a follow-up post at the 1-week mark sharing an interesting finding from the JSONL data (creator graduation rate, time-to-graduate distribution, etc.) — this is the kind of content that drives a second wave of stars.
