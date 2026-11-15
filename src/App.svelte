<script lang="ts">
  import { BUILTIN_PRESETS, DEFAULTS, GROUPS, type Opts } from "./options";
  import { diffWords, findReplace, makeZip, pack, unpack } from "./util";

  type Mode = "decode" | "encode" | "clean";
  const MODES: Mode[] = ["decode", "clean", "encode"];
  const LABEL: Record<Mode, string> = { decode: "Decode", clean: "Clean", encode: "Encode" };
  const DONE: Record<Mode, string> = { decode: "decoded", clean: "cleaned", encode: "encoded" };
  const KEY = "smart-text-decoder:v2";

  function readSaved(): any { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
  const saved = readSaved();

  /* ---------- state ---------- */
  let mode = $state<Mode>(saved?.mode ?? "clean");
  let style = $state<string>(saved?.style ?? "mixed");
  let opts = $state<Opts>({ ...DEFAULTS, ...(saved?.opts ?? {}) });
  let inputs = $state({ decode: "", encode: "", clean: "", ...(saved?.remember === false ? {} : saved?.inputs ?? {}) });
  let original = $state<string>(saved?.remember === false ? "" : saved?.original ?? "");
  let outputs = $state({ decode: "", encode: "", clean: "" });
  let busy = $state({ decode: false, encode: false, clean: false });
  let dict = $state("Loading dictionary…");
  let note = $state("");
  let remember = $state<boolean>(saved?.remember ?? true);
  let autoCopy = $state<boolean>(saved?.autoCopy ?? false);
  let theme = $state<string>(saved?.theme ?? "auto");
  let presets = $state<{ name: string; opts: Opts }[]>(saved?.presets ?? []);
  let presetSel = $state("");
  let find = $state(""), repl = $state(""), frRegex = $state(false), frCase = $state(false);
  let showDiff = $state(false);
  const ids = { decode: 0, encode: 0, clean: 0 };
  let seq = 0;

  const hist = $state<Record<Mode, { s: string[]; i: number; t: number }>>({
    decode: { s: [inputs.decode], i: 0, t: 0 }, clean: { s: [inputs.clean], i: 0, t: 0 }, encode: { s: [inputs.encode], i: 0, t: 0 }
  });

  /* ---------- worker ---------- */
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const waiting = new Map<number, (f: { name: string; text: string }[]) => void>();
  let autoTimer: ReturnType<typeof setTimeout>;
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === "ready") {
      dict = m.full ? "Full English dictionary loaded" : "Built-in dictionary only (full list unavailable)";
      run("decode"); run("encode"); run("clean");
    } else if (m.type === "result" && m.id === ids[m.mode as Mode]) {
      outputs[m.mode as Mode] = m.text;
      busy[m.mode as Mode] = false;
      if (autoCopy && m.mode === mode) {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => copyText(shown, true), 700);
      }
    } else if (m.type === "batchResult") {
      waiting.get(m.id)?.(m.files);
      waiting.delete(m.id);
    }
  };
  worker.postMessage({
    type: "init",
    words: new URL("words.txt", document.baseURI).href,
    common: new URL("common-words.txt", document.baseURI).href
  });

  const styleFor = (m: Mode) => (m === "encode" ? style : m === "clean" ? JSON.stringify(opts) : "");
  function run(m: Mode) {
    const id = ++seq;
    ids[m] = id;
    busy[m] = true;
    worker.postMessage({ type: "run", id, mode: m, style: styleFor(m), text: inputs[m] });
  }
  // Live: every change is sent to the worker; the newest request cancels older ones.
  $effect(() => run("decode"));
  $effect(() => run("encode"));
  $effect(() => run("clean")); // also reruns when any formatting option changes

  /* ---------- derived output: find & replace, diff ---------- */
  const fr = $derived(findReplace(outputs[mode], find, repl, { regex: frRegex, caseSensitive: frCase }));
  const shown = $derived(fr.text);
  const diff = $derived(showDiff ? diffWords(inputs[mode], shown) : null);

  /* ---------- saving, theme ---------- */
  let saveTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const data: any = { remember, autoCopy, theme, presets: $state.snapshot(presets), mode, style, opts: $state.snapshot(opts) };
    if (remember) { data.inputs = $state.snapshot(inputs); data.original = original; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ } }, 400);
  });
  $effect(() => {
    const r = document.documentElement;
    if (theme === "auto") r.removeAttribute("data-theme"); else r.dataset.theme = theme;
  });
  function forget() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    remember = false; presets = []; autoCopy = false;
    flash("Saved data erased from this browser.");
  }

  /* ---------- helpers ---------- */
  function flash(t: string) { note = t; setTimeout(() => (note = ""), 2800); }
  async function copyText(t: string, quiet = false) {
    if (!t) return quiet ? undefined : flash("Nothing to copy yet.");
    try { await navigator.clipboard.writeText(t); flash(quiet ? "Auto-copied." : "Copied to clipboard."); }
    catch { flash("Copy blocked by the browser. Select the text and copy it manually."); }
  }
  const copy = () => copyText(shown);
  async function paste() {
    try { setInput(await navigator.clipboard.readText(), true); }
    catch { flash("Paste blocked by the browser. Press Ctrl+V in the box instead."); }
  }
  function saveFile(blob: Blob, name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function download() {
    if (!shown) return flash("Nothing to download yet.");
    saveFile(new Blob([shown], { type: "text/plain;charset=utf-8" }), `${DONE[mode]}-text.txt`);
  }

  /* ---------- input + undo/redo ---------- */
  function commit(m: Mode, text: string, force = false) {
    const h = hist[m];
    if (h.s[h.i] === text) return;
    const now = Date.now();
    if (!force && now - h.t < 700 && h.i > 0 && h.i === h.s.length - 1) h.s[h.i] = text; // merge fast typing
    else {
      h.s = h.s.slice(0, h.i + 1);
      h.s.push(text); h.i++;
      if (h.s.length > 100) { h.s.shift(); h.i--; }
    }
    h.t = now;
  }
  // Everything starts from the text the person typed, pasted or opened themselves, never from another tab's output.
  function setInput(t: string, force = false) { inputs[mode] = t; original = t; commit(mode, t, force); }
  function undo() { const h = hist[mode]; if (h.i > 0) { h.i--; inputs[mode] = original = h.s[h.i]; } }
  function redo() { const h = hist[mode]; if (h.i < h.s.length - 1) { h.i++; inputs[mode] = original = h.s[h.i]; } }
  function sendTo(other: Mode) {
    inputs[other] = original;
    commit(other, original, true);
    mode = other;
  }
  async function openFile(f?: File) { if (f) setInput(await f.text(), true); }

  /* ---------- batch files -> zip ---------- */
  let batchSeq = 0;
  async function batch(list: FileList | null) {
    if (!list?.length) return;
    flash(`Processing ${list.length} file(s)…`);
    const files = await Promise.all([...list].map(async f => ({ name: f.name, text: await f.text() })));
    const id = ++batchSeq;
    const done = new Promise<{ name: string; text: string }[]>(r => waiting.set(id, r));
    worker.postMessage({ type: "batch", id, mode, style: styleFor(mode), files });
    const res = await done;
    const used = new Set<string>();
    const named = res.map(f => {
      const base = f.name.replace(/\.[^.]*$/, "") || "file";
      let n = `${base}.${DONE[mode]}.txt`, k = 2;
      while (used.has(n)) n = `${base}.${DONE[mode]}-${k++}.txt`;
      used.add(n);
      return { name: n, text: f.text };
    });
    if (named.length === 1) saveFile(new Blob([named[0].text], { type: "text/plain;charset=utf-8" }), named[0].name);
    else saveFile(new Blob([makeZip(named)], { type: "application/zip" }), `${DONE[mode]}-files.zip`);
    flash(`Done: ${named.length} file(s).`);
  }

  /* ---------- presets ---------- */
  function applyPreset(v: string) {
    presetSel = v;
    const [kind, idx] = [v[0], +v.slice(2)];
    const p = kind === "b" ? BUILTIN_PRESETS[idx]?.opts : presets[idx]?.opts;
    if (p) Object.assign(opts, { ...DEFAULTS, ...p });
  }
  function savePreset() {
    const name = prompt("Name for this preset:")?.trim();
    if (!name) return;
    const entry = { name, opts: { ...$state.snapshot(opts) } as Opts };
    const i = presets.findIndex(p => p.name === name);
    if (i >= 0) presets[i] = entry; else presets.push(entry);
    presetSel = "u:" + presets.findIndex(p => p.name === name);
    flash(`Preset “${name}” saved.`);
  }
  function deletePreset() {
    if (presetSel[0] !== "u") return flash("Only your own presets can be deleted.");
    presets.splice(+presetSel.slice(2), 1);
    presetSel = "";
  }
  function resetOpts() { Object.assign(opts, DEFAULTS); presetSel = ""; }

  /* ---------- share link ---------- */
  async function share() {
    const code = await pack({ m: mode, t: original || inputs[mode], o: $state.snapshot(opts), s: style });
    const url = location.origin + location.pathname + "#s=" + code;
    try { await navigator.clipboard.writeText(url); flash(url.length > 8000 ? "Link copied, but it is very long and may not open everywhere." : "Share link copied."); }
    catch { flash("Copy blocked by the browser."); }
  }
  (async () => {
    if (!location.hash.startsWith("#s=")) return;
    try {
      const d = await unpack(location.hash.slice(3));
      if (MODES.includes(d.m)) mode = d.m;
      if (typeof d.s === "string") style = d.s;
      if (d.o) Object.assign(opts, { ...DEFAULTS, ...d.o });
      if (typeof d.t === "string") { inputs[mode] = original = d.t; commit(mode, d.t, true); }
      history.replaceState(null, "", location.pathname + location.search);
      flash("Opened a shared text with its settings.");
    } catch { flash("That share link could not be read."); }
  })();

  /* ---------- keyboard shortcuts ---------- */
  function onkey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); copy(); return; }
    if (!e.altKey) return;
    const n = ({ Digit1: 0, Digit2: 1, Digit3: 2 } as Record<string, number>)[e.code];
    if (n !== undefined) { e.preventDefault(); mode = MODES[n]; return; }
    const act: Record<string, () => void> = {
      KeyZ: undo, KeyY: redo, KeyC: copy, KeyV: paste, KeyX: () => setInput("", true), KeyD: () => (showDiff = !showDiff),
      KeyT: () => (theme = theme === "auto" ? "dark" : theme === "dark" ? "light" : "auto"),
      KeyS: () => sendTo(MODES[(MODES.indexOf(mode) + 1) % 3])
    };
    if (act[e.code]) { e.preventDefault(); act[e.code](); }
  }
</script>

<svelte:window onkeydown={onkey} />

<main>
  <h1>Smart Text Decoder</h1>
  <p class="sub">Clean up dotted, spaced and symbol-scrambled text, or scramble your own. Live, private, no size limit.</p>

  <div class="tabs">
    {#each MODES as m}
      <button class:on={mode === m} onclick={() => (mode = m)}>{LABEL[m]}</button>
    {/each}
  </div>

  <div class="toolbar">
    <button class="b" onclick={undo} disabled={hist[mode].i < 1} title="Undo (Alt+Z)">Undo</button>
    <button class="b" onclick={redo} disabled={hist[mode].i >= hist[mode].s.length - 1} title="Redo (Alt+Y)">Redo</button>
    <label class="b">Batch files<input type="file" multiple accept=".txt,text/plain" onchange={(e) => { batch(e.currentTarget.files); e.currentTarget.value = ""; }} /></label>
    <button class="b" onclick={share}>Share link</button>
    <button class="b" class:active={showDiff} onclick={() => (showDiff = !showDiff)} title="Alt+D">Diff</button>
    <select bind:value={theme} aria-label="Theme">
      <option value="auto">Theme: auto</option>
      <option value="light">Theme: light</option>
      <option value="dark">Theme: dark</option>
    </select>
    <label class="chk"><input type="checkbox" bind:checked={autoCopy} /> Auto-copy result</label>
    <label class="chk"><input type="checkbox" bind:checked={remember} /> Remember my text</label>
  </div>

  <div class="grid">
    <section class="card">
      <div class="head">
        <span>{mode === "decode" ? "Scrambled text" : mode === "clean" ? "Text with separators (a-b-c, a.b.c, a_b_c)" : "Normal text"}</span>
        <span class="tools"><small>{inputs[mode].length.toLocaleString()} chars</small><button class="mini" title="Copy this text" onclick={() => copyText(inputs[mode])}>Copy</button></span>
      </div>
      <textarea
        value={inputs[mode]}
        oninput={(e) => setInput(e.currentTarget.value)}
        spellcheck="false"
        placeholder={mode === "decode" ? "he. ll o.wo .rl d\nhe$llo.w$orl...d" : mode === "clean" ? "this-is-a-sentence-with-hyphens\nmy.dotted.text_here" : "Type or paste normal text…"}
        ondrop={(e) => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); openFile(f); } }}
      ></textarea>
      <div class="bar">
        <label class="b">Open .txt<input type="file" accept=".txt,text/plain" onchange={(e) => openFile(e.currentTarget.files?.[0])} /></label>
        <button class="b" onclick={paste}>Paste</button>
        <button class="b" onclick={() => setInput("", true)}>Clear</button>
        {#if mode === "encode"}
          <select bind:value={style} aria-label="Scramble style">
            <option value="mixed">Mixed noise</option>
            <option value="dots">Dots</option>
            <option value="symbols">Symbols</option>
            <option value="spaced">Spaced letters</option>
          </select>
        {/if}
      </div>
    </section>

    <section class="card">
      <div class="head">
        <span>{mode === "decode" ? "Readable text" : mode === "clean" ? "Clean text" : "Scrambled text"}</span>
        <span class="tools"><small>{busy[mode] ? "working…" : `${shown.length.toLocaleString()} chars`}</small><button class="mini" title="Copy result" onclick={copy}>Copy</button></span>
      </div>
      <textarea readonly value={shown}></textarea>
      <div class="bar">
        <button class="b" onclick={copy}>Copy</button>
        <button class="b" onclick={download}>Download .txt</button>
        {#each MODES.filter((x) => x !== mode) as t}
          <button class="b" onclick={() => sendTo(t)}>Send to {LABEL[t]}</button>
        {/each}
      </div>
      <details class="fr">
        <summary>Find &amp; replace in the result{fr.count ? ` · ${fr.count} found` : ""}{fr.error ? ` · ${fr.error}` : ""}</summary>
        <div class="bar">
          <input type="text" placeholder="Find" bind:value={find} />
          <input type="text" placeholder="Replace with" bind:value={repl} />
          <label class="chk"><input type="checkbox" bind:checked={frRegex} /> Regex</label>
          <label class="chk"><input type="checkbox" bind:checked={frCase} /> Match case</label>
        </div>
      </details>
    </section>
  </div>

  {#if showDiff}
    <section class="card diff">
      <div class="head"><span>What changed</span><small><span class="del">removed</span> · <span class="add">added</span></small></div>
      {#if diff}
        <p>{#each diff as g}<span class={g.k}>{g.t}</span>{" "}{/each}</p>
      {:else}
        <p class="muted">The text is too long to compare word by word (limit: 2,500 words in the changed part).</p>
      {/if}
    </section>
  {/if}

  {#if mode === "clean"}
    <section class="card opts">
      <div class="head">
        <span>Formatting options</span>
        <span class="tools">
          <select value={presetSel} onchange={(e) => applyPreset(e.currentTarget.value)} aria-label="Presets">
            <option value="" disabled>Presets…</option>
            <optgroup label="Built-in">
              {#each BUILTIN_PRESETS as p, i}<option value={"b:" + i}>{p.name}</option>{/each}
            </optgroup>
            {#if presets.length}
              <optgroup label="My presets">
                {#each presets as p, i}<option value={"u:" + i}>{p.name}</option>{/each}
              </optgroup>
            {/if}
          </select>
          <button class="mini" onclick={savePreset}>Save preset</button>
          <button class="mini" onclick={deletePreset}>Delete</button>
          <button class="mini" onclick={resetOpts}>Reset</button>
        </span>
      </div>
      {#each GROUPS as g}
        <details open={g.open}>
          <summary>{g.title}</summary>
          <div class="fields">
            {#each g.fields as f}
              <label class="f">
                <span>{f.label}</span>
                {#if f.type === "select"}
                  <select bind:value={opts[f.key]}>
                    {#each f.choices ?? [] as [v, l]}<option value={v}>{l}</option>{/each}
                  </select>
                {:else if f.type === "textarea"}
                  <textarea class="sm" rows="2" bind:value={opts[f.key]} placeholder={f.placeholder} spellcheck="false"></textarea>
                {:else}
                  <input type="text" bind:value={opts[f.key]} placeholder={f.placeholder} spellcheck="false" />
                {/if}
              </label>
            {/each}
          </div>
        </details>
      {/each}
    </section>
  {/if}

  <details class="keys">
    <summary>Keyboard shortcuts and privacy</summary>
    <p><b>Alt+1 / 2 / 3</b> switch tab · <b>Ctrl+Enter</b> copy result · <b>Alt+C</b> copy · <b>Alt+V</b> paste · <b>Alt+X</b> clear · <b>Alt+Z / Alt+Y</b> undo / redo · <b>Alt+S</b> send to next tab · <b>Alt+D</b> diff · <b>Alt+T</b> theme</p>
    <p>Everything runs in your browser. If “Remember my text” is on, your text and settings are kept only in this browser. <button class="mini" onclick={forget}>Erase saved data</button></p>
  </details>

  <p class="status" aria-live="polite"><b>{note}</b> {note ? "·" : ""} {dict}</p>
</main>
