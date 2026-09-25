/**
 * Monkeygun client (https://monkeygun.com/docs): one call renders an authored script into a 9:16 MP4 on the
 * HyperFrames engine — voice, music bed, stat cards, charts drawn to the data, a clip animated from the token's
 * logo, loops under text. We poll the job until the video is rendered and print the watch link.
 */
const BASE = process.env.MONKEYGUN_API_URL ?? "https://api.monkeygun.com";
const KEY = () => process.env.MONKEYGUN_API_KEY ?? "";

async function mg<T = any>(path: string, body?: unknown, method = body ? "POST" : "GET"): Promise<T> {
  if (!KEY()) throw new Error("MONKEYGUN_API_KEY unset");
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) throw new Error(`Monkeygun ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

export type Brand = { pack?: "classic" | "editorial" | "bold" | "cinematic"; accent?: string; ground?: string; ink?: string; watermark?: string; logo?: string | null; disclaimer?: string; captionStyle?: "karaoke" | "bar"; sfx?: boolean };
export type FromDataInput = {
  title: string; brief: string; cta?: string; format?: "9:16" | "16:9" | "1:1" | "4:5"; targetSeconds?: number;
  script: unknown; data?: Record<string, unknown>; imageUrl?: string;
  images?: "source" | "none" | "auto" | "generate"; clips?: { provider: "kling" | "minimax" | "seedance-lite" | "seedance-pro"; count: number; seconds: number };
  voiceId?: string; captions?: boolean; brand?: Brand; music?: { mood: string; bpm?: number; generate?: boolean; seconds?: number };
  public?: boolean; external_id?: string;
};
export type Job = { id: string; status: "creating" | "rendering" | "done" | "failed"; videoId?: string; videoStatus?: string; error?: string; result?: any; media?: { public: boolean; mediaKey: string; url: string; renderUrl: string | null; thumbnail: string; watchUrl: string } };

/** Create + render asynchronously: 202 { jobId }. */
export async function createFromData(input: FromDataInput): Promise<{ jobId: string }> {
  const r = await mg<any>("/v1/videos/from-data", { ...input, async: true, render: true });
  if (!r?.jobId) throw new Error(`from-data: no jobId (${JSON.stringify(r).slice(0, 200)})`);
  return { jobId: String(r.jobId) };
}
export const getJob = (jobId: string) => mg<Job>(`/v1/jobs/${jobId}`);
export const getVideo = (videoId: string) => mg<any>("/v1/tools/get_video", { videoId });
/** Credits a call would cost (free). */
export const quote = (body: Record<string, unknown>) => mg<{ credits: number; usd: string; breakdown: { type: string; count: number; credits: number; label: string }[] }>("/v1/tools/quote", body);

/** Giphy through Monkeygun (free): MP4 renditions we can place under a scene via asset.url. */
export async function searchGif(query: string, count = 8): Promise<{ id: string; title: string; mp4: string | null }[]> {
  const r = await mg<any>("/v1/tools/search_gif", { query, count });
  return ((r?.results ?? []) as any[]).map((g) => ({ id: String(g.id ?? ""), title: String(g.title ?? ""), mp4: g.url && /\.mp4($|\?)/.test(String(g.url)) ? String(g.url) : g.images?.original?.mp4 ?? null }));
}
/** Pexels stock video through Monkeygun (free, licensed for commercial use). */
export async function searchStock(query: string, orientation: "portrait" | "landscape" | "square" = "portrait", count = 8): Promise<{ id: string; url: string; duration: number | null; width: number | null; height: number | null }[]> {
  const r = await mg<any>("/v1/tools/search_stock", { query, kind: "video", orientation, count });
  return ((r?.results ?? []) as any[]).filter((x) => x?.url).map((x) => ({ id: String(x.id ?? ""), url: String(x.url), duration: x.duration != null ? Number(x.duration) : null, width: x.width != null ? Number(x.width) : null, height: x.height != null ? Number(x.height) : null }));
}

/** Poll until rendered (or failed). Creation ≈ 1–3 min (voice, music, clip), render ≈ 1–2 min. */
export async function waitRendered(jobId: string, onTick?: (j: Job) => void, timeoutMs = 20 * 60_000): Promise<Job> {
  const t0 = Date.now();
  for (;;) {
    const j = await getJob(jobId);
    onTick?.(j);
    if (j.status === "failed") throw new Error(`job failed: ${j.error ?? "unknown"}`);
    if (j.videoId && (j.videoStatus === "rendered" || j.videoStatus === "error")) return j;
    if (Date.now() - t0 > timeoutMs) throw new Error(`job ${jobId} still ${j.status}/${j.videoStatus ?? "-"} after ${Math.round(timeoutMs / 60000)} min`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
