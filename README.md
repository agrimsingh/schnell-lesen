# Schnell Lesen

A speed reading app that displays text one word at a time using RSVP (Rapid Serial Visual Presentation). The focus letter is highlighted and centered to reduce eye movement and increase reading speed.

## Features

- **Adjustable WPM** — 120 to 1200 words per minute, persisted to localStorage
- **Smart timing** — Pauses longer on sentence endings, clause breaks, and long words
- **File support** — Load `.txt`, `.pdf`, and `.epub` files with chapter navigation
- **Dynamic scaling** — Long words automatically scale down to fit
- **Keyboard controls** — Play/pause, skip forward/back
- **Hyphenation handling** — Rejoins words split across lines in PDFs and ebooks

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173)

## Usage

1. Paste text or import a file using the bottom-left panel
2. Press **Play** or hit **Space** to start
3. Adjust speed with the WPM controls (bottom-right)
4. Use the scrubber or chapter buttons to navigate

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` or `J` | Back 5 words |
| `→` or `K` | Forward 5 words |
| `Shift` + arrow | Jump 20 words |

## Scripts

```bash
pnpm dev      # Start dev server
pnpm build    # Production build
pnpm preview  # Preview production build
```

## Tech Stack

- React 18
- Vite
- TypeScript
- pdfjs-dist (PDF parsing)
- fflate + fast-xml-parser (EPUB parsing)

## License

MIT
