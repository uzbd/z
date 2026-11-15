/* Small helpers: zip writer (no dependency), word diff, find & replace, share-link packing. */

// ---------- ZIP (store method, UTF-8 names) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function makeZip(files: { name: string; text: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); // 1980-01-01
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    const local = new Uint8Array(30 + name.length + data.length);
    local.set(new Uint8Array(lh.buffer), 0); local.set(name, 30); local.set(data, 30 + name.length);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    const cen = new Uint8Array(46 + name.length);
    cen.set(new Uint8Array(ch.buffer), 0); cen.set(name, 46);
    parts.push(local); central.push(cen); offset += local.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cenSize + 22);
  let p = 0;
  for (const a of [...parts, ...central, new Uint8Array(end.buffer)]) { out.set(a, p); p += a.length; }
  return out;
}

// ---------- Word diff ----------
export type Seg = { t: string; k: "same" | "del" | "add" };
export function diffWords(a: string, b: string, cap = 2500): Seg[] | null {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const x = A.slice(s, ea), y = B.slice(s, eb);
  if (x.length > cap || y.length > cap) return null;
  const n = x.length, m = y.length, w = m + 1;
  const L = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i * w + j] = x[i] === y[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const raw: Seg[] = A.slice(0, s).map(t => ({ t, k: "same" as const }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { raw.push({ t: x[i], k: "same" }); i++; j++; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) raw.push({ t: x[i++], k: "del" });
    else raw.push({ t: y[j++], k: "add" });
  }
  while (i < n) raw.push({ t: x[i++], k: "del" });
  while (j < m) raw.push({ t: y[j++], k: "add" });
  for (const t of A.slice(ea)) raw.push({ t, k: "same" });
  const out: Seg[] = [];
  for (const g of raw) {
    const last = out[out.length - 1];
    if (last && last.k === g.k) last.t += " " + g.t; else out.push({ ...g });
  }
  return out;
}

// ---------- Find & replace ----------
export function findReplace(text: string, find: string, repl: string, o: { regex: boolean; caseSensitive: boolean }): { text: string; count: number; error: string } {
  if (!find) return { text, count: 0, error: "" };
  try {
    const re = new RegExp(o.regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), o.caseSensitive ? "gu" : "giu");
    let count = 0;
    const out = text.replace(re, (...a) => {
      count++;
      return o.regex ? repl.replace(/\$(\d|&)/g, (_, g: string) => (g === "&" ? a[0] : typeof a[+g] === "string" ? a[+g] : "")) : repl;
    });
    return { text: out, count, error: "" };
  } catch (e) {
    return { text, count: 0, error: "Invalid pattern" };
  }
}

// ---------- Share link ----------
const toB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const w = stream.writable.getWriter();
  w.write(bytes as unknown as BufferSource); w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
export async function pack(obj: unknown): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  try { return "z" + toB64(await pipe(raw, new CompressionStream("deflate-raw"))); } catch { return "b" + toB64(raw); }
}
export async function unpack(code: string): Promise<any> {
  const bytes = fromB64(code.slice(1));
  const raw = code[0] === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}
