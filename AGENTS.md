# Repository Guidelines

Schnell-Lesen is a speed reading app built with React + Vite. It displays words one at a time with an ORP (Optimal Recognition Point) focus letter highlighted, supporting PDF and EPUB imports.

## Project Structure & Module Organization

```
schnell-lesen/
├── src/
│   ├── App.tsx          # Main reader component with all UI logic
│   ├── epub-parser.ts   # EPUB file parsing utility
│   ├── main.tsx         # React entry point
│   ├── styles.css       # All styles (dark theme, glass panels)
│   └── vite-env.d.ts    # Vite type declarations
├── dist/                # Production build output (gitignored)
├── index.html           # HTML entry point
├── package.json
├── tsconfig.json
└── vite.config.js
```

## Build, Test, and Development Commands

- `pnpm dev`: start the Vite development server at localhost:5173
- `pnpm build`: produce production assets in `dist/`
- `pnpm preview`: preview the production build locally

## Key Components & Architecture

### App.tsx

- `Reader`: Main component managing playback state, word index, WPM, file loading
- `WordDisplay`: Displays current word with ORP-centered focus letter using CSS grid (`1fr auto 1fr`)
- `WpmControls`: Words-per-minute adjustment panel
- `KeyboardHint`: Collapsible keyboard shortcuts overlay

### Word Processing

- `tokenize()`: Splits text into words, handles hyphenated words split across lines
- `splitWord()`: Calculates ORP focus letter (roughly center of word)
- `getWordDelayMs()`: Calculates display time with pauses for punctuation and long words

### File Import

- PDF: Uses `pdfjs-dist` to extract text page by page
- EPUB: Uses custom `epub-parser.ts` with `@gxl/epub-parser`
- Sections become navigable chapters

### Dynamic Word Scaling

Long words are measured against container width and scaled down using CSS `transform: scale()` to prevent overflow while keeping the focus letter centered.

## Coding Style & Naming Conventions

- 2-space indentation for TypeScript/CSS
- `kebab-case` for file names (`epub-parser.ts`)
- `PascalCase` for React components (`WordDisplay`)
- `camelCase` for functions and variables
- Memoize components with `memo()` where props are stable

## CSS Architecture

- CSS custom properties in `:root` for theming (`--accent`, `--glass`, `--border`, `--muted`)
- Glass morphism panels with `backdrop-filter: blur()`
- Responsive breakpoint at 900px for mobile layout
- `clamp()` for fluid typography

## Testing Guidelines

No test framework configured yet. When adding tests:

- Place in `tests/` mirroring `src/` structure
- Name files `*.test.ts` or `*.test.tsx`

## Commit & Pull Request Guidelines

- Use concise, imperative commit messages (e.g., `Add dynamic word scaling for long words`)
- PRs should include description, testing notes, and screenshots for UI changes

## Agent-Specific Instructions

When modifying the reader:

1. Word display changes: Update `WordDisplay` component and `.word*` CSS classes together
2. Timing changes: Adjust constants at top of `App.tsx` (`SENTENCE_PAUSE`, `CLAUSE_PAUSE`, etc.)
3. File parsing: PDF logic is inline in `App.tsx`, EPUB is in separate `epub-parser.ts`
4. The loader panel auto-collapses after successful file/text load
