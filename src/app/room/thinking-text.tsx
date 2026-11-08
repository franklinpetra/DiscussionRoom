"use client";

import { useEffect, useState } from "react";
import { hasThinkingMarks, nextWordEnd, revealDelay, thoughts } from "@/lib/thinking";

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A blind answer as a mind at work: its own marks set in bold, italic, small and struck-out
 * type, revealed word by word at a thinking pace while the model writes. Finished answers (and
 * anyone who prefers less motion) see the whole text at once.
 */
export default function ThinkingText({
  text,
  keyPhrase,
  reveal,
}: {
  text: string;
  /** Shown in bold when the model marked nothing itself. */
  keyPhrase?: string;
  /** Pace the words in, rather than showing them all at once. */
  reveal: boolean;
}) {
  const [shown, setShown] = useState(() => (reveal && !prefersReducedMotion() ? 0 : text.length));
  const paced = reveal && !prefersReducedMotion();
  const visible = paced ? Math.min(shown, text.length) : text.length;

  useEffect(() => {
    if (!paced || shown >= text.length) return;
    const end = nextWordEnd(text, shown);
    const timer = setTimeout(() => setShown(end), revealDelay(text.slice(shown, end), text.length - end));
    return () => clearTimeout(timer);
  }, [paced, shown, text]);

  const slice = text.slice(0, visible);
  const marked = hasThinkingMarks(text);
  return (
    <p className="thinking-text">
      {thoughts(slice).map((thought, i) =>
        thought.kind === "bold" ? (
          <strong className="thought-bold" key={i}>{thought.text}</strong>
        ) : thought.kind === "aside" ? (
          <em className="thought-aside" key={i}>{thought.text}</em>
        ) : thought.kind === "hedge" ? (
          <small className="thought-hedge" key={i}>{thought.text}</small>
        ) : thought.kind === "struck" ? (
          <s className="thought-struck" key={i}>{thought.text}</s>
        ) : (
          <span key={i}>{thought.text}</span>
        ),
      )}
      {!marked && keyPhrase && visible >= text.length && (
        <strong className="thought-bold thought-key">{keyPhrase}</strong>
      )}
    </p>
  );
}
