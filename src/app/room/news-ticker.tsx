"use client";

import { useEffect, useState } from "react";
import type { TickerPrompt } from "@/lib/ticker";

/**
 * "Not sure what to ask? From today's news →": short prompts drift past just above the question
 * box. Hovering, focusing or the pause button stops them; with reduced motion they sit still.
 * A click fills the box (it doesn't start the room) and attaches the story's summary.
 */
export default function NewsTicker({ onPick, disabled }: { onPick: (prompt: TickerPrompt) => void; disabled?: boolean }) {
  const [prompts, setPrompts] = useState<TickerPrompt[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ticker", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { prompts?: TickerPrompt[] } | null) => {
        if (Array.isArray(payload?.prompts)) setPrompts(payload.prompts);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!prompts.length) return null;
  const item = (prompt: TickerPrompt, copy: boolean, i: number) => (
    <li aria-hidden={copy || undefined} key={`${copy ? "b" : "a"}-${i}`}>
      <button
        disabled={disabled}
        onClick={() => onPick(prompt)}
        tabIndex={copy ? -1 : undefined}
        title={`From ${prompt.source}`}
        type="button"
      >
        <span className="ticker-tag" data-tag={prompt.tag}>{prompt.tag}</span>
        {prompt.question}
      </button>
    </li>
  );

  return (
    <div className="news-ticker" data-paused={paused || undefined}>
      <span className="ticker-label">Not sure what to ask? From today&apos;s news →</span>
      <div className="ticker-viewport">
        <ul aria-label="Prompts from today's news" className="ticker-track" style={{ ["--ticker-count" as string]: prompts.length }}>
          {prompts.map((prompt, i) => item(prompt, false, i))}
          {/* A second copy makes the loop seamless; screen readers and the keyboard skip it. */}
          {prompts.map((prompt, i) => item(prompt, true, i))}
        </ul>
      </div>
      <button
        aria-label={paused ? "Play the news prompts" : "Pause the news prompts"}
        aria-pressed={paused}
        className="ticker-pause"
        onClick={() => setPaused((value) => !value)}
        type="button"
      >
        {paused ? "▶" : "❚❚"}
      </button>
    </div>
  );
}
