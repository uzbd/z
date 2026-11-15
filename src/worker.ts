import { cleanLine, decodeLine, encodeLine, finishLines, loadDictionary, type Style } from "./engine";
import type { Opts } from "./options";

type Mode = "decode" | "encode" | "clean";
const latest: Record<Mode, number> = { decode: 0, encode: 0, clean: 0 };
const cache = new Map<string, string>();
let lastClean = "";
const tick = () => new Promise<void>(r => setTimeout(r, 0));

function parseOpts(s: string): Partial<Opts> {
  try { return JSON.parse(s) as Partial<Opts>; } catch { return {}; }
}
function convert(mode: Mode, style: string, l: string, o: Partial<Opts>): string {
  const key = mode + (mode === "encode" ? style : "") + "\0" + l;
  let v = l.length < 5000 ? cache.get(key) : undefined;
  if (v === undefined) {
    v = mode === "decode" ? decodeLine(l) : mode === "clean" ? cleanLine(l, o) : encodeLine(l, style as Style);
    if (l.length < 5000) {
      if (cache.size > 200000) cache.clear();
      cache.set(key, v);
    }
  }
  return v;
}
function prepare(mode: Mode, style: string) {
  if (mode === "clean" && style !== lastClean) { // cleaner results depend on every option
    for (const k of cache.keys()) if (k.startsWith("clean")) cache.delete(k);
    lastClean = style;
  }
  return mode === "clean" ? parseOpts(style) : {};
}
function finish(mode: Mode, out: string[], o: Partial<Opts>) {
  return mode === "clean" ? finishLines(out, o) : out.join("\n");
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "init") {
    const full = await loadDictionary(m.words, m.common);
    cache.clear();
    self.postMessage({ type: "ready", full });
    return;
  }
  if (m.type === "batch") { // several files at once: same mode and settings for each
    const mode: Mode = m.mode, style: string = m.style;
    const o = prepare(mode, style);
    const files = (m.files as { name: string; text: string }[]).map(f => ({
      name: f.name,
      text: finish(mode, f.text.split(/\r\n|\r|\n/).map(l => convert(mode, style, l, o)), o)
    }));
    self.postMessage({ type: "batchResult", id: m.id, files });
    return;
  }
  const mode: Mode = m.mode, style: string = m.style, id: number = m.id;
  latest[mode] = id; // newest input always wins; older jobs stop at their next yield
  const o = prepare(mode, style);
  const lines = (m.text as string).split(/\r\n|\r|\n/);
  const out = new Array<string>(lines.length);
  let t0 = performance.now();
  for (let i = 0; i < lines.length; i++) {
    out[i] = convert(mode, style, lines[i], o);
    if (performance.now() - t0 > 12) {
      await tick();
      if (latest[mode] !== id) return;
      t0 = performance.now();
    }
  }
  if (latest[mode] === id) self.postMessage({ type: "result", id, mode, text: finish(mode, out, o) });
};
