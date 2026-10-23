"use client";

import Link from "next/link";
import { useState } from "react";
import KeyControl from "@/app/room/key-control";

/**
 * The artist lab (experiment, not linked from the site): the same line painted by several
 * fast image models side by side, with the time and cost of each, to judge which watercolor
 * feels right for the room. Requests go from this browser to OpenRouter on the visitor's key.
 */

const MODELS = [
  { id: "google/gemini-nano-banana-2.1", name: "Nano Banana 2.1", by: "Google" },
  { id: "google/gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image", by: "Google" },
  { id: "black-forest-labs/flux-3-image-klein", name: "Flux 3 Klein", by: "Black Forest Labs" },
  { id: "black-forest-labs/flux-3-image", name: "Flux 3", by: "Black Forest Labs" },
  { id: "bytedance-seed/seedream-5-0-flash", name: "Seedream 5 Flash", by: "ByteDance" },
  { id: "recraft/recraft-v4.1-flash", name: "Recraft 4.1 Flash", by: "Recraft" },
];

const STYLES = {
  watercolor:
    "A loose, quick watercolor sketch in an illustrator's notebook: light pen-and-ink lines with soft, " +
    "transparent watercolor washes, gentle and airy, lots of white space, no text, plain white background.",
  napkin:
    "A quick pen sketch on a paper napkin: loose wobbly ink lines, a single color, playful and simple, " +
    "no shading, no text, plain white background.",
  ink:
    "A confident brush-and-ink drawing with a touch of watercolor, expressive and minimal, " +
    "like a travel sketchbook, no text, plain white background.",
};

type Result = { status: "painting" | "done" | "failed"; src?: string; seconds?: number; cost?: number; error?: string };

async function paint(apiKey: string, model: string, prompt: string): Promise<Result> {
  const started = performance.now();
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, aspect_ratio: "16:9", resolution: "1K", n: 1 }),
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: { b64_json?: string; media_type?: string }[];
    usage?: { cost?: number };
    error?: { message?: string };
  } | null;
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  if (!response.ok || !payload?.data?.[0]?.b64_json) {
    return { status: "failed", seconds, error: payload?.error?.message ?? `HTTP ${response.status}` };
  }
  const image = payload.data[0];
  return {
    status: "done",
    src: `data:${image.media_type ?? "image/png"};base64,${image.b64_json}`,
    seconds,
    cost: payload.usage?.cost,
  };
}

export default function ArtistLab() {
  const [apiKey, setApiKey] = useState("");
  const [line, setLine] = useState("Trust is the bridge, not the cargo: two people building it from opposite banks.");
  const [style, setStyle] = useState<keyof typeof STYLES>("watercolor");
  const [chosen, setChosen] = useState<string[]>(MODELS.map((model) => model.id));
  const [results, setResults] = useState<Record<string, Result>>({});
  const [error, setError] = useState("");

  async function paintAll() {
    if (!apiKey.trim()) {
      setError("Add your OpenRouter key first (top right).");
      return;
    }
    setError("");
    const prompt = `${STYLES[style]} The subject: ${line.trim()}`;
    setResults(Object.fromEntries(chosen.map((id) => [id, { status: "painting" } as Result])));
    await Promise.all(
      chosen.map(async (id) => {
        const result = await paint(apiKey, id, prompt).catch(
          (failure: unknown): Result => ({ status: "failed", error: failure instanceof Error ? failure.message : "Failed" }),
        );
        setResults((current) => ({ ...current, [id]: result }));
      }),
    );
  }

  return (
    <main className="shell page-shell artist-lab">
      <header className="masthead">
        <Link className="wordmark" href="/">The Room</Link>
        <nav className="header-nav" aria-label="Lab">
          <span className="header-link">Artist lab · experiment</span>
          <KeyControl apiKey={apiKey} models={[]} onChange={setApiKey} />
        </nav>
      </header>

      <section className="lab-controls">
        <h1>Which artist feels right?</h1>
        <p>The same line, painted by fast image models side by side, with the time and cost of each.</p>
        <label htmlFor="lab-line">What was said</label>
        <textarea id="lab-line" onChange={(event) => setLine(event.target.value)} rows={2} value={line} />
        <div className="lab-row" role="group" aria-label="Style">
          {(Object.keys(STYLES) as (keyof typeof STYLES)[]).map((key) => (
            <button aria-pressed={style === key} className="pill-button" key={key} onClick={() => setStyle(key)} type="button">
              {key === "watercolor" ? "Watercolor" : key === "napkin" ? "Napkin pen" : "Brush & ink"}
            </button>
          ))}
        </div>
        <div className="lab-row" role="group" aria-label="Models">
          {MODELS.map((model) => (
            <label className="lab-model" key={model.id}>
              <input
                checked={chosen.includes(model.id)}
                onChange={(event) =>
                  setChosen((current) =>
                    event.target.checked ? [...current, model.id] : current.filter((id) => id !== model.id),
                  )
                }
                type="checkbox"
              />
              {model.name}
            </label>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button" disabled={!chosen.length} onClick={paintAll} type="button">
          Paint it
        </button>
      </section>

      <section className="lab-results" aria-live="polite">
        {MODELS.filter((model) => results[model.id]).map((model) => {
          const result = results[model.id];
          return (
            <figure className="lab-card" data-status={result.status} key={model.id}>
              <div className="lab-canvas">
                {result.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={`${model.name}'s painting of: ${line}`} src={result.src} />
                ) : (
                  <span>{result.status === "painting" ? "Painting…" : result.error}</span>
                )}
              </div>
              <figcaption>
                <strong>{model.name}</strong> <small>{model.by}</small>
                <span>
                  {result.seconds != null && `${result.seconds}s`}
                  {result.cost != null && ` · $${result.cost.toFixed(3)}`}
                </span>
              </figcaption>
            </figure>
          );
        })}
      </section>
    </main>
  );
}
