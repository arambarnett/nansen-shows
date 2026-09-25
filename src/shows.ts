/**
 * Nansen shows: each show turns a Nansen fact pack into an authored Monkeygun script — exact on-screen
 * text, exact spoken lines, scene types, motion and durations — so what is said always matches what is
 * shown, numbers are read the way a person says them, and the director model is skipped (no timeouts,
 * no invented figures).
 *
 * Every episode follows one shape that stops a scroll: HOOK (a claim with a number, the token's own
 * character in motion) → TURN (the "wait, what", over a loop) → RECEIPTS (a real chart, then pills) →
 * STINGER (the take, then Trade / Follow). Each show has its own look (style pack), voice and music.
 *
 * Scene extras the API turns into media: `stillIndex` (a logo from the data payload; with `clipPrompt`
 * the clip model animates that logo), `gif` (a Giphy query, attached as a muted loop), `chart` (rendered
 * as a PNG by the web app and attached full-bleed).
 */
import type { NetflowRow, TokenIntel, WalletIntel, FlowDay } from "./nansen.js";

export type SceneType = "title" | "visual" | "chart" | "data" | "quote" | "cta";
export type Scene = {
  type: SceneType; text: string; duration: number;
  motion?: "kinetic" | "countup" | "slide" | "zoom" | "typewriter" | "still" | "slam";
  /** public image/mp4 fetched by Monkeygun at create time (asset.url) */
  asset?: { url: string; kind?: "image" | "video" };
  frame?: "card" | "phone" | "laptop";
  /** per-scene sound effect (Monkeygun scene.sfx): bundled name, or none */
  sfx?: "impact" | "whoosh" | "riser" | "tick" | "keys" | "none";
  /** how this scene hands off to the next (Monkeygun scene.transition) */
  transition?: "wipe" | "cut" | "dissolve";
  stats?: { value: string; label: string }[];
  /** index into the data payload's stills (0 = imageUrl, then array items with iconUrl in order) */
  stillIndex?: number;
  /** animate the still into a clip (image-to-video when the scene has a still) */
  clipPrompt?: string;
  /** loop query: Giphy first, Pexels fallback; attached as a muted loop under the text */
  gif?: string;
  /** a chart drawn to the data: native Monkeygun chart scene (SVG, draw-on). `sub` = caption under it. */
  chart?: { title: string; sub: string; vals: number[]; labels: string[] };
};
export type AuthoredScript = { title: string; vo: string; cta: string; music?: { mood: string; bpm: number }; scenes: Scene[] };
export type ShowKey = "smart_money_alert" | "dumb_vs_smart" | "who_got_rich" | "token_autopsy" | "wallet_watch";
export type ShowStyle = { pack: "classic" | "editorial" | "bold" | "cinematic"; voiceId: string; accent: string; ground: string; captionStyle: "karaoke" | "bar"; disclaimer: string; watermark: string };

/** Voices from Monkeygun's list_voices (ElevenLabs ids). One per show so the feed has range. */
export const SHOWS: Record<ShowKey, { name: string; style: ShowStyle; seconds: number; clipProvider: "kling" | "minimax" }> = {
  smart_money_alert: { name: "Smart Money Alert", seconds: 30, clipProvider: "kling", style: { pack: "bold", voiceId: "IKne3meq5aSn9XLyUdCD" /* Charlie: hyped */, accent: "#00e07f", ground: "#07110c", captionStyle: "karaoke", disclaimer: "Not financial advice. Data by Nansen at render time.", watermark: "tokenslop.fun" } },
  dumb_vs_smart:     { name: "Dumb Money vs Smart Money", seconds: 30, clipProvider: "kling", style: { pack: "cinematic", voiceId: "onwK4e9ZLuTAKqWW03F9" /* Daniel: deep */, accent: "#ffb020", ground: "#0a0a0b", captionStyle: "bar", disclaimer: "Not financial advice. Data by Nansen at render time.", watermark: "tokenslop.fun" } },
  who_got_rich:      { name: "Who Got Rich", seconds: 30, clipProvider: "kling", style: { pack: "bold", voiceId: "TX3LPaxmHKxFdv7VOQHJ" /* Liam: energetic creator */, accent: "#7dd3fc", ground: "#0b0f14", captionStyle: "karaoke", disclaimer: "Not financial advice. Data by Nansen at render time.", watermark: "tokenslop.fun" } },
  // earlier formats, kept callable (they now run the story scripts without a chart)
  token_autopsy:     { name: "Token Autopsy", seconds: 30, clipProvider: "kling", style: { pack: "cinematic", voiceId: "onwK4e9ZLuTAKqWW03F9", accent: "#ffb020", ground: "#0a0a0b", captionStyle: "bar", disclaimer: "Not financial advice. Data by Nansen at render time.", watermark: "tokenslop.fun" } },
  wallet_watch:      { name: "Wallet Watch", seconds: 30, clipProvider: "kling", style: { pack: "editorial", voiceId: "SAz9YHcvj6GT2YYXdXww", accent: "#7dd3fc", ground: "#101014", captionStyle: "bar", disclaimer: "Not financial advice. Data by Nansen at render time.", watermark: "tokenslop.fun" } },
};

// ---- number speech ---------------------------------------------------------------------------

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function words(n: number): string {
  n = Math.round(n);
  if (n < 20) return ONES[n] || "zero";
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + words(n % 100) : "");
  return String(n);
}
/** "$103,252" → "a hundred and three thousand dollars"; "$3,836,436" → "three point eight million dollars". */
export function spokenUsd(v: number | null | undefined): string {
  if (v == null) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(a / 1e9).toFixed(1).replace(/\.0$/, "")} billion dollars`;
  if (a >= 1e6) return `${(a / 1e6).toFixed(1).replace(/\.0$/, "")} million dollars`;
  if (a >= 1e3) { const k = Math.round(a / 1e3); return `${k === 100 ? "a hundred" : words(k)} thousand dollars`; }
  return `${words(a)} dollars`;
}
export const spokenCount = (n: number | null | undefined) => (n == null ? "" : n < 1000 ? words(n) : `${Math.round(n / 100) / 10} thousand`);
/** "$AI" is read "A I"; short tickers are spelled unless they read as a word. */
export const spokenTicker = (sym: string) => (/^[A-Z]{2,4}$/.test(sym) && !/[AEIOUY]/.test(sym.slice(1)) ? sym.split("").join(" ") : sym.length <= 3 ? sym.split("").join(" ") : sym);

/** Nansen labels worth saying out loud. Referral-code tags are noise; ENS names and behavior tags are good. */
export function niceLabel(label: string | null | undefined, address: string): { screen: string; spoken: string; named: boolean } {
  const l = (label ?? "").trim();
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (!l || /referral code|referrer|^uses /i.test(l)) return { screen: short, spoken: "an unlabeled wallet", named: false };
  if (/\.eth$/i.test(l)) return { screen: l, spoken: l.replace(/\.eth$/i, " dot eth"), named: true };
  return { screen: l, spoken: `a wallet Nansen tags as ${l}`, named: true };
}

const usd = (v: number | null | undefined) => (v == null ? "—" : `${v < 0 ? "−" : "+"}$${Math.round(Math.abs(v)).toLocaleString()}`);
const usdAbs = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(Math.abs(v)).toLocaleString()}`);
const compactAbs = (v: number | null | undefined) => (v == null ? "—" : `$${Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(1) + "M" : Math.abs(v) >= 1e3 ? Math.round(Math.abs(v) / 1e3) + "K" : Math.round(Math.abs(v))}`);
const compact = (v: number | null | undefined) => (v == null ? "—" : `${v < 0 ? "−" : "+"}${compactAbs(v)}`);
const chainName = (c: string) => (c === "robinhood" ? "Robinhood Chain" : c === "arc" ? "Arc" : c);
const cap = (v: number | null | undefined) => (v == null ? null : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v / 1e3)}K`);
/** Pills that slam in (tabular count-ups are stable since Monkeygun 9013633; slam pairs with the impact sfx). */
const dataScene = (title: string, stats: { value: string; label: string }[], duration: number, extra: Partial<Scene> = {}): Scene => ({ type: "data", text: title, duration, motion: "slam", sfx: "impact", stats: stats.filter((s) => s.value && s.value !== "—").slice(0, 4), ...extra });
const chartOf = (series: FlowDay[] | null | undefined, title: string, sub: string) => {
  const days = (series ?? []).filter((d) => d.netUsd != null);
  if (days.length < 3) return undefined;
  return { title, sub, vals: days.map((d) => Math.round(d.netUsd!)), labels: days.map((d) => new Date(d.date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })) };
};
const logoClip = (subject: string) => `The character from the logo image, ${subject}, neon rim light, dramatic slow push in, cinematic, no text, no letters`;

// ---- Smart Money Alert (daily, from the netflow board) -----------------------------------------

export function smartMoneyAlertScript(rows: NetflowRow[], chain: string, series?: FlowDay[] | null): AuthoredScript {
  const buys = rows.filter((r) => (r.net24hUsd ?? 0) > 0).slice(0, 3);
  const sell = [...rows].sort((a, b) => (a.net24hUsd ?? 0) - (b.net24hUsd ?? 0))[0];
  const lead = buys[0];
  const vo: string[] = []; const scenes: Scene[] = [];
  // HOOK: the lead token's logo animated
  scenes.push({ type: "visual", text: `Smart money just bought ${compactAbs(lead.net24hUsd)} of $${lead.symbol}`, duration: 5, motion: "kinetic", sfx: "riser", stillIndex: 0, clipPrompt: logoClip("sitting on a throne made of cash while dollar bills rain down") });
  vo.push(`Smart money just bought ${spokenUsd(lead.net24hUsd)} of ${spokenTicker(lead.symbol)}. In one day.`);
  // TURN
  scenes.push({ type: "visual", text: "Nansen tracks the sharpest wallets on chain. Here's their whole day.", duration: 4, motion: "kinetic", gif: "eyes watching money" });
  vo.push(`Nansen tracks the sharpest wallets on ${chainName(chain)}. Here's their whole day.`);
  // RECEIPTS: the other buys as pills over their logos, then the chart
  buys.slice(1).forEach((r, i) => {
    scenes.push(dataScene(`$${r.symbol}`, [{ value: usd(r.net24hUsd), label: "smart money 24h" }, { value: String(r.traders ?? ""), label: "smart traders in it" }, { value: cap(r.marketCapUsd) ?? "", label: "market cap" }], 4.5, { stillIndex: i + 1 }));
    vo.push(`${i === 0 ? "Then" : "And"} ${spokenTicker(r.symbol)}: ${spokenUsd(r.net24hUsd)} in.`);
  });
  const ch = chartOf(series, `$${lead.symbol}: smart money, day by day`, "net flow · last 7 days");
  if (ch) { scenes.push({ type: "chart", text: `$${lead.symbol}, day by day`, duration: 5, chart: ch }); vo.push(`And ${spokenTicker(lead.symbol)} day by day: ${words(ch.vals.filter((v) => v > 0).length)} green days out of ${words(ch.vals.length)}.`); }
  if (sell && (sell.net24hUsd ?? 0) < 0) { scenes.push(dataScene(`$${sell.symbol}: dumped`, [{ value: usd(sell.net24hUsd), label: "smart money 24h" }], 4)); vo.push(`What did they dump? ${spokenTicker(sell.symbol)}. ${spokenUsd(sell.net24hUsd)} out.`); }
  // STINGER
  scenes.push({ type: "cta", text: "Trade them on tokenslop.fun\nData by Nansen", duration: 4, motion: "kinetic", sfx: "whoosh" });
  vo.push("Trade them on tokenslop dot fun. Data by Nansen.");
  return { title: `Smart money just bought ${compactAbs(lead.net24hUsd)} of $${lead.symbol}`, vo: vo.join(" "), cta: "Trade them on tokenslop.fun", music: { mood: "driving electronic hype", bpm: 128 }, scenes };
}

// ---- Dumb Money vs Smart Money (one token, the week's story) -----------------------------------

export function dumbVsSmartScript(t: TokenIntel, name: string, symbol: string, chain: string, series?: FlowDay[] | null): AuthoredScript {
  const d7 = t.flows.find((f) => f.timeframe === "7d");
  const fw7 = d7?.freshWallets.netUsd ?? 0, sm7 = d7?.smartTrader.netUsd ?? 0, ex7 = d7?.exchange.netUsd ?? 0, wh7 = d7?.whale.netUsd ?? 0;
  const tr = [...t.topTraders].sort((a, b) => (b.pnlUsd ?? 0) - (a.pnlUsd ?? 0))[0];
  const vo: string[] = []; const scenes: Scene[] = [];
  const tick = spokenTicker(symbol);
  const split = fw7 > 0 && sm7 < 0; // retail in, pros out
  const stack = sm7 > 0;            // pros accumulating
  // HOOK + TURN
  if (split) {
    scenes.push({ type: "visual", text: `Fresh wallets threw ${compactAbs(fw7)} at $${symbol} this week`, duration: 5, motion: "kinetic", sfx: "riser", stillIndex: 0, clipPrompt: logoClip("being showered with cash by a cheering crowd, confetti everywhere") });
    vo.push(`Fresh wallets threw ${spokenUsd(fw7)} at ${tick} this week.`);
    scenes.push({ type: "visual", text: `Smart traders? They pulled out ${compactAbs(sm7)}.`, duration: 4.5, motion: "kinetic", gif: "sneaking away with bag of money" });
    vo.push(`The smartest wallets on chain? They quietly pulled out ${spokenUsd(sm7)}.`);
  } else if (stack) {
    scenes.push({ type: "visual", text: `Smart money stacked ${compactAbs(sm7)} of $${symbol} this week`, duration: 5, motion: "kinetic", sfx: "riser", stillIndex: 0, clipPrompt: logoClip("calmly stacking gold bars in a vault, green glow") });
    vo.push(`Smart money stacked ${spokenUsd(sm7)} of ${tick} this week.`);
    scenes.push({ type: "visual", text: fw7 < 0 ? `Retail? Selling ${compactAbs(fw7)}.` : "While nobody was watching.", duration: 4.5, motion: "kinetic", gif: "stacking gold bars" });
    vo.push(fw7 < 0 ? `Retail sold ${spokenUsd(fw7)} into it. The pros bought it.` : "While nobody was watching.");
  } else {
    scenes.push({ type: "visual", text: `Who moved $${symbol} this week?`, duration: 5, motion: "kinetic", sfx: "riser", stillIndex: 0, clipPrompt: logoClip("standing under a spotlight in an interrogation room") });
    vo.push(`Who moved ${tick} this week? Nansen labels every wallet.`);
    scenes.push({ type: "visual", text: `Smart traders ${compact(sm7)} · fresh wallets ${compact(fw7)}`, duration: 4.5, motion: "kinetic", gif: "tug of war" });
    vo.push(`Smart traders ${sm7 >= 0 ? "put in" : "pulled out"} ${spokenUsd(sm7)}; fresh wallets ${fw7 >= 0 ? "put in" : "pulled out"} ${spokenUsd(fw7)}.`);
  }
  // RECEIPTS: chart, then the scoreboard
  const ch = chartOf(series, "Smart money, day by day", `$${symbol} · net flow · last 7 days`);
  if (ch) {
    const worst = ch.vals.reduce((m, v, i) => (v < ch.vals[m] ? i : m), 0), best = ch.vals.reduce((m, v, i) => (v > ch.vals[m] ? i : m), 0);
    scenes.push({ type: "chart", text: "Nansen has the receipts", duration: 6, chart: ch });
    vo.push(split || sm7 < 0 ? `Nansen has the receipts. ${ch.labels[worst]} alone: ${spokenUsd(ch.vals[worst])} out.` : `Nansen has the receipts. ${ch.labels[best]} alone: ${spokenUsd(ch.vals[best])} in.`);
  }
  scenes.push(dataScene("The scoreboard, 7 days", [{ value: compact(fw7), label: "fresh wallets" }, { value: compact(sm7), label: "smart traders" }, { value: compact(ex7), label: "exchanges" }, { value: compact(wh7), label: "whales" }].filter((s) => !/^[+−]\$0$/.test(s.value)), 5.5));
  vo.push(split ? `Retail in. Pros out. Exchanges ${ex7 >= 0 ? "filling up" : "draining"}.` : `Exchanges ${ex7 >= 0 ? "filling up" : "draining"}, whales ${wh7 >= 0 ? "buying" : "selling"}.`);
  // STINGER
  if (tr && (tr.pnlUsd ?? 0) > 0) { scenes.push({ type: "quote", text: `One wallet made ${usdAbs(tr.pnlUsd)} on it this month.`, duration: 4, motion: "typewriter", sfx: "tick" }); vo.push(`One wallet made ${spokenUsd(tr.pnlUsd)} on it this month.`); }
  else { scenes.push({ type: "quote", text: split ? "Retail is buying. The pros are selling. Which one are you?" : "Follow the money, not the hype.", duration: 4, motion: "typewriter", sfx: "tick" }); vo.push(split ? "Retail is buying. The pros are selling. Which one are you?" : "Follow the money, not the hype."); }
  scenes.push({ type: "cta", text: `Trade $${symbol} on tokenslop.fun\nData by Nansen`, duration: 4, motion: "kinetic", sfx: "whoosh" });
  vo.push("Data by Nansen. Trade it on tokenslop dot fun.");
  const title = split ? `Retail threw ${compactAbs(fw7)} at $${symbol}. Smart money left.` : stack ? `Smart money is stacking $${symbol}: ${compactAbs(sm7)} this week` : `Who moved $${symbol} this week`;
  return { title, vo: vo.join(" "), cta: `Trade $${symbol} on tokenslop.fun`, music: { mood: "dark cinematic tension", bpm: 92 }, scenes };
}

// ---- Who Got Rich (one wallet's record, told as a story) ---------------------------------------

export function whoGotRichScript(w: WalletIntel, handle: string, chain: string, tokenSymbol?: string | null, series?: FlowDay[] | null): AuthoredScript {
  const wr = w.winRate == null ? null : Math.round(w.winRate * (w.winRate <= 1 ? 100 : 1));
  const best = w.topTrades[0], top = w.balances[0];
  const vo: string[] = []; const scenes: Scene[] = [];
  const sym = best?.symbol ?? tokenSymbol ?? top?.symbol ?? "";
  // HOOK
  scenes.push({ type: "visual", text: `One wallet made ${usdAbs(best?.realizedPnlUsd ?? w.realizedPnlUsd)} on $${sym}`, duration: 5, motion: "kinetic", sfx: "riser", stillIndex: 0, clipPrompt: logoClip("lounging on a mountain of gold coins, counting cash, smug grin") });
  vo.push(`One wallet made ${spokenUsd(best?.realizedPnlUsd ?? w.realizedPnlUsd)} on ${spokenTicker(sym)}.`);
  // TURN
  scenes.push({ type: "visual", text: wr != null ? `${wr}% win rate. ${w.tradedTokens ?? "?"} tokens. Not luck.` : "Not luck.", duration: 4, motion: "kinetic", gif: "counting money fast" });
  vo.push(wr != null ? `A ${words(wr)} percent win rate across ${spokenCount(w.tradedTokens)} tokens. That's not luck.` : "That's not luck.");
  // RECEIPTS
  scenes.push(dataScene(`@${handle}, 90 days`, [{ value: usd(w.realizedPnlUsd), label: "realized PnL" }, { value: wr != null ? `${wr}%` : "", label: "win rate" }, { value: w.tradedTokens != null ? String(w.tradedTokens) : "", label: "tokens traded" }, { value: w.sells != null ? String(w.sells) : "", label: "sells" }], 5.5));
  vo.push(`Ninety days: ${spokenUsd(w.realizedPnlUsd)} realized.`);
  const ch = chartOf(series, `$${sym}: smart money, day by day`, "net flow · last 7 days");
  if (ch) { scenes.push({ type: "chart", text: `The token it rode: $${sym}`, duration: 5, chart: ch }); vo.push(`The token it rode: ${spokenTicker(sym)}. Here's what smart money did with it this week.`); }
  // STINGER
  if (top) { scenes.push({ type: "quote", text: `Still holding ${usdAbs(top.valueUsd)} of $${top.symbol}.`, duration: 4, motion: "typewriter", sfx: "tick" }); vo.push(`And it's still holding ${spokenUsd(top.valueUsd)} of ${spokenTicker(top.symbol)}.`); }
  scenes.push({ type: "cta", text: `Follow @${handle} on tokenslop.fun\nData by Nansen`, duration: 4, motion: "kinetic", sfx: "whoosh" });
  vo.push("Follow the wallet on tokenslop dot fun. Data by Nansen.");
  return { title: `One wallet made ${usdAbs(best?.realizedPnlUsd ?? w.realizedPnlUsd)} on $${sym}`, vo: vo.join(" "), cta: `Follow @${handle} on tokenslop.fun`, music: { mood: "confident hip hop swagger", bpm: 96 }, scenes };
}

// ---- earlier formats (kept as aliases) ---------------------------------------------------------

export function tokenAutopsyScript(t: TokenIntel, name: string, symbol: string, chain: string): AuthoredScript {
  return dumbVsSmartScript(t, name, symbol, chain, null);
}
export function walletWatchScript(w: WalletIntel, handle: string, chain: string): AuthoredScript {
  return whoGotRichScript(w, handle, chain, null, null);
}

/** Hand-offs by beat: the hook dissolves into the turn, receipts cut hard, the take dissolves in, the close wipes. */
export function rhythm(s: AuthoredScript): AuthoredScript {
  const scenes = s.scenes.map((sc, i, all) => {
    if (sc.transition) return sc;
    const next = all[i + 1];
    if (!next) return sc;
    if (i === 0) return { ...sc, transition: "dissolve" as const };
    if (next.type === "chart" || next.type === "data") return { ...sc, transition: "cut" as const };
    if (next.type === "quote") return { ...sc, transition: "dissolve" as const };
    if (next.type === "cta") return { ...sc, transition: "wipe" as const };
    return sc;
  });
  return { ...s, scenes };
}

/** ElevenLabs lands near 2.6 words per second; scale scene durations so the voice fits, never past target + 3 s. */
export function fitDurations(s: AuthoredScript, targetSeconds: number): AuthoredScript {
  const wordsN = s.vo.split(/\s+/).filter(Boolean).length;
  const need = Math.min(targetSeconds + 3, Math.max(targetSeconds, Math.ceil(wordsN / 2.6) + 1));
  const have = s.scenes.reduce((a, sc) => a + sc.duration, 0);
  const k = need / have;
  return { ...s, scenes: s.scenes.map((sc) => ({ ...sc, duration: Math.round(sc.duration * k * 10) / 10 })) };
}
