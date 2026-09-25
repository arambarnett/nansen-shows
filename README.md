# nansen-shows

Turn Nansen's on-chain intelligence into 30-second videos people actually watch.

Pick a token or a wallet. Nansen says what Smart Money, whales, exchanges and fresh wallets did with it.
This turns that into a story with a hook, a turn, receipts and a stinger, and renders it: the token's own
logo animated into the opening shot, a loop under the punchline, a chart drawn to the daily data, stat cards
that slam in, a narrator who reads numbers the way a person says them, a music bed, sound design, and a
Trade / Follow call to action.

Built for the [Nansen Meridian Buildathon](https://nansen.ai/campaigns/meridian-buildathon). It is the same
code that powers the **Smart Money** tab on [tokenslop.fun](https://tokenslop.fun/feed), a launchpad and video
feed on Robinhood Chain, where the episodes land with a Trade button. Data by [Nansen](https://nansen.ai).
Rendered by [Monkeygun](https://monkeygun.com) (HyperFrames engine).

**Watch:** [Dumb Money vs Smart Money on $AI](https://tokenslop.fun/v/vid-387) ·
[Smart Money Alert](https://tokenslop.fun/v/vid-376) · [Who Got Rich](https://tokenslop.fun/v/vid-378) ·
[the feed](https://tokenslop.fun/feed)

## The shows

| Show | Trigger, from Nansen | What you see | Ends on |
|---|---|---|---|
| **Smart Money Alert** | `smart-money/netflow`: the tokens the 5,000 most profitable wallets net bought today | The lead token's logo animated, the next two as stat cards over their logos, the 7-day bars, what they dumped | Trade them |
| **Dumb Money vs Smart Money** | `tgm/flow-intelligence` 1d + 7d, `tgm/flows` daily, `tgm/holders`, `tgm/pnl-leaderboard` | "Fresh wallets threw $29M at $AI this week. Smart traders? They pulled out $2.1M." Then the receipts, day by day, and the scoreboard | Trade it |
| **Who Got Rich** | `profiler/address/pnl-summary`, `profiler/address/current-balance`, plus the token it rode | One wallet's realized PnL, win rate, best trade, biggest bag | Follow the wallet |

Every number on screen is a Nansen figure. The script is written by code from the facts, not by a language
model, so nothing is invented and what is said always matches what is shown. The voiceover gets spoken forms
("a hundred and three thousand dollars", "A I") while the cards keep the exact figures.

## Run it (under 10 minutes)

You need two keys. A Nansen key is free at [app.nansen.ai/api](https://app.nansen.ai/api) (facts cost a few
credits). A Monkeygun key comes with a new account at [monkeygun.com](https://monkeygun.com); its free credits
cover about two episodes.

```bash
git clone https://github.com/arambarnett/nansen-shows && cd nansen-shows
npm install
cp .env.example .env        # paste NANSEN_API_KEY and MONKEYGUN_API_KEY

# just the Nansen facts, no video (~12 credits)
npx tsx src/cli.ts facts token 0x2e8c31162b855a2ffa90f6f8634643ad6f111e18

# the script it would make, no render
npx tsx src/cli.ts token 0x2e8c31162b855a2ffa90f6f8634643ad6f111e18 --dry

# render it (≈ $2.40 of Monkeygun credits: 60 script+voice+render, 100 for the 5 s logo clip, 40 music)
npx tsx src/cli.ts token 0x2e8c31162b855a2ffa90f6f8634643ad6f111e18

# the other two shows
npx tsx src/cli.ts report                                   # Smart Money Alert for today
npx tsx src/cli.ts wallet 0xb8f305f27ccc406373de0082cc06cb1d065504ea --token 0x2e8c31162b855a2ffa90f6f8634643ad6f111e18

# the call ledger (every Nansen call, endpoint, credits, latency, request id)
npx tsx src/cli.ts stats
```

A render prints progress and, when done, the watch link and the MP4 URL, and saves the script next to it in
`out/<videoId>.json`. Flags: `--chain arc|ethereum|base|solana|…` (default `robinhood`), `--no-clips` (skip
the logo clip, saves $1), `--no-music`, `--loops pexels` (stock b-roll instead of Giphy), `--pack
bold|cinematic|editorial|classic`, `--voice <ElevenLabs id>`.

## How it works

```
Nansen API ──▶ src/nansen.ts ──▶ facts (cached 30 min, every call logged)
                                    │
                                    ▼
                              src/shows.ts ──▶ authored script: scenes + exact VO
                                    │            hook (logo → clip) · turn (loop) · chart (7-day series)
                                    │            stat cards · quote · CTA, with sfx + transitions per beat
                                    ▼
                            src/monkeygun.ts ──▶ POST /v1/videos/from-data (async) ──▶ poll ──▶ MP4
```

- `src/nansen.ts`: the client. `tokenIntel` (flow intelligence by cohort, smart money holders, 30-day PnL
  leaderboard), `tokenFlowSeries` (one label's daily position → net flow per day), `walletIntel` (90-day PnL,
  balances), `smartMoneyNetflow` (the board), `tokenInfo` (name, symbol, logo). Cache in `.cache/`, ledger in
  `.cache/nansen-calls.jsonl`.
- `src/shows.ts`: the three script builders and the number-to-speech rules. Each show has its own style pack,
  voice, palette and music mood.
- `src/monkeygun.ts`: one call to render an authored script, plus Giphy and Pexels search for loops.
- `src/cli.ts`: glue.

## Cost per episode

| Piece | Credits |
|---|---|
| Script, 30 s voice, render | 60 |
| 5 s clip animated from the token logo (Kling) | 100 |
| Generated music bed | 40 |
| Nansen facts (token, deep, with 7-day series) | ≈ 13 |

About $2.40 per episode on Monkeygun; skip the clip and music and it is $0.60.

## Credits

Data by [Nansen](https://nansen.ai). Video rendering by [Monkeygun](https://monkeygun.com), HyperFrames render
engine. Loops from Giphy or Pexels. Built by [tokenslop](https://tokenslop.fun). MIT.
