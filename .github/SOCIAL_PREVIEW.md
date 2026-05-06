# GitHub social preview image

GitHub renders a 1280×640 image whenever the repo URL is shared on Twitter/X, Discord, Slack, LinkedIn, etc. Default behavior is the OWNER avatar tiled — replacing it with a custom image is one of the highest-leverage discoverability changes you can make.

## Specs

- **Dimensions:** 1280×640 pixels (exact). GitHub will reject other ratios or rescale them awkwardly.
- **Format:** PNG or JPG. PNG preferred for crisp text.
- **Max file size:** 1 MB.
- **Safe area:** keep important content within the inner 1100×500 rectangle — some clients crop edges.

## What to include

A clean, readable composition with three elements:

1. **Repo name (large):** `pumpfun-launch-watcher` — top-left or top-center, bold sans-serif (Inter, JetBrains Mono Bold, or similar). 80–100pt.
2. **One-line value prop:** `Real-time pump.fun launch monitor for Solana` — directly under the repo name, lighter weight, ~36pt.
3. **Small terminal preview (right or bottom-right):** a screenshot of the live dashboard table at ~60% width. Use a dark terminal theme so it reads against most backgrounds. The visible content should include at least one row with a colored creator flag (`SERIAL_GRADUATOR` green or `KNOWN_RUGGER` red) — that's what makes the preview *show* what the tool does instead of just telling.

Optional but high-impact:
- Solana wordmark or "Solana" tag in a corner (signals ecosystem at a glance).
- A subtle accent color tied to the dashboard's own palette so the image and the README screenshot feel like the same product.

## What to avoid

- Stock images, generic "code on screen" backgrounds, or AI-generated fantasy art.
- Long sentences. Anything past ~12 words won't be readable at thumbnail size.
- Centered text on a busy background. Solid dark background with one focal element scans best.

## Suggested tools

- **Figma** (free) — most flexible. Start a 1280×640 frame, drop in the dashboard screenshot, add text, export PNG.
- **Canva** — fastest if you don't have a design tool open. Search "GitHub social preview" templates.
- **Carbon** (carbon.now.sh) — for generating a polished terminal screenshot to embed.

## How to upload

1. Go to the repo on GitHub.
2. **Settings** (repo settings, not account) → scroll to **Social preview**.
3. Click **Edit** → **Upload an image…** and select the 1280×640 file.
4. Verify by pasting the repo URL into Twitter's tweet composer or Discord's message box and checking the unfurl preview.

## Sanity check

Once uploaded, tweet the repo URL from a throwaway/draft (don't post) and screenshot the preview card. It should:
- Be sharp at thumbnail size on mobile.
- Make the project's purpose obvious in under one second.
- Include something visually distinct (the dashboard screenshot) so the preview doesn't blur into every other repo card in a feed.
