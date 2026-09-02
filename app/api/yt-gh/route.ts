import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";

// Fallback para IP bloqueada (datacenter Vercel): lanza un workflow de GitHub
// Actions (yt-probe.yml) que resuelve el stream por WARP (IP no marcada) y
// devuelve la URL firmada de googlevideo parseada de los logs del job.
export const dynamic = "force-dynamic";

const OWNER = "3737631";
const REPO = "videos";
const WORKFLOW_PATH = ".github/workflows/yt-probe.yml";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ghHeaders = () => {
  const tok = process.env.GH_TOKEN || "";
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
};

async function ghGet(path: string) {
  const r = await fetch(`${API}${path}`, { headers: ghHeaders(), cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (r.status === 404) throw new Error("not found");
  const t = await r.text();
  if (!r.ok) throw new Error(`gh ${r.status}: ${t.slice(0, 160)}`);
  try { return JSON.parse(t); } catch { return t; }
}

async function workflowId(): Promise<number> {
  const j = await ghGet("/actions/workflows") as { workflows?: { id: number; path: string }[] };
  const w = (j.workflows || []).find((x) => x.path === WORKFLOW_PATH);
  if (!w) throw new Error("workflow not found");
  return w.id;
}

function pickUrlLine(logText: string): { url: string; client: string } | null {
  const m = /YT_RESULT url=(https:\/\/[^\s]+) client=(\S+)/.exec(logText);
  if (m) return { url: m[1], client: m[2] };
  return null;
}

// Los logs del run vienen en ZIP (por job/paso); jobs/{id}/logs trunca a ~26KB.
async function runLogText(runId: string): Promise<string> {
  const r = await fetch(`${API}/actions/runs/${runId}/logs`, {
    headers: { ...ghHeaders(), Accept: "application/vnd.github+json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`run logs ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const zip = new AdmZip(buf);
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && /\d+_.*\.txt$/.test(e.entryName))
    .map((e) => e.getData().toString("utf8"))
    .join("\n");
}

// start=1&id=<videoId>: despacha el workflow y devuelve {runId}
async function start(req: NextRequest, id: string) {
  const wf = await workflowId();
  const body = JSON.stringify({ ref: "main", inputs: { url: id } });
  const r = await fetch(`${API}/actions/workflows/${wf}/dispatches`, {
    method: "POST",
    headers: { ...ghHeaders(), "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`dispatch ${r.status}`);
  // Localizar el run recién creado (workflow_dispatch, status pendiente/activo)
  const t0 = Date.now();
  for (let i = 0; i < 12; i++) {
    await sleep(2000);
    const j = await ghGet(`/actions/workflows/${wf}/runs?event=workflow_dispatch&per_page=10`) as { workflow_runs?: { id: number; status: string; created_at: string }[] };
    const runs = (j.workflow_runs || []).filter((x) => x.status !== "completed");
    const fresh = runs[0];
    if (fresh && Date.now() - new Date(fresh.created_at).getTime() < 90000) {
      return NextResponse.json({ runId: fresh.id, started: true });
    }
    if (Date.now() - t0 > 45000) break;
  }
  // El run pudo completarse muy rápido: buscar por fecha reciente
  const j2 = await ghGet(`/actions/workflows/${wf}/runs?event=workflow_dispatch&per_page=5`) as { workflow_runs?: { id: number; created_at: string }[] };
  const latest = (j2.workflow_runs || [])[0];
  if (latest && Date.now() - new Date(latest.created_at).getTime() < 60000) {
    return NextResponse.json({ runId: latest.id, started: true });
  }
  throw new Error("no run found after dispatch");
}

// run=<runId>: estado del run; si terminó, parsea YT_RESULT de los logs del job.
// dl=1&run=...: proxifica los bytes del stream firmado (mismo origen → CORS OK).
async function status(req: NextRequest, runId: string) {
  const j = await ghGet(`/actions/runs/${runId}`) as { status: string; conclusion: string | null };
  const jj = await ghGet(`/actions/runs/${runId}/jobs`) as { jobs?: { id: number; name: string }[] };
  const job = (jj.jobs || [])[0];
  const done = j.status === "completed";

  if (req.nextUrl.searchParams.get("dl") === "1") {
    if (!done) return NextResponse.json({ status: "running" });
    if (j.conclusion !== "success" || !job) return NextResponse.json({ status: "failed", message: `run ${j.conclusion}` }, { status: 502 });
    const log = await runLogText(runId);
    const hit = pickUrlLine(typeof log === "string" ? log : JSON.stringify(log));
    if (!hit) return NextResponse.json({ status: "failed", message: "YT_RESULT no encontrado (estrategia WARP no obtuvo stream)" }, { status: 502 });
    const res = await fetch(hit.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.youtube.com/",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok || !res.body) return NextResponse.json({ error: "stream fetch failed " + res.status }, { status: 502 });
    const ct = res.headers.get("content-type") || "video/mp4";
    const id = req.nextUrl.searchParams.get("id") || "";
    return new NextResponse(res.body as ReadableStream, {
      headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes", "Content-Disposition": `inline; filename="yt-${id}.mp4"` },
    });
  }

  if (!done || !job) {
    return NextResponse.json({ runId: Number(runId), status: j.status, conclusion: j.conclusion ?? null });
  }
  if (j.conclusion !== "success") {
    return NextResponse.json({ runId: Number(runId), status: "completed", conclusion: j.conclusion });
  }
  // art=1: sirve el clip real descargado por el runner (artefacto ytclip) — evita el
  // 403 de googlevideo a IPs datacenter (Vercel no puede descargar, el navegador no puede por CORS).
  if (req.nextUrl.searchParams.get("art") === "1") {
    let a: { id: number; name: string } | undefined;
    for (let i = 0; i < 6; i++) {
      const arts = await ghGet(`/actions/runs/${runId}/artifacts`) as { artifacts?: { id: number; name: string }[] };
      a = (arts.artifacts || []).find((x) => x.name === "ytclip");
      if (a) break;
      await sleep(5000);
    }
    if (!a) return NextResponse.json({ error: "no artifact" }, { status: 502 });
    let r = await fetch(`${API}/actions/artifacts/${a.id}/zip`, { headers: ghHeaders(), cache: "no-store", signal: AbortSignal.timeout(60000) });
    for (let i = 1; !r.ok && i < 4; i++) { await sleep(3000); r = await fetch(`${API}/actions/artifacts/${a.id}/zip`, { headers: ghHeaders(), cache: "no-store", signal: AbortSignal.timeout(60000) }); }
    if (!r.ok) return NextResponse.json({ error: "artifact fetch " + r.status }, { status: 502 });
    const zip = new AdmZip(Buffer.from(await r.arrayBuffer()));
    const e = zip.getEntries().find((x) => !x.isDirectory && /\.(mp4|mkv|webm)$/.test(x.entryName));
    if (!e) return NextResponse.json({ error: "clip entry missing" }, { status: 502 });
    const id = req.nextUrl.searchParams.get("id") || "";
    const ct = e.entryName.endsWith(".webm") ? "video/webm" : e.entryName.endsWith(".mkv") ? "video/x-matroska" : "video/mp4";
    return new NextResponse(new Uint8Array(e.getData()), {
      headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*", "Content-Length": String(e.header.size), "Content-Disposition": `inline; filename="yt-${id}.mp4"` },
    });
  }
  const log = await runLogText(runId);
  const hit = pickUrlLine(typeof log === "string" ? log : JSON.stringify(log));
  if (!hit) return NextResponse.json({ runId: Number(runId), status: "completed", conclusion: "success", url: null, error: "no YT_RESULT" });
  return NextResponse.json({ runId: Number(runId), status: "completed", conclusion: "success", url: hit.url, client: hit.client });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  const run = req.nextUrl.searchParams.get("run") || "";
  try {
    if (run) return await status(req, run);
    if (req.nextUrl.searchParams.get("start") === "1") {
      if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
      return await start(req, id);
    }
    return NextResponse.json({ error: "usa ?start=1&id= o ?run=" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}