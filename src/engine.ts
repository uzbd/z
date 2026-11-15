import { DEFAULTS, type Opts } from "./options";
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

/* ---------- Cleaner: separators -> spaces, unwanted words removed, every punctuation class optional ---------- */
export type CleanSep = "all" | "hyphen" | "dot" | "underscore";

const SEP_CHARS: Record<string, string> = {
  all: "\\-\u2010\u2011\u2013\u2014._",
  hyphen: "\\-\u2010\u2011\u2013\u2014",
  dot: ".",
  underscore: "_"
};

// Whole-word filter (so harmless words that merely contain a letter pattern are never touched).
const IMPOLITE =
  "fuck fucks fucking fucked fucker fuckers motherfucker shit shits shitty bullshit bitch bitches bastard " +
  "asshole assholes ass dick dicks cock cocks pussy pussies cunt cunts slut sluts whore whores hooker " +
  "tit tits titty titties tittied boob boobs nipple nipples nude nudes naked porn porno pornography pornographic " +
  "sex sexy sexual sexually anal oral blowjob handjob rimjob cum cums cumshot creampie creampied squirt " +
  "milf milfs xxx nsfw erotic erotica hardcore fetish bdsm orgy gangbang threesome horny lust lusty slutty " +
  "dildo vibrator masturbate masturbation penis vagina clit orgasm cumming jizz wank wanker twat prick " +
  "nigger nigga fag faggot retard rape rapist incest hentai playboy onlyfans stripper strip escort";
const LB = "(?<![\\p{L}\\p{N}])";
const RB = "(?![\\p{L}\\p{N}])";
const BAD_RE = new RegExp(`${LB}(?:${IMPOLITE.split(" ").join("|")})${RB}`, "giu");
const TAGS = new RegExp(
  `${LB}(?:\\d{3,4}[pi]|[248]k|uhd|fhd|hdr10?|mp4|mkv|avi|wmv|webm|web[\\s.\\-_]?dl|web[\\s.\\-_]?rip|blu[\\s.\\-_]?ray|[bh]drip|brrip|hdtv|dvdrip|dvdscr|hdcam|x26[45]|h[\\s.]?26[45]|hevc|xvid|divx|aac(?:[\\s.]?\\d(?:[\\s.]\\d)?)?|ac3|dts|flac|p2p|rarbg|yify|yts|ettv|eztv|repack|10bit|8bit)${RB}`,
  "giu"
);

const MASK = "\uE200"; // stands for "*" until the end, so later steps can't delete the mask
const PH_RE = /\uE000([\uE100-\uE109]+)\uE001/g; // placeholder for protected links / hashtags
const LINK = /:\/\/|^www\.|^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listCache = new Map<string, RegExp | null>();
function parseList(str: string): string[] { return (str || "").split(/[,;\n]+/).map(x => x.trim()).filter(Boolean); }
function listRe(str: string): RegExp | null {
  if (listCache.has(str)) return listCache.get(str)!;
  const items = parseList(str).sort((a, b) => b.length - a.length).map(w => esc(w).replace(/\s+/g, "\\s+"));
  const re = items.length ? new RegExp(`${LB}(?:${items.join("|")})${RB}`, "giu") : null;
  if (listCache.size > 50) listCache.clear();
  listCache.set(str, re);
  return re;
}

function sepToken(tok: string, re: RegExp): string {
  const ext = tok.match(EXT); // keep a real file extension, clean the rest
  const body = ext ? tok.slice(0, ext.index) : tok;
  const fixed = body.replace(re, (m, a: string, b: string) =>
    m.length === 1 && /\d/.test(a) && /\d/.test(b) ? m : " " // keep 3.14, 2023-10-28, 1_000
  );
  return fixed + (ext ? ext[0] : "");
}

function recase(s: string, c: string): string {
  if (c === "keep") return s;
  if (c === "upper") return s.toUpperCase();
  if (c === "first") return s.replace(/\p{L}/u, ch => ch.toUpperCase());
  const low = s.toLowerCase();
  if (c === "lower") return low;
  if (c === "title") return low.replace(/(?<![\p{L}\p{N}'’])\p{L}/gu, ch => ch.toUpperCase());
  return low.replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a: string, ch: string) => a + ch.toUpperCase());
}

const JOIN: Record<string, string> = { space: " ", hyphen: "-", underscore: "_", dot: ".", comma: ", ", none: "", newline: "\n", pipe: " | ", plus: "+" };

export function cleanLine(line: string, partial: Partial<Opts> = {}): string {
  const o = { ...DEFAULTS, ...partial } as Opts;
  let s = normalize(line);
  if (o.accents === "remove") s = s.normalize("NFD").replace(/(?<=\p{Script=Latin})\p{M}+/gu, "").normalize("NFC");

  // 1. protect (or drop) links, emails and hashtags
  const store: string[] = [];
  s = s.split(/(\s+)/).map((t, i) => {
    if (i % 2) return t;
    const [, pre, core, post] = t.match(/^([(\["'“‘{<]*)([\s\S]*?)([.,;:!?)\]"'”’}>]*)$/) ?? ["", "", t, ""];
    if (!core || !PROTECT.test(core)) return t;
    if (o.links === "remove" && LINK.test(core)) return pre + post;
    store.push(core);
    return pre + "\uE000" + [...String(store.length - 1)].map(d => String.fromCharCode(0xE100 + +d)).join("") + "\uE001" + post;
  }).join("");

  // 2. joiners -> spaces
  const cls = (o.sep === "none" ? "" : SEP_CHARS[o.sep] ?? SEP_CHARS.all) + (o.extraSep || "").replace(/\s/g, "").replace(/[\\\]\[^-]/g, "\\$&");
  if (cls) {
    const re = new RegExp(`(?<=([\\p{L}\\p{N}]))[${cls}]+(?=([\\p{L}\\p{N}]))`, "gu");
    s = s.split(/(\s+)/).map((p, i) => (i % 2 ? p : sepToken(p, re))).join("");
  }

  // 3. words, tags, dates, numbers
  const rep = (m: string) => MASK.repeat(m.length);
  if (o.polite !== "keep") {
    const keep = new Set(parseList(o.keepWords).map(x => x.toLowerCase()));
    s = s.replace(BAD_RE, m => (keep.has(m.toLowerCase()) ? m : o.polite === "mask" ? rep(m) : ""));
  }
  const custom = listRe(o.customWords);
  if (custom) s = s.replace(custom, m => (o.polite === "mask" ? rep(m) : ""));
  if (o.releaseTags === "remove") s = s.replace(TAGS, "");
  if (o.dates === "remove") s = s.replace(/(?<![\p{L}\p{N}])\d{1,4}([./-])\d{1,2}\1\d{1,4}(?![\p{L}\p{N}])/gu, "");
  if (o.years === "remove") s = s.replace(/(?<![\p{L}\p{N}])(?:19|20)\d{2}(?![\p{L}\p{N}])/gu, "");
  if (o.numbers === "standalone") s = s.replace(/(?<![\p{L}\p{N}])\d+(?:[.,:]\d+)*(?![\p{L}\p{N}])/gu, "");
  if (o.numbers === "withDigits") s = s.split(/(\s+)/).map((p, i) => (i % 2 || !/\p{N}/u.test(p) ? p : "")).join("");

  // 4. punctuation, class by class
  const strip = (re: RegExp, mode: string, digits = false, exact = false) => {
    if (mode === "keep") return;
    s = s.replace(re, (m: string, off: number, str: string) => {
      const a = str[off - 1] ?? "", b = str[off + m.length] ?? "";
      if (digits && /\d/.test(a) && /\d/.test(b)) return m; // 3.14  1,000  10:30
      if (mode === "space") return " ";
      if (exact) return "";
      return /[\p{L}\p{N}]/u.test(a) && /[\p{L}\p{N}]/u.test(b) ? " " : "";
    });
  };
  if (o.brackets === "content")
    for (let k = 0; k < 6; k++) {
      const t = s.replace(/\([^()]*\)|\[[^\[\]]*\]|\{[^{}]*\}|<[^<>]*>/g, " ");
      if (t === s) break;
      s = t;
    }
  if (o.brackets !== "keep") s = s.replace(/[()\[\]{}<>（）［］｛｝「」『』【】]/g, " ");
  strip(/[.…]+/g, o.period, true);
  strip(/[,،、，]+/g, o.comma, true);
  strip(/[:;：；]+/g, o.colon, true);
  strip(/[?¿？]+/g, o.question);
  strip(/[!¡！]+/g, o.excl);
  strip(/["“”„‟«»‹›`´]+|(?<![\p{L}\p{N}])['‘’‚‛]+|['‘’‚‛]+(?![\p{L}\p{N}])/gu, o.quotes);
  strip(/(?<=\p{L})['’‘](?=\p{L})/gu, o.apostrophes, false, true);
  strip(/[\-–—‒―‐‑]+/g, o.dashes, false, true);
  strip(/[\/\\]+/g, o.slashes, false, true);
  strip(/[@#$%^&*+=~|_€£¥₹°©®™•·§¶†‡]+/g, o.symbols);
  if (o.emoji === "remove") s = s.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "");
  if (o.nonLatin === "remove") s = s.replace(/[^\x00-\x7F\u00A0-\u024F\u2010-\u2015\u2018-\u201F\u2026\uE000-\uF8FF]+/gu, " ");
  if (o.noise === "remove") s = s.replace(/[._\-~|]{3,}/g, " ");

  // 5. tidy, repeats, case, joiner
  s = s.replace(/\s+([,.;:!?])/g, "$1");
  if (o.spaces === "collapse") s = s.replace(/[ \t\u00A0]{2,}/g, " ").trim();
  if (o.dupWords === "remove") {
    const w = s.split(/\s+/).filter(Boolean);
    s = w.filter((x, i) => i === 0 || x.toLowerCase() !== w[i - 1].toLowerCase()).join(" ");
  }
  s = recase(s, o.casing);
  if (o.joiner !== "space") s = s.split(/ +/).filter(Boolean).join(JOIN[o.joiner] ?? " ");

  // 6. put the mask and the protected links back
  s = s.replace(/\uE200/g, "*").replace(PH_RE, (_, d: string) => store[+[...d].map(c => c.charCodeAt(0) - 0xE100).join("")] ?? "");
  return s && (o.prefix || o.suffix) ? o.prefix + s + o.suffix : s;
}

// Line-level options (empty lines, duplicates, sorting, joining) run after every line is cleaned.
export function finishLines(lines: string[], partial: Partial<Opts> = {}): string {
  const o = { ...DEFAULTS, ...partial } as Opts;
  let r = lines;
  if (o.emptyLines === "remove" || o.joinLines === "space") r = r.filter(l => l.trim() !== "");
  if (o.dedupeLines === "remove") {
    const seen = new Set<string>();
    r = r.filter(l => { const k = l.trim().toLowerCase(); if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  if (o.sortLines !== "none") {
    r = [...r].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    if (o.sortLines === "za") r.reverse();
  }
  return o.joinLines === "space" ? r.join(" ").replace(/ {2,}/g, " ") : r.join("\n");
}
