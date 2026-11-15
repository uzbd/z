# Smart Text Decoder

Decode scrambled text (`he. ll o.wo .rl d`, `he$llo.w$orl...d`, `h.e.l.l.o`) into clean words, or encode normal text into scrambled text. Both directions run live in a Web Worker, so the page never freezes, with no size limit. Copy and `.txt` download for both. Installable and offline-capable (PWA). Built with Vite 8, Svelte 5 and TypeScript, deployed to GitHub Pages.

## Run locally

    npm install
    curl -L https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt -o public/words.txt
    curl -L https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt -o public/common-words.txt
    npm run dev

Without the two dictionary files the app still works with a small built-in word list.

## Deploy

1. Push this folder to a repository's `main` branch (include `.github`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The workflow downloads the dictionaries, builds, and publishes `dist`. For a `username.github.io` repository, change `BASE_PATH` in the workflow to `/`.

## Notes

- Decoding is dictionary-based segmentation, not an AI model, so ambiguous strings can have more than one reading.
- The encoder separates words with three spaces, which the decoder treats as a hard word boundary. Rare words and names restore best when the scrambled text keeps those gaps. Digits, links, emails and non-English text are never scrambled.
- Leetspeak (`h3llo`) and look-alike letters from other alphabets are not converted.
