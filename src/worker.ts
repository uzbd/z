import { cleanLine, decodeLine, encodeLine, loadDictionary, type CleanSep, type Style } from "./engine";

type Mode = "decode" | "encode" | "clean";
const latest: Record<Mode, number> = { decode: 0, encode: 0, clean: 0 };
const cache = new Map<string, string>();
const tick = () => new Promise<void>(r => setTimeout(r, 0));

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "init") {
    const full = await loadDictionary(m.words, m.common);
    cache.clear();
    self.postMessage({ type: "ready", full });
    return;
  }
  const mode: Mode = m.mode, style: string = m.style, id: number = m.id;
  latest[mode] = id; // newest input always wins; older jobs stop at their next yield
  const lines = (m.text as string).split(/\r\n|\r|\n/);
  const out = new Array<string>(lines.length);
  let t0 = performance.now();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const key = mode + style + "\0" + l;
    let v = l.length < 5000 ? cache.get(key) : undefined;
    if (v === undefined) {
      v = mode === "decode" ? decodeLine(l) : mode === "clean" ? cleanLine(l, style as CleanSep) : encodeLine(l, style as Style);
      if (l.length < 5000) {
        if (cache.size > 200000) cache.clear();
        cache.set(key, v);
      }
    }
    out[i] = v;
    if (performance.now() - t0 > 12) {
      await tick();
      if (latest[mode] !== id) return;
      t0 = performance.now();
    }
  }
  if (latest[mode] === id) self.postMessage({ type: "result", id, mode, text: out.join("\n") });
};
