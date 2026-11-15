/* Smart Text Decoder engine (runs inside a Web Worker): decode scrambled text, encode normal text. */
const FALLBACK_WORDS: string[] = (
    "a i an and are as at be been but by can do for from had has have he her hers him his how " +
    "i if in into is it its just me my no not of on or our out she so than that the their them " +
    "there these they this to too up us was we were what when where which who will with would " +
    "you your hello world test text host website smart decoder decode readable sentence words " +
    "this is a good example welcome home please thank thanks have been are was were can could " +
    "make made get got go going see look use using want need about after again all also any " +
    "because before between both come day did different every first found give great here high " +
    "important know like little long many more most much new next now only other over people " +
    "right same say some such take tell then think through time two very well work year"
  ).split(/\s+/);

const TWO = new Set("am an as at be by do go he hi if in is it me my no of oh ok on or so to up us we".split(" "));
const FOREIGN = /[\p{N}\p{M}]|[^\x00-\x7F\P{L}]/u; // digits and non-English letters are never touched
const PROTECT = /:\/\/|^www\.|@|#/i;
const EXT = /\.(?:com|net|org|edu|gov|info|html?|css|js|json|txt|pdf|png|jpe?g|gif|py|md|zip|exe)$/i;
const ABBR = /^(?:e\.g|i\.e|u\.s|u\.s\.a|a\.m|p\.m|ph\.d|etc|vs|mr|mrs|ms|dr)$/i;
const CONTRACTION = /^[A-Za-z]+['’](?:t|s|d|ll|re|ve|m)$/i;
const COMPOUND = /^[A-Za-z]{3,}(?:-[A-Za-z]{3,})+$/;
const MAX_WORD = 24;

let dictionary = new Set<string>(FALLBACK_WORDS);
let rank = new Map<string, number>();
FALLBACK_WORDS.forEach((w, i) => { if (!rank.has(w)) rank.set(w, i + 1); });

export async function loadDictionary(wordsUrl: string, commonUrl: string): Promise<boolean> {
  const get = (u: string) => fetch(u).then(r => (r.ok ? r.text() : "")).catch(() => "");
  const [all, common] = await Promise.all([get(wordsUrl), get(commonUrl)]);
  if (all) for (const w of all.toLowerCase().split(/\s+/)) if (/^[a-z]+$/.test(w)) dictionary.add(w);
  if (common) {
    const ranked = new Map<string, number>();
    let r = 1;
    for (const w of common.toLowerCase().split(/\s+/)) if (/^[a-z]+$/.test(w) && !ranked.has(w)) ranked.set(w, r++);
    for (const w of FALLBACK_WORDS) if (!ranked.has(w)) ranked.set(w, 5000);
    rank = ranked;
  }
  return Boolean(all);
}

function isWord(w: string): boolean {
  const n = w.length;
  if (n === 1) return w === "a" || w === "i";
  if (n === 2) return TWO.has(w);
  return rank.has(w) || (n >= 4 && dictionary.has(w));
}

// Lower cost = more plausible: common words < rare dictionary words < unknown fragments.
function wordCost(w: string): number {
  const n = w.length;
  if (n === 1) return w === "a" || w === "i" ? 4 : 10;
  if (n === 2) return TWO.has(w) ? 6 : 14;
  const r = rank.get(w);
  if (r) return Math.log(r) + 2.3;
  if (n >= 4 && dictionary.has(w)) return 12.5 + Math.max(0, 6 - n) * 0.6;
  return 4 * n;
}

// b = cost of ending a word at this gap, s = cost of swallowing the gap inside a word.
function gapInfo(g: string) {
  if (!g) return { b: 7, s: 0, out: " " }; // letters touch: a boundary must be earned by the dictionary
  if (/^\s+$/.test(g)) return /\s{2,}|\t/.test(g) ? { b: -2, s: 10, out: " " } : { b: 0, s: 1.5, out: " " };
  const t = g.trim();
  if (/^[,;:!?.]+$/.test(t) && /^\S.*\s$/.test(g)) return { b: -1, s: 3, out: t + " " };
  if (/\s/.test(g)) return { b: 0.5, s: 2.2, out: " " };
  if (/^[._\-|\/\\·•]+$/.test(g)) return { b: -1, s: 0.8, out: " " };
  return { b: 0.5, s: 0.8, out: " " };
}

function fixCase(s: string): string {
  if (s.length < 2 || /^(?:[a-z]+|[A-Z]+|[A-Z][a-z]+)$/.test(s)) return s;
  const l = s.toLowerCase();
  return /[A-Z]/.test(s[0]) ? l[0].toUpperCase() + l.slice(1) : l;
}

function normalize(s: string): string {
  s = s.replace(/(?<=[A-Za-z])[\u0300-\u036F]+/g, "");
  s = s.replace(/[^\x00-\x7F]/gu, c => {
    const n = c.normalize("NFKC"); // full-width, circled, math-bold letters -> ASCII; other scripts stay as typed
    return /^[\x00-\x7F]+$/.test(n) ? n : c;
  });
  return s.replace(/[\u200B\u2060\uFEFF\u00AD]/g, "").replace(/(?<=[A-Za-z])[\u200C\u200D]+|[\u200C\u200D]+(?=[A-Za-z])/g, "");
}

type Kind = "inert" | "ok" | "bad";
function classify(tok: string): Kind {
  if (!/[A-Za-z]/.test(tok) || FOREIGN.test(tok) || PROTECT.test(tok)) return "inert";
  const core = tok.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  if (EXT.test(core) || ABBR.test(core) || CONTRACTION.test(core)) return "inert";
  const chunks = core.split(/[^A-Za-z]+/);
  if (chunks.length === 1) {
    if (isWord(core.toLowerCase())) return "ok";
    return core.length >= 5 ? "inert" : "bad"; // long unknown word: probably a name, leave it
  }
  if (COMPOUND.test(core) && chunks.every(c => isWord(c.toLowerCase()))) return "inert";
  return "bad";
}

function parse(seg: string) {
  const letters: string[] = [], gaps = [""];
  for (const ch of seg) {
    if (/[A-Za-z]/.test(ch)) { letters.push(ch); gaps.push(""); } else gaps[gaps.length - 1] += ch;
  }
  return { letters, gaps };
}

function joinLetters(letters: string[], gaps: string[], i: number, j: number): string {
  let w = letters[i];
  for (let k = i + 1; k < j; k++) w += (/^['’]$/.test(gaps[k]) ? gaps[k] : "") + letters[k];
  return w;
}

// Best-cost segmentation of the letters, where every gap is either swallowed or becomes a word boundary.
function decodeSeg(seg: string): string {
  const { letters, gaps } = parse(seg);
  const m = letters.length;
  if (m < 2) return seg;
  const info = gaps.map(gapInfo);
  const low = letters.join("").toLowerCase();
  const best = new Array<number>(m + 1).fill(Infinity);
  const prev = new Array<number>(m + 1).fill(-1);
  best[0] = 0;
  for (let i = 0; i < m; i++) {
    if (best[i] === Infinity) continue;
    let swallowed = 0;
    for (let j = i + 1; j <= Math.min(m, i + MAX_WORD); j++) {
      if (j - 1 > i) swallowed += info[j - 1].s;
      let cost = best[i] + wordCost(low.slice(i, j)) + swallowed;
      if (j < m) cost += info[j].b;
      if (cost < best[j]) { best[j] = cost; prev[j] = i; }
    }
  }
  if (best[m] === Infinity) return seg;
  const spans: [number, number][] = [];
  for (let j = m; j > 0; j = prev[j]) spans.unshift([prev[j], j]);
  let out = gaps[0];
  spans.forEach(([i, j], k) => {
    out += fixCase(joinLetters(letters, gaps, i, j));
    if (k < spans.length - 1) out += info[j].out;
  });
  return out + gaps[m];
}

// Encoder output separates words by 3+ spaces; each chunk between them is exactly one word.
function strictWord(c: string): string | null {
  const { letters, gaps } = parse(c);
  const m = letters.length;
  if (m < 2) return null;
  for (let k = 1; k < m; k++) if (!gaps[k] || /\s{2,}/.test(gaps[k])) return null;
  return gaps[0] + joinLetters(letters, gaps, 0, m) + gaps[m];
}

function decodeRun(seg: string): string {
  const chunks = seg.split(/\s{3,}/);
  if (chunks.length === 1) return decodeSeg(seg);
  return chunks.map(c => strictWord(c) ?? decodeSeg(c)).join(" ");
}

// Release-style names ("Some.Movie.Name.2023.1080p.WEB-DL"): dots only separate words, so turn them into spaces.
// Digits are kept, URLs/emails/file names with a known extension and version numbers like 1.2.3 are left alone.
function undot(tok: string): string {
  if (PROTECT.test(tok) || (tok.match(/\./g) ?? []).length < 2) return tok;
  const m = tok.match(/^(\W*?)([A-Za-z0-9][\s\S]*?[A-Za-z0-9])(\W*)$/);
  if (!m) return tok;
  const core = m[2];
  if (EXT.test(core) || !/^[A-Za-z0-9\-]+(?:\.+[A-Za-z0-9\-]+)+$/.test(core)) return tok;
  const chunks = core.split(/\.+/);
  const words = chunks.filter(c => /[A-Za-z]{2,}/.test(c));
  if (chunks.length < 3 || words.length < 2) return tok;
  return m[1] + chunks.join(" ") + m[3];
}

export function decodeLine(line: string): string {
  const raw = normalize(line).split(/(\s+)/); // even index = token, odd index = whitespace
  const parts = raw.map((p, i) => (i % 2 ? p : undot(p)));
  const kind = parts.map((p, i) => (i % 2 ? "sp" : p !== raw[i] ? "inert" : classify(p))); // already-split names are final
  const mark = new Array<boolean>(parts.length).fill(false);
  kind.forEach((k, i) => {
    if (k !== "bad") return;
    for (const d of [-2, 0, 2]) { // a suspicious token plus one real word on each side
      const n = i + d;
      if (n >= 0 && n < parts.length && (kind[n] === "bad" || kind[n] === "ok")) mark[n] = true;
    }
  });
  let out = "";
  for (let i = 0; i < parts.length;) {
    if (!mark[i]) { out += parts[i]; i++; continue; }
    let j = i, seg = parts[i];
    while (j + 2 < parts.length && mark[j + 2]) { seg += parts[j + 1] + parts[j + 2]; j += 2; }
    out += decodeRun(seg);
    i = j + 1;
  }
  return out;
}

/* ---------- Encoder ---------- */
export type Style = "dots" | "symbols" | "spaced" | "mixed";
const SYM = "$%*^~!?+=<>:;|&".split("");
const MIX = [".", ".", "_", "-", "*", "$", "~", "|", "·", ".."];

function rng(seed: string) { // same word -> same scramble, so live encoding never flickers
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function encodeWord(w: string, style: Style): string {
  const r = rng(w);
  const sep = () =>
    style === "dots" ? "." : style === "spaced" ? " " : style === "symbols" ? SYM[Math.floor(r() * SYM.length)] : MIX[Math.floor(r() * MIX.length)];
  return [...w].map((c, i) => (i ? sep() : "") + c).join("");
}

export function encodeLine(line: string, style: Style): string {
  return line
    .split(/(\s+)/)
    .map((p, i) => (i % 2 ? "   " : FOREIGN.test(p) || PROTECT.test(p) ? p : p.replace(/[A-Za-z]+/g, w => encodeWord(w, style))))
    .join("");
}

/* ---------- Cleaner: words joined by hyphens, dots or underscores -> plain spaced words ---------- */
export type CleanSep = "all" | "hyphen" | "dot" | "underscore";
const SEP_CHARS: Record<CleanSep, string> = {
  all: "\\-\u2010\u2011\u2013\u2014._",
  hyphen: "\\-\u2010\u2011\u2013\u2014",
  dot: ".",
  underscore: "_"
};

function cleanToken(tok: string, re: RegExp): string {
  if (PROTECT.test(tok)) return tok; // links, emails, hashtags stay untouched
  const ext = tok.match(EXT); // keep a real file extension, clean the rest
  const body = ext ? tok.slice(0, ext.index) : tok;
  const fixed = body.replace(re, (m, a: string, b: string) =>
    m.length === 1 && /\d/.test(a) && /\d/.test(b) ? m : " " // keep 3.14, 2023-10-28, 1_000
  );
  return fixed + (ext ? ext[0] : "");
}

export function cleanLine(line: string, sep: CleanSep = "all"): string {
  const cls = SEP_CHARS[sep] ?? SEP_CHARS.all;
  const re = new RegExp(`(?<=([\\p{L}\\p{N}]))[${cls}]+(?=([\\p{L}\\p{N}]))`, "gu");
  return normalize(line)
    .split(/(\s+)/)
    .map((p, i) => (i % 2 ? p : cleanToken(p, re)))
    .join("");
}
