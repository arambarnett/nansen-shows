#!/usr/bin/env tsx
/**
 * nansen-shows — turn Nansen intelligence into a short video.
 *
 *   npx tsx src/cli.ts report                       # Smart Money Alert: what the best wallets bought today
 *   npx tsx src/cli.ts token 0x…                    # Dumb Money vs Smart Money: the week's story of one token
 *   npx tsx src/cli.ts wallet 0x… [--token 0x…]      # Who Got Rich: one wallet's 90-day record
 *   npx tsx src/cli.ts facts token 0x…               # just the Nansen facts (no render, ~2–12 credits)
 *   npx tsx src/cli.ts stats                         # the call ledger
 *
 * Flags: --chain robinhood|arc|ethereum|base|solana|bnb|arbitrum|monad|hyperevm  --dry (print the script, no render)
 *        --no-clips  --no-music  --loops giphy|pexels  --pack bold|cinematic|editorial|classic  --voice <elevenlabs id>
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { asNansenChain, tokenIntel, tokenInfo, tokenFlowSeries, walletIntel, smartMoneyNetflow, nansenStats, NansenError, type NansenChain } from "./nansen.js";
import { SHOWS, smartMoneyAlertScript, dumbVsSmartScript, whoGotRichScript, fitDurations, rhythm, type ShowKey, type AuthoredScript } from "./shows.js";
import { createFromData, waitRendered, searchGif, searchStock, quote } from "./monkeygun.js";

// .env without a dependency
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split("\n")) { const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(`--${name}`);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["dry", "no-clips", "no-music"].includes(args[i - 1].slice(2))));
const cmd = positional[0];
const isAddr = (s?: string) => !!s && /^0x[a-fA-F0-9]{40}$/.test(s);
const chain: NansenChain = asNansenChain(flag("chain"));
const handle = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function die(msg: string): never { console.error(`\n✗ ${msg}\n`); process.exit(1); }
const fmtUsd = (v: number | null | undefined) => (v == null ? "—" : `${v < 0 ? "−" : "+"}$${Math.round(Math.abs(v)).toLocaleString()}`);

async function build(show: ShowKey, subject: { token?: string; wallet?: string }): Promise<{ script: AuthoredScript; imageUrl?: string; logos: { symbol: string; iconUrl: string }[]; brief: string; tokenSymbol?: string }> {
  const withChart = true;
  if (show === "smart_money_alert") {
    const rows = (await smartMoneyNetflow([chain], 25)).filter((r) => r.net24hUsd != null);
    const buys = rows.filter((r) => (r.net24hUsd ?? 0) > 0);
    if (buys.length < 2) die(`Not enough Smart Money buying on ${chain} today (${buys.length} tokens with positive 24h net flow).`);
    const infos = await Promise.all(buys.slice(0, 3).map((r) => tokenInfo(r.address, chain).catch(() => null)));
    buys.slice(0, 3).forEach((r, i) => { r.name = infos[i]?.name ?? r.symbol; r.iconUrl = infos[i]?.logo ?? null; });
    const lead = buys[0];
    const series = withChart ? await tokenFlowSeries(lead.address, "smart_money", 7, chain).catch(() => null) : null;
    const script = smartMoneyAlertScript(rows, chain, series);
    return { script, imageUrl: lead.iconUrl ?? undefined, logos: buys.slice(1, 3).filter((r) => r.iconUrl).map((r) => ({ symbol: r.symbol, iconUrl: r.iconUrl! })), brief: "What the smartest wallets bought and dumped in the last 24 hours. Data by Nansen." };
  }
  if (show === "dumb_vs_smart") {
    const a = subject.token!;
    const [intel, info, series] = await Promise.all([tokenIntel(a, chain, true), tokenInfo(a, chain).catch(() => null), withChart ? tokenFlowSeries(a, "smart_money", 7, chain).catch(() => null) : Promise.resolve(null)]);
    const d7 = intel.flows.find((f) => f.timeframe === "7d");
    if (!d7 || (d7.smartTrader.netUsd == null && d7.freshWallets.netUsd == null && d7.exchange.netUsd == null)) die("Nansen has no cohort flow on this token yet.");
    const sym = info?.symbol || a.slice(2, 6).toUpperCase();
    return { script: dumbVsSmartScript(intel, info?.name || sym, sym, chain, series), imageUrl: info?.logo ?? undefined, logos: [], brief: `Retail vs the pros on $${sym} this week. Data by Nansen.`, tokenSymbol: sym };
  }
  const w = subject.wallet!;
  const intel = await walletIntel(w, chain);
  if (intel.realizedPnlUsd == null && !intel.balances.length) die("Nansen has no trade history for this wallet on this chain.");
  const tok = subject.token; let sym = intel.topTrades[0]?.symbol, imageUrl: string | undefined, series = null as any;
  if (tok) { const info = await tokenInfo(tok, chain).catch(() => null); sym = info?.symbol || sym; imageUrl = info?.logo ?? undefined; series = withChart ? await tokenFlowSeries(tok, "smart_money", 7, chain).catch(() => null) : null; }
  return { script: whoGotRichScript(intel, handle(w), chain, sym, series), imageUrl, logos: [], brief: "One wallet's 90-day record. Data by Nansen." };
}

async function render(show: ShowKey, subject: { token?: string; wallet?: string }) {
  const cfg = SHOWS[show];
  const built = await build(show, subject);
  let script = rhythm(fitDurations(built.script, cfg.seconds));
  const seconds = Math.round(script.scenes.reduce((a, sc) => a + sc.duration, 0));
  console.log(`\n${cfg.name} · ${seconds}s\n${"─".repeat(60)}\nTITLE  ${script.title}\nVO     ${script.vo}\n`);
  script.scenes.forEach((sc, i) => console.log(`  ${i + 1}. [${sc.type}${sc.motion ? "/" + sc.motion : ""}] ${sc.text.replace(/\n/g, " / ")}${sc.stats?.length ? "  {" + sc.stats.map((s) => `${s.value} ${s.label}`).join(" · ") + "}" : ""}${sc.chart ? "  chart:" + sc.chart.vals.length + "d" : ""}${sc.clipPrompt ? "  clip" : ""}${sc.gif ? "  loop:" + sc.gif : ""}`));
  if (has("dry")) { console.log("\n(dry run: nothing rendered)"); return; }
  // dress: loops (Giphy first, Pexels fallback), charts as native chart scenes, the hook clip seeded from the logo
  const loops = flag("loops") ?? "giphy";
  const mgScenes: any[] = [];
  for (const sc of script.scenes) {
    const { gif, chart, ...rest } = sc; const out: any = { ...rest };
    if (gif) {
      let url: string | null = null;
      if (loops !== "pexels") url = (await searchGif(gif, 8).catch(() => []) as any[]).find((h) => h.mp4)?.mp4 ?? null;
      if (!url) url = (await searchStock(gif).catch(() => []) as any[]).find((h) => (h.duration ?? 0) >= 4)?.url ?? null;
      if (url) out.asset = { url, kind: "video" };
    }
    if (chart) { out.type = "chart"; out.sfx = out.sfx ?? "keys"; out.chart = { kind: "bars", series: chart.vals, labels: chart.labels, color: cfg.style.accent, negativeColor: "#ff4d6d", baseline: 0, valueFormat: "usd", title: chart.sub }; }
    if (rest.clipPrompt && built.imageUrl) { out.asset = { url: built.imageUrl, kind: "image" }; delete out.stillIndex; }
    if (!built.imageUrl) delete out.stillIndex;
    mgScenes.push(out);
  }
  const clips = !has("no-clips") && script.scenes.some((s) => s.clipPrompt);
  const input = {
    title: script.title, brief: built.brief, cta: script.cta, format: "9:16" as const, targetSeconds: seconds,
    script: { title: script.title, vo: script.vo, cta: script.cta, music: script.music, scenes: mgScenes },
    data: { source: "Nansen", show: cfg.name, ...(built.imageUrl ? { imageUrl: built.imageUrl } : {}), logos: built.logos },
    imageUrl: built.imageUrl, images: (built.imageUrl ? "source" : "none") as "source" | "none",
    clips: clips ? { provider: cfg.clipProvider, count: 1, seconds: 5 } : undefined,
    voiceId: flag("voice") ?? cfg.style.voiceId, captions: true,
    brand: { pack: (flag("pack") as any) ?? cfg.style.pack, accent: cfg.style.accent, ground: cfg.style.ground, watermark: cfg.style.watermark, logo: null, disclaimer: cfg.style.disclaimer, captionStyle: cfg.style.captionStyle },
    music: has("no-music") ? undefined : { mood: script.music?.mood ?? "modern electronic", bpm: script.music?.bpm, generate: true, seconds },
    public: true, external_id: `nansen-shows-${show}-${Date.now()}`,
  };
  const q = await quote({ targetSeconds: seconds, format: "9:16", voiceover: true, images: input.images, ...(clips ? { clips: input.clips } : {}) }).catch(() => null);
  console.log(`\nRendering on Monkeygun${q ? ` (≈${q.credits}${input.music ? "+40 music" : ""} credits ≈ $${((q.credits + (input.music ? 40 : 0)) / 100).toFixed(2)})` : ""}…`);
  const { jobId } = await createFromData(input);
  let last = "";
  const job = await waitRendered(jobId, (j) => { const s = `${j.status}${j.videoId ? " " + j.videoId : ""}${j.videoStatus ? " " + j.videoStatus : ""}`; if (s !== last) { console.log(`  ${new Date().toLocaleTimeString()}  ${s}`); last = s; } });
  const media = job.media ?? {} as any;
  mkdirSync("out", { recursive: true });
  const rec = { show, subject, videoId: job.videoId, title: script.title, watchUrl: media.watchUrl ?? null, mp4: media.renderUrl ?? media.url ?? null, thumbnail: media.thumbnail ?? null, at: new Date().toISOString() };
  writeFileSync(`out/${job.videoId}.json`, JSON.stringify({ ...rec, script }, null, 2));
  console.log(`\n✓ ${job.videoId}\n  watch  ${rec.watchUrl ?? "(private)"}\n  mp4    ${rec.mp4 ?? "(private)"}\n  saved  out/${job.videoId}.json\n`);
}

async function facts(kind: string, addr: string) {
  if (kind === "token") {
    const [intel, info] = await Promise.all([tokenIntel(addr, chain, true), tokenInfo(addr, chain).catch(() => null)]);
    console.log(`\n${info?.name ?? addr} ($${info?.symbol ?? "?"}) on ${chain}${info?.marketCapUsd ? ` · mcap $${Math.round(info.marketCapUsd).toLocaleString()}` : ""}`);
    for (const f of intel.flows) console.log(`  ${f.timeframe}: smart traders ${fmtUsd(f.smartTrader.netUsd)} (${f.smartTrader.wallets ?? "?"}w) · whales ${fmtUsd(f.whale.netUsd)} · exchanges ${fmtUsd(f.exchange.netUsd)} · fresh wallets ${fmtUsd(f.freshWallets.netUsd)} · public figures ${fmtUsd(f.publicFigure.netUsd)} · top PnL ${fmtUsd(f.topPnl.netUsd)}`);
    if (intel.smartMoneyHolders.length) console.log("  smart money holders: " + intel.smartMoneyHolders.map((h) => `${h.label || handle(h.address)} $${Math.round(h.valueUsd ?? 0).toLocaleString()}`).join(" · "));
    if (intel.topTraders.length) console.log("  top traders 30d: " + intel.topTraders.map((t) => `${t.label || handle(t.address)} ${fmtUsd(t.pnlUsd)}`).join(" · "));
  } else {
    const w = await walletIntel(addr, chain);
    console.log(`\n${handle(addr)} on ${chain}: realized ${fmtUsd(w.realizedPnlUsd)} (90d) · win rate ${w.winRate == null ? "—" : Math.round(w.winRate * (w.winRate <= 1 ? 100 : 1)) + "%"} · ${w.tradedTokens ?? "?"} tokens`);
    if (w.topTrades.length) console.log("  best trades: " + w.topTrades.map((t) => `${t.symbol} ${fmtUsd(t.realizedPnlUsd)}`).join(" · "));
    if (w.balances.length) console.log("  holdings: " + w.balances.map((b) => `${b.symbol} $${Math.round(b.valueUsd ?? 0).toLocaleString()}`).join(" · "));
  }
  console.log();
}

(async () => {
  try {
    if (cmd === "stats") { console.log(JSON.stringify(nansenStats(), null, 2)); return; }
    if (cmd === "facts") { const kind = positional[1], addr = positional[2]; if (!["token", "wallet"].includes(kind) || !isAddr(addr)) die("usage: facts token|wallet 0x…"); await facts(kind, addr!.toLowerCase()); return; }
    if (cmd === "report") { await render("smart_money_alert", {}); return; }
    if (cmd === "token") { const a = positional[1]; if (!isAddr(a)) die("usage: token 0x…"); await render("dumb_vs_smart", { token: a!.toLowerCase() }); return; }
    if (cmd === "wallet") { const w = positional[1]; if (!isAddr(w)) die("usage: wallet 0x… [--token 0x…]"); const t = flag("token"); await render("who_got_rich", { wallet: w!.toLowerCase(), token: isAddr(t) ? t!.toLowerCase() : undefined }); return; }
    console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 13).join("\n").replace(/^ \* ?/gm, ""));
  } catch (e: any) {
    if (e instanceof NansenError) die(e.code === "not_configured" ? "Set NANSEN_API_KEY in .env (see .env.example)." : e.code === "insufficient_credits" ? "Nansen credits ran out." : `Nansen ${e.status}: ${e.message}`);
    die(e?.message ?? String(e));
  }
})();
