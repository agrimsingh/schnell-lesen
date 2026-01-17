import {
  Component,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { parseEpubSections } from "./epub-parser";

const DEFAULT_TEXT =
  "Speed reading is a skill you can train. Adjust the words per minute, load your own text, and focus on the highlighted letter as each word appears.";

const MIN_WPM = 120;
const MAX_WPM = 1200;
const WPM_STEP = 10;
const SENTENCE_PAUSE = 1.6;
const CLAUSE_PAUSE = 1.3;
const LONG_WORD_PAUSE = 1.1;
const LONG_WORD_LENGTH = 9;
const STORAGE_KEY_WPM = "schnell-lesen-wpm";

type ReaderStatus = {
  type: "idle" | "loading" | "success" | "error";
  message: string;
};

type Chapter = {
  title: string;
  startIndex: number;
  endIndex: number;
};

type TextSection = {
  title: string;
  text: string;
};

// --- Utilities ---

const tokenize = (text: string) => {
  const normalized = text
    .replace(/\u00ad/g, "")
    .replace(/([A-Za-z])[-‐‑‒–—]\s+([a-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const parts = normalized.split(" ");
  const tokens: string[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const word = parts[index];
    const next = parts[index + 1];
    if (word.endsWith("-") && next && /^[a-z]/.test(next)) {
      tokens.push(`${word.slice(0, -1)}${next}`);
      index += 1;
      continue;
    }
    tokens.push(word);
  }

  return tokens;
};

const splitWord = (word: string) => {
  if (!word) return { prefix: "", focus: "", suffix: "" };
  const focusIndex = Math.max(0, Math.floor((word.length - 1) / 2));
  return {
    prefix: word.slice(0, focusIndex),
    focus: word.charAt(focusIndex),
    suffix: word.slice(focusIndex + 1),
  };
};

const isTypingTarget = (target: EventTarget | null): target is HTMLElement => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
};

const loadStoredWpm = (): number => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_WPM);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!Number.isNaN(parsed) && parsed >= MIN_WPM && parsed <= MAX_WPM) {
        return parsed;
      }
    }
  } catch {
    // localStorage unavailable
  }
  return 320;
};

const saveWpm = (wpm: number) => {
  try {
    localStorage.setItem(STORAGE_KEY_WPM, String(wpm));
  } catch {
    // localStorage unavailable
  }
};

const extractTextFromPdf = async (arrayBuffer: ArrayBuffer) => {
  const pdfjs = await import("pdfjs-dist/build/pdf");
  const workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  );
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc.toString();

  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  // Process pages in parallel batches to balance speed vs memory
  const BATCH_SIZE = 5;
  const sections: TextSection[] = [];

  for (let start = 1; start <= pdf.numPages; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, pdf.numPages);
    const pageIndices = Array.from(
      { length: end - start + 1 },
      (_, i) => start + i
    );

    const batchResults = await Promise.all(
      pageIndices.map(async (pageIndex) => {
        const page = await pdf.getPage(pageIndex);
        const content = await page.getTextContent();
        const rawText = content.items
          .map((item) => (item.str ? item.str : ""))
          .join(" ");
        const pageText = rawText
          .replace(/-\s*\n\s*/g, "")
          .replace(/\s*\n+\s*/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim();
        return { title: `Page ${pageIndex}`, text: pageText };
      })
    );

    sections.push(...batchResults);
  }

  return sections;
};

const getWordDelayMs = (word: string, wpm: number) => {
  const base = 60000 / wpm;
  let multiplier = 1;
  if (/[.?!]["')\]]?$/.test(word)) {
    multiplier = Math.max(multiplier, SENTENCE_PAUSE);
  } else if (/[,;:]["')\]]?$/.test(word)) {
    multiplier = Math.max(multiplier, CLAUSE_PAUSE);
  }
  if (word.length >= LONG_WORD_LENGTH) {
    multiplier = Math.max(multiplier, LONG_WORD_PAUSE);
  }
  return Math.max(50, Math.round(base * multiplier));
};

// --- Error Boundary ---

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { hasError: boolean };

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app">
          <div className="reader">
            <div className="reader-frame">
              <div className="error-message">
                Something went wrong. Please refresh the page.
              </div>
            </div>
            <div className="reader-controls">
              <button
                className="primary"
                onClick={() => window.location.reload()}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Memoized Components ---

type WordDisplayProps = {
  prefix: string;
  focus: string;
  suffix: string;
};

const WordDisplay = memo(function WordDisplay({
  prefix,
  focus,
  suffix,
}: WordDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const word = prefix + focus + suffix;

  const updateScale = useCallback(() => {
    const container = containerRef.current;
    const wordEl = wordRef.current;
    if (!container || !wordEl) return;

    // Reset transform to measure true width
    wordEl.style.transform = "none";
    const containerWidth = container.offsetWidth;
    const wordWidth = wordEl.scrollWidth;
    const padding = 64;
    const availableWidth = containerWidth - padding;

    if (wordWidth > availableWidth) {
      const newScale = Math.max(0.5, availableWidth / wordWidth);
      wordEl.style.transform = `scale(${newScale})`;
    } else {
      wordEl.style.transform = "";
    }
  }, []);

  useLayoutEffect(() => {
    updateScale();
  }, [word, updateScale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      updateScale();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [updateScale]);

  return (
    <div className="word-container" ref={containerRef}>
      <div className="word" ref={wordRef} aria-live="polite">
        <span className="word-prefix">{prefix}</span>
        <span className="word-focus">{focus}</span>
        <span className="word-suffix">{suffix}</span>
      </div>
    </div>
  );
});

type WpmControlsProps = {
  wpm: number;
  onDecrease: () => void;
  onIncrease: () => void;
};

const WpmControls = memo(function WpmControls({
  wpm,
  onDecrease,
  onIncrease,
}: WpmControlsProps) {
  return (
    <div className="panel panel-right">
      <div className="panel-title">Words per minute</div>
      <div className="wpm-controls">
        <button
          type="button"
          className="icon-pill"
          onClick={onDecrease}
          disabled={wpm <= MIN_WPM}
          aria-label="Decrease words per minute"
        >
          -
        </button>
        <div className="wpm-value">{wpm} wpm</div>
        <button
          type="button"
          className="icon-pill"
          onClick={onIncrease}
          disabled={wpm >= MAX_WPM}
          aria-label="Increase words per minute"
        >
          +
        </button>
      </div>
    </div>
  );
});

const KeyboardHint = memo(function KeyboardHint() {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isVisible) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsVisible(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsVisible(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isVisible]);

  return (
    <div className="keyboard-hint" ref={containerRef}>
      <button
        type="button"
        className="keyboard-hint-toggle"
        onClick={() => setIsVisible((v) => !v)}
        aria-label="Toggle keyboard shortcuts"
        aria-expanded={isVisible}
      >
        ?
      </button>
      {isVisible ? (
        <div className="keyboard-hint-panel">
          <div className="keyboard-hint-title">Keyboard Shortcuts</div>
          <div className="keyboard-hint-row">
            <kbd>Space</kbd> Play / Pause
          </div>
          <div className="keyboard-hint-row">
            <kbd>←</kbd> <kbd>J</kbd> Back 5 words
          </div>
          <div className="keyboard-hint-row">
            <kbd>→</kbd> <kbd>K</kbd> Forward 5 words
          </div>
          <div className="keyboard-hint-row">
            <kbd>Shift</kbd> + arrow = 20 words
          </div>
        </div>
      ) : null}
    </div>
  );
});

function Reader() {
  const [textInput, setTextInput] = useState(DEFAULT_TEXT);
  const [words, setWords] = useState(() => tokenize(DEFAULT_TEXT));
  const [chapters, setChapters] = useState<Chapter[]>([
    {
      title: "Full text",
      startIndex: 0,
      endIndex: tokenize(DEFAULT_TEXT).length - 1,
    },
  ]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [wpm, setWpm] = useState(loadStoredWpm);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaderOpen, setIsLoaderOpen] = useState(false);
  const [status, setStatus] = useState<ReaderStatus>({
    type: "idle",
    message: "",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentWord = words[currentIndex] ?? "";
  const split = useMemo(() => splitWord(currentWord), [currentWord]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    if (currentIndex >= words.length - 1) {
      setIsPlaying(false);
      return undefined;
    }

    const interval = getWordDelayMs(currentWord, wpm);
    const timeoutId = window.setTimeout(() => {
      setCurrentIndex((index) => Math.min(index + 1, words.length - 1));
    }, interval);

    return () => window.clearTimeout(timeoutId);
  }, [currentIndex, currentWord, isPlaying, wpm, words.length]);

  const jumpBy = useCallback(
    (delta: number) => {
      setIsPlaying(false);
      setCurrentIndex((index) => {
        const maxIndex = Math.max(words.length - 1, 0);
        return Math.min(Math.max(index + delta, 0), maxIndex);
      });
    },
    [words.length]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if (event.code === "Space") {
        event.preventDefault();
        setIsPlaying((prev) => !prev);
        return;
      }

      const isBack = event.code === "ArrowLeft" || event.code === "KeyJ";
      const isForward = event.code === "ArrowRight" || event.code === "KeyK";
      if (!isBack && !isForward) return;

      event.preventDefault();
      const step = event.shiftKey ? 20 : 5;
      jumpBy(isForward ? step : -step);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [jumpBy]);

  const resetReader = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(0);
  }, []);

  const applySections = useCallback((sections: TextSection[]) => {
    const nextWords: string[] = [];
    const nextChapters: Chapter[] = [];
    let offset = 0;

    sections.forEach((section, index) => {
      const sectionWords = tokenize(section.text);
      if (sectionWords.length === 0) return;
      nextWords.push(...sectionWords);
      nextChapters.push({
        title: section.title || `Section ${index + 1}`,
        startIndex: offset,
        endIndex: offset + sectionWords.length - 1,
      });
      offset += sectionWords.length;
    });

    setWords(nextWords);
    setChapters(
      nextChapters.length
        ? nextChapters
        : [{ title: "Full text", startIndex: 0, endIndex: 0 }]
    );
    setCurrentIndex(0);
    setIsPlaying(false);
  }, []);

  const handleTextLoad = useCallback(() => {
    if (!textInput.trim()) return;
    applySections([{ title: "Full text", text: textInput }]);
    setStatus({ type: "idle", message: "" });
    setIsLoaderOpen(false);
  }, [applySections, textInput]);

  const handleFileButton = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileLoad = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setStatus({ type: "loading", message: `Loading ${file.name}...` });

      try {
        const extension = file.name.split(".").pop()?.toLowerCase();
        let sections: TextSection[] = [];

        if (extension === "pdf") {
          const buffer = await file.arrayBuffer();
          sections = await extractTextFromPdf(buffer);
        } else if (extension === "epub") {
          const buffer = await file.arrayBuffer();
          sections = await parseEpubSections(buffer);
        } else {
          const text = await file.text();
          sections = [{ title: "Full text", text }];
        }

        applySections(sections);
        setStatus({ type: "success", message: `Loaded ${file.name}` });
        setIsLoaderOpen(false);
      } catch (error) {
        setStatus({
          type: "error",
          message: "Could not read the file. Try a different format.",
        });
      } finally {
        event.target.value = "";
      }
    },
    [applySections]
  );

  const decreaseWpm = useCallback(() => {
    setWpm((prev) => {
      const next = Math.max(MIN_WPM, prev - WPM_STEP);
      saveWpm(next);
      return next;
    });
  }, []);

  const increaseWpm = useCallback(() => {
    setWpm((prev) => {
      const next = Math.min(MAX_WPM, prev + WPM_STEP);
      saveWpm(next);
      return next;
    });
  }, []);

  const handleScrub = useCallback((nextIndex: number) => {
    setIsPlaying(false);
    setCurrentIndex(nextIndex);
  }, []);

  const currentChapterIndex = useMemo(() => {
    if (chapters.length === 0) return 0;
    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index];
      if (
        currentIndex >= chapter.startIndex &&
        currentIndex <= chapter.endIndex
      ) {
        return index;
      }
    }
    return 0;
  }, [chapters, currentIndex]);

  const currentChapter = chapters[currentChapterIndex];
  const progressLabel = words.length
    ? `${currentIndex + 1} / ${words.length}`
    : "0 / 0";

  const goToChapter = useCallback(
    (nextIndex: number) => {
      const target = Math.min(Math.max(nextIndex, 0), chapters.length - 1);
      const startIndex = chapters[target]?.startIndex ?? 0;
      handleScrub(startIndex);
    },
    [chapters, handleScrub]
  );

  return (
    <div className="app">
      <div className="reader">
        <div className="reader-frame">
          <div className="focus-lines" aria-hidden="true" />
          <WordDisplay
            prefix={split.prefix}
            focus={split.focus}
            suffix={split.suffix}
          />
        </div>
        <div className="reader-meta">
          <div className="progress">{progressLabel}</div>
          <div className="status">
            {status.message ? (
              <span className={`status-${status.type}`}>{status.message}</span>
            ) : null}
          </div>
        </div>
        <div className="reader-controls">
          <button className="primary" onClick={() => setIsPlaying((p) => !p)}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button onClick={resetReader}>Restart</button>
        </div>
        <div className="reader-scrubber">
          <div className="reader-scrubber-label">
            {currentChapter ? currentChapter.title : "No chapters"}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(words.length - 1, 0)}
            value={currentIndex}
            onChange={(event) => handleScrub(Number(event.target.value))}
          />
        </div>
      </div>

      <div
        className={`panel panel-left ${isLoaderOpen ? "is-open" : "is-collapsed"}`}
      >
        {isLoaderOpen ? (
          <>
            <div className="panel-header">
              <div className="panel-title">Load text or book</div>
              <button
                className="panel-toggle"
                type="button"
                onClick={() => setIsLoaderOpen(false)}
              >
                Close
              </button>
            </div>
            <textarea
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              placeholder="Paste text here"
              rows={6}
            />
            <div className="panel-actions">
              <button onClick={handleTextLoad}>Use text</button>
              <button onClick={handleFileButton}>Import file</button>
              <input
                ref={fileInputRef}
                className="file-input"
                type="file"
                accept=".txt,.pdf,.epub"
                onChange={handleFileLoad}
              />
            </div>
            <div className="panel-select">
              <select
                value={currentChapterIndex}
                onChange={(event) =>
                  handleScrub(
                    chapters[Number(event.target.value)]?.startIndex ?? 0
                  )
                }
                disabled={chapters.length === 0}
              >
                {chapters.map((chapter, index) => (
                  <option key={chapter.title + index} value={index}>
                    {chapter.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="panel-hint">Supports .txt, .pdf, and .epub</div>
          </>
        ) : (
          <div className="panel-collapsed">
            <button
              className="icon-pill"
              type="button"
              onClick={() => goToChapter(currentChapterIndex - 1)}
              disabled={currentChapterIndex === 0}
              aria-label="Previous chapter"
            >
              ‹
            </button>
            <button
              className="panel-collapsed-title"
              type="button"
              onClick={() => setIsLoaderOpen(true)}
              title="Open loader"
            >
              {currentChapter?.title || "Full text"}
            </button>
            <button
              className="icon-pill"
              type="button"
              onClick={() => goToChapter(currentChapterIndex + 1)}
              disabled={currentChapterIndex >= chapters.length - 1}
              aria-label="Next chapter"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <WpmControls wpm={wpm} onDecrease={decreaseWpm} onIncrease={increaseWpm} />
      <KeyboardHint />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Reader />
    </ErrorBoundary>
  );
}
