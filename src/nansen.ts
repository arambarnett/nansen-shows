/**
 * Nansen client: Smart Money flows, labeled holders, top traders, wallet PnL, daily flow series.
 * Every call is logged to .cache/nansen-calls.jsonl (endpoint, credits, latency, request id) so usage is
 * provable, and results are cached in .cache/nansen-cache.json so a rerun never spends a credit twice.
 *
 * Docs: https://docs.nansen.ai — all endpoints are POST with an `apikey` header.
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";

const BASE = "https://api.nansen.ai/api/v1";
const KEY = () => process.env.NANSEN_API_KEY ?? "";
export type NansenChain = "robinhood" | "arc" | "ethereum" | "base" | "solana" | "bnb" | "arbitrum" | "monad" | "hyperevm";
const CHAINS: NansenChain[] = ["robinhood", "arc", "ethereum", "base", "solana", "bnb", "arbitrum", "monad", "hyperevm"];
export const asNansenChain = (s: unknown): NansenChain => (CHAINS.includes(s as NansenChain) ? (s as NansenChain) : ((process.env.NANSEN_CHAIN as NansenChain) || "robinhood"));
export const NANSEN_CHAIN = asNansenChain(process.env.NANSEN_CHAIN);

const CACHE_DIR = ".cache";
const CACHE_FILE = `${CACHE_DIR}/nansen-cache.json`;
const LEDGER_FILE = `${CACHE_DIR}/nansen-calls.jsonl`;
mkdirSync(CACHE_DIR, { recursive: true });
const cacheAll: Record<string, { at: number; data: unknown }> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};

export class NansenError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
/** Credits per call, from https://docs.nansen.ai/api/overview (ledger only; Nansen bills upstream). */
const CREDITS: Record<string, number> = {
  "tgm/flow-intelligence": 1, "tgm/flows": 1, "tgm/holders": 5, "tgm/pnl-leaderboard": 5, "tgm/token-information": 1,
  "smart-money/netflow": 5, "profiler/address/current-balance": 1, "profiler/address/pnl-summary": 1,
};

export async function nansenPost<T = any>(endpoint: string, body: Record<string, unknown>, meta?: { chain?: string; subject?: string }): Promise<T> {
  if (!KEY()) throw new NansenError(0, "NANSEN_API_KEY unset", "not_configured");
  const t0 = Date.now();
  let status = 0, reqId: string | null = null;
  try {
    const res = await fetch(`${BASE}/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY() }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
    status = res.status;
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch {}
    reqId = json?.request_id ?? res.headers.get("x-request-id");
    if (!res.ok) throw new NansenError(res.status, json?.message ?? json?.error ?? `Nansen ${res.status}`, json?.code);
    return json as T;
  } finally {
    appendFileSync(LEDGER_FILE, JSON.stringify({ ts: new Date(t0).toISOString(), endpoint, chain: meta?.chain ?? null, subject: meta?.subject ?? null, credits: CREDITS[endpoint] ?? 1, status, ms: Date.now() - t0, request_id: reqId }) + "\n");
  }
}

async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const hit = cacheAll[key];
  if (hit && Date.now() / 1000 - hit.at < ttlSec) return hit.data as T;
  const data = await fn();
  cacheAll[key] = { at: Math.floor(Date.now() / 1000), data };
  writeFileSync(CACHE_FILE, JSON.stringify(cacheAll));
  return data;
}

// ---- Token intelligence ------------------------------------------------------------------

export type FlowSegment = { netUsd: number | null; wallets: number | null };
export type TokenFlows = { timeframe: "1h" | "1d" | "7d"; smartTrader: FlowSegment; whale: FlowSegment; topPnl: FlowSegment; publicFigure: FlowSegment; exchange: FlowSegment; freshWallets: FlowSegment };
export type NansenHolder = { address: string; label: string | null; valueUsd: number | null; pct: number | null; change24h: number | null };
export type NansenTrader = { address: string; label: string | null; pnlUsd: number | null; roiPct: number | null; trades: number | null; holdingUsd: number | null };
export type TokenIntel = { chain: NansenChain; address: string; asOf: number; deep: boolean; flows: TokenFlows[]; smartMoneyHolders: NansenHolder[]; topTraders: NansenTrader[] };
export type TokenInfo = { name: string; symbol: string; logo: string | null; marketCapUsd: number | null; priceUsd: number | null };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const seg = (r: any, k: string): FlowSegment => ({ netUsd: num(r?.[`${k}_net_flow_usd`]), wallets: num(r?.[`${k}_wallet_count`]) });

export async function tokenFlows(chain: NansenChain, address: string, timeframe: "1h" | "1d" | "7d"): Promise<TokenFlows> {
  const r = await nansenPost("tgm/flow-intelligence", { chain, token_address: address, timeframe }, { chain, subject: address });
  const row = Array.isArray(r?.data) ? r.data[0] ?? {} : r?.data ?? {};
  return { timeframe, smartTrader: seg(row, "smart_trader"), whale: seg(row, "whale"), topPnl: seg(row, "top_pnl"), publicFigure: seg(row, "public_figure"), exchange: seg(row, "exchange"), freshWallets: seg(row, "fresh_wallets") };
}

/** Flow intelligence for 1d + 7d (2 credits). `deep` adds smart money holders + 30d PnL leaderboard (10 more). Cached 30 min. */
export async function tokenIntel(address: string, chain: NansenChain = NANSEN_CHAIN, deep = false): Promise<TokenIntel> {
  const a = address.toLowerCase();
  return cached(`tok:${chain}:${a}:${deep ? "deep" : "lite"}`, 1800, async () => {
    const [d1, d7] = await Promise.all([tokenFlows(chain, a, "1d"), tokenFlows(chain, a, "7d")]);
    let holders: NansenHolder[] = [], traders: NansenTrader[] = [];
    if (deep) {
      const to = new Date(); const from = new Date(to.getTime() - 30 * 86_400_000);
      const [h, p] = await Promise.all([
        nansenPost("tgm/holders", { chain, token_address: a, label_type: "smart_money", pagination: { page: 1, per_page: 5 } }, { chain, subject: a }).catch(() => null),
        nansenPost("tgm/pnl-leaderboard", { chain, token_address: a, date: { from: from.toISOString(), to: to.toISOString() }, pagination: { page: 1, per_page: 5 } }, { chain, subject: a }).catch(() => null),
      ]);
      holders = (h?.data ?? []).map((x: any) => ({ address: String(x.address ?? ""), label: x.address_label ?? null, valueUsd: num(x.value_usd), pct: num(x.ownership_percentage), change24h: num(x.balance_change_24h) }));
      traders = (p?.data ?? []).map((x: any) => ({ address: String(x.trader_address ?? ""), label: x.trader_address_label ?? null, pnlUsd: num(x.pnl_usd_total ?? x.pnl_usd_realised), roiPct: num(x.roi_percent_total), trades: num(x.nof_trades), holdingUsd: num(x.holding_usd) }));
    }
    return { chain, address: a, asOf: Math.floor(Date.now() / 1000), deep, flows: [d1, d7], smartMoneyHolders: holders, topTraders: traders };
  });
}

/** Name, symbol, logo and market cap (tgm/token-information, 1 credit). Cached 1 h. */
export async function tokenInfo(address: string, chain: NansenChain = NANSEN_CHAIN): Promise<TokenInfo> {
  const a = address.toLowerCase();
  return cached(`info:${chain}:${a}`, 3600, async () => {
    const r = await nansenPost("tgm/token-information", { chain, token_address: a, timeframe: "1d" }, { chain, subject: a });
    const d = r?.data ?? {};
    const sm = d.spot_metrics ?? {}; const td = d.token_details ?? {};
    return { name: String(d.name ?? ""), symbol: String(d.symbol ?? ""), logo: d.logo ?? null, marketCapUsd: num(sm.market_cap_usd ?? td.market_cap_usd ?? sm.marketcap_usd), priceUsd: num(sm.price_usd ?? td.price_usd) };
  });
}

/** One label's position in a token, day by day (tgm/flows, 1 credit): holdings and a derived daily net flow. Cached 1 h. */
export type FlowDay = { date: string; valueUsd: number | null; tokenAmount: number | null; priceUsd: number | null; netUsd: number | null; holders: number | null };
export async function tokenFlowSeries(address: string, label: "smart_money" | "whale" | "exchange" | "public_figure" | "top_100_holders" = "smart_money", days = 7, chain: NansenChain = NANSEN_CHAIN): Promise<FlowDay[]> {
  const a = address.toLowerCase();
  return cached(`flows:${chain}:${a}:${label}:${days}`, 3600, async () => {
    const to = new Date(); const from = new Date(to.getTime() - (days + 1) * 86_400_000);
    const r = await nansenPost("tgm/flows", { chain, token_address: a, label, date: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }, pagination: { page: 1, per_page: 60 }, order_by: [{ field: "date", direction: "ASC" }] }, { chain, subject: a });
    const rows = ((r?.data ?? []) as any[]).map((x) => ({ date: String(x.date ?? "").slice(0, 10), valueUsd: num(x.value_usd), tokenAmount: num(x.token_amount), priceUsd: num(x.price_usd), holders: num(x.holders_count) }));
    return rows.map((d, i) => { const prev = rows[i - 1]; const net = prev && d.tokenAmount != null && prev.tokenAmount != null && d.priceUsd != null ? (d.tokenAmount - prev.tokenAmount) * d.priceUsd : null; return { ...d, netUsd: net }; }).slice(-days);
  });
}

// ---- Wallet intelligence -----------------------------------------------------------------

export type WalletIntel = {
  chain: NansenChain | "all"; address: string; asOf: number;
  realizedPnlUsd: number | null; realizedPnlPct: number | null; winRate: number | null; tradedTokens: number | null; sells: number | null;
  topTrades: { symbol: string; chain: string; realizedPnlUsd: number | null; roiPct: number | null }[];
  balances: { symbol: string; chain: string; valueUsd: number | null; amount: number | null }[];
};
/** 90-day PnL summary + current balances (2 credits). Cached 30 min. */
export async function walletIntel(address: string, chain: NansenChain | "all" = NANSEN_CHAIN): Promise<WalletIntel> {
  const a = address.toLowerCase();
  return cached(`wal:${chain}:${a}`, 1800, async () => {
    const to = new Date(); const from = new Date(to.getTime() - 90 * 86_400_000);
    const [pnl, bal] = await Promise.all([
      nansenPost("profiler/address/pnl-summary", { address: a, chain, date: { from: from.toISOString(), to: to.toISOString() } }, { chain, subject: a }).catch(() => null),
      nansenPost("profiler/address/current-balance", { address: a, chain, hide_spam_token: true, pagination: { page: 1, per_page: 10 }, order_by: [{ field: "value_usd", direction: "DESC" }] }, { chain, subject: a }).catch(() => null),
    ]);
    return {
      chain, address: a, asOf: Math.floor(Date.now() / 1000),
      realizedPnlUsd: num(pnl?.realized_pnl_usd), realizedPnlPct: num(pnl?.realized_pnl_percent), winRate: num(pnl?.win_rate), tradedTokens: num(pnl?.traded_token_count), sells: num(pnl?.traded_times),
      topTrades: (pnl?.top5_tokens ?? []).map((t: any) => ({ symbol: String(t.token_symbol ?? ""), chain: String(t.chain ?? chain), realizedPnlUsd: num(t.realized_pnl), roiPct: num(t.realized_roi) })),
      balances: (bal?.data ?? []).slice(0, 8).map((b: any) => ({ symbol: String(b.token_symbol ?? ""), chain: String(b.chain ?? chain), valueUsd: num(b.value_usd), amount: num(b.token_amount) })),
    };
  });
}

// ---- Smart Money netflow board -----------------------------------------------------------

export type NetflowRow = { chain: string; address: string; symbol: string; name?: string; iconUrl?: string | null; net1hUsd: number | null; net24hUsd: number | null; net7dUsd: number | null; net30dUsd: number | null; traders: number | null; ageDays: number | null; marketCapUsd: number | null; sectors: string[] };
/** What Smart Money is buying and selling right now on the given chains (5 credits). Cached 15 min. */
export async function smartMoneyNetflow(chains: NansenChain[] = [NANSEN_CHAIN], limit = 25): Promise<NetflowRow[]> {
  return cached(`nf:${chains.join(",")}:${limit}`, 900, async () => {
    const r = await nansenPost("smart-money/netflow", { chains, pagination: { page: 1, per_page: limit }, order_by: [{ field: "net_flow_24h_usd", direction: "DESC" }], filters: { include_stablecoins: false, include_native_tokens: false } }, { chain: chains.join(",") });
    return (r?.data ?? []).map((x: any) => ({
      chain: String(x.chain ?? ""), address: String(x.token_address ?? "").toLowerCase(), symbol: String(x.token_symbol ?? ""),
      net1hUsd: num(x.net_flow_1h_usd), net24hUsd: num(x.net_flow_24h_usd), net7dUsd: num(x.net_flow_7d_usd), net30dUsd: num(x.net_flow_30d_usd),
      traders: num(x.trader_count), ageDays: num(x.token_age_days), marketCapUsd: num(x.market_cap_usd), sectors: Array.isArray(x.token_sectors) ? x.token_sectors.map(String) : [],
    }));
  });
}

// ---- Ledger -------------------------------------------------------------------------------

export function nansenStats() {
  const lines = existsSync(LEDGER_FILE) ? readFileSync(LEDGER_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const by: Record<string, { n: number; credits: number; ms: number }> = {};
  for (const l of lines) { const b = (by[l.endpoint] ??= { n: 0, credits: 0, ms: 0 }); b.n++; b.credits += l.credits; b.ms += l.ms; }
  return { calls: lines.length, ok: lines.filter((l) => l.status >= 200 && l.status < 300).length, credits: lines.reduce((a, l) => a + l.credits, 0), first: lines[0]?.ts ?? null, last: lines.at(-1)?.ts ?? null, byEndpoint: Object.entries(by).map(([endpoint, b]) => ({ endpoint, n: b.n, credits: b.credits, avgMs: Math.round(b.ms / b.n) })).sort((a, b) => b.n - a.n) };
}
