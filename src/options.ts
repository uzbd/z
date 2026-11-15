/* Formatting options for the Clean tab. The UI is generated from GROUPS, so adding a field here adds it to the page. */
export type Opts = Record<string, string>;
export interface Field { key: string; label: string; type: "select" | "text" | "textarea"; choices?: [string, string][]; placeholder?: string }
export interface Group { title: string; open?: boolean; fields: Field[] }

const KR: [string, string][] = [["keep", "Keep"], ["remove", "Remove"]];
const KSR: [string, string][] = [["keep", "Keep"], ["space", "Replace with space"], ["remove", "Remove (join letters)"]];

export const GROUPS: Group[] = [
  {
    title: "Words & content", open: true,
    fields: [
      { key: "polite", label: "Impolite / explicit words", type: "select", choices: [["remove", "Remove"], ["mask", "Mask (*****)"], ["keep", "Keep"]] },
      { key: "customWords", label: "Always remove these words or phrases", type: "textarea", placeholder: "comma or new line separated" },
      { key: "keepWords", label: "Never remove these words (exceptions)", type: "textarea", placeholder: "comma or new line separated" },
      { key: "releaseTags", label: "Release tags (1080p, WEB-DL, x264, MP4, P2P…)", type: "select", choices: KR },
      { key: "links", label: "Links & email addresses", type: "select", choices: KR },
      { key: "dupWords", label: "Same word repeated in a row", type: "select", choices: [["keep", "Keep"], ["remove", "Remove repeats"]] }
    ]
  },
  {
    title: "Joiners to spaces (a-b-c, a.b.c, a_b_c)",
    fields: [
      { key: "sep", label: "Treat as word separators", type: "select", choices: [["all", "Hyphens, dots and underscores"], ["hyphen", "Hyphens only"], ["dot", "Dots only"], ["underscore", "Underscores only"], ["none", "Nothing"]] },
      { key: "extraSep", label: "Extra separator characters", type: "text", placeholder: "for example + ~ |" },
      { key: "noise", label: "Decorative runs (-----, _____, .....)", type: "select", choices: KR }
    ]
  },
  {
    title: "Numbers & dates",
    fields: [
      { key: "dates", label: "Dates (2023-10-28, 23.10.28)", type: "select", choices: KR },
      { key: "years", label: "Years (1999, 2024)", type: "select", choices: KR },
      { key: "numbers", label: "Other numbers", type: "select", choices: [["keep", "Keep"], ["standalone", "Remove separate numbers"], ["withDigits", "Remove every word containing a digit"]] }
    ]
  },
  {
    title: "Punctuation",
    fields: [
      { key: "period", label: "Periods and ellipsis ( . … )", type: "select", choices: KR },
      { key: "comma", label: "Commas ( , )", type: "select", choices: KR },
      { key: "colon", label: "Colons and semicolons ( : ; )", type: "select", choices: KR },
      { key: "question", label: "Question marks ( ? )", type: "select", choices: KR },
      { key: "excl", label: "Exclamation marks ( ! )", type: "select", choices: KR },
      { key: "quotes", label: "Quotation marks ( \" “ ” « » )", type: "select", choices: KR },
      { key: "apostrophes", label: "Apostrophes inside words (don't)", type: "select", choices: KR },
      { key: "brackets", label: "Brackets ( ) [ ] { } < >", type: "select", choices: [["keep", "Keep"], ["remove", "Remove brackets only"], ["content", "Remove brackets and what is inside"]] },
      { key: "dashes", label: "Hyphens and dashes ( - – — )", type: "select", choices: KSR },
      { key: "slashes", label: "Slashes ( / \\ )", type: "select", choices: KSR },
      { key: "symbols", label: "Symbols ( @ # $ % & * + = ~ | _ © ® ™ )", type: "select", choices: KR },
      { key: "emoji", label: "Emoji", type: "select", choices: KR }
    ]
  },
  {
    title: "Letters & case",
    fields: [
      { key: "casing", label: "Letter case", type: "select", choices: [["keep", "Keep"], ["lower", "lowercase"], ["upper", "UPPERCASE"], ["sentence", "Sentence case"], ["title", "Title Case"], ["first", "Capitalize first letter only"]] },
      { key: "accents", label: "Accents (é → e)", type: "select", choices: [["keep", "Keep"], ["remove", "Remove"]] },
      { key: "nonLatin", label: "Non-English characters", type: "select", choices: [["keep", "Keep"], ["remove", "Remove (English letters only)"]] }
    ]
  },
  {
    title: "Spacing, lines & output",
    fields: [
      { key: "spaces", label: "Extra spaces", type: "select", choices: [["collapse", "Collapse and trim"], ["keep", "Leave as is"]] },
      { key: "joiner", label: "Put between words", type: "select", choices: [["space", "Space"], ["hyphen", "Hyphen ( - )"], ["underscore", "Underscore ( _ )"], ["dot", "Dot ( . )"], ["comma", "Comma ( , )"], ["pipe", "Pipe ( | )"], ["plus", "Plus ( + )"], ["none", "Nothing (join)"], ["newline", "New line (one word per line)"]] },
      { key: "emptyLines", label: "Empty lines", type: "select", choices: KR },
      { key: "dedupeLines", label: "Duplicate lines", type: "select", choices: [["keep", "Keep"], ["remove", "Remove duplicates"]] },
      { key: "sortLines", label: "Sort lines", type: "select", choices: [["none", "No"], ["az", "A → Z"], ["za", "Z → A"]] },
      { key: "joinLines", label: "Line breaks", type: "select", choices: [["keep", "Keep"], ["space", "Join everything into one line"]] },
      { key: "prefix", label: "Add at the start of each line", type: "text", placeholder: "optional" },
      { key: "suffix", label: "Add at the end of each line", type: "text", placeholder: "optional" }
    ]
  }
];

export const DEFAULTS: Opts = {
  polite: "remove", customWords: "", keepWords: "", releaseTags: "keep", links: "keep", dupWords: "keep",
  sep: "all", extraSep: "", noise: "remove",
  dates: "keep", years: "keep", numbers: "keep",
  period: "keep", comma: "keep", colon: "keep", question: "keep", excl: "keep", quotes: "keep", apostrophes: "keep",
  brackets: "keep", dashes: "keep", slashes: "keep", symbols: "keep", emoji: "keep",
  casing: "keep", accents: "keep", nonLatin: "keep",
  spaces: "collapse", joiner: "space", emptyLines: "keep", dedupeLines: "keep", sortLines: "none", joinLines: "keep", prefix: "", suffix: ""
};

const NO_PUNCT: Opts = {
  period: "remove", comma: "remove", colon: "remove", question: "remove", excl: "remove", quotes: "remove", apostrophes: "remove",
  brackets: "remove", dashes: "space", slashes: "space", symbols: "remove", emoji: "remove"
};

export const BUILTIN_PRESETS: { name: string; opts: Partial<Opts> }[] = [
  { name: "Polite and clean (default)", opts: {} },
  { name: "No punctuation at all", opts: NO_PUNCT },
  { name: "Release name → readable title", opts: { releaseTags: "remove", dates: "remove", casing: "title", dupWords: "remove", brackets: "content" } },
  { name: "Plain sentence", opts: { casing: "sentence", quotes: "remove", brackets: "remove", symbols: "remove", emoji: "remove", dashes: "space", slashes: "space" } },
  { name: "One word per line", opts: { ...NO_PUNCT, joiner: "newline" } },
  { name: "Slug (a-b-c)", opts: { ...NO_PUNCT, casing: "lower", joiner: "hyphen", accents: "remove", nonLatin: "remove" } },
  { name: "Only fix separators (keep every word)", opts: { polite: "keep" } }
];
