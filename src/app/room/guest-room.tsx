"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import InfoDialogs from "@/app/room/info-dialogs";
import KeyControl, { type KeyControlHandle } from "@/app/room/key-control";
import ModelPicker, { type ModelChoice } from "@/app/room/model-picker";
import PrintReport from "@/app/room/print-report";
import RoomScene, { type ScenePhase } from "@/app/room/room-scene";
import {
  ACCEPTED_FILES,
  addAttachment,
  estimateTokens,
  extractText,
  MAX_ATTACHMENT_CHARS,
} from "@/lib/attachments";
import {
  buildContributionPrompt,
  buildConversationPrompt,
  buildIndependentPrompt,
  buildSynthesisPrompt,
  DEFAULT_MODELS,
  isPass,
  MAX_QUESTION_LENGTH,
  MIN_MODELS,
  modelLabel,
  parseTurnMarkers,
  pickSynthesizer,
  requestCompletion,
  requestsAnotherRound,
  PARTING_OPTIONS,
  type Attachment,
  type CompletionMessage,
  type CompletionOptions,
  type GuestModel,
  type GuestRun,
  type GuestTurn,
  type LiveTurn,
} from "@/lib/guest-room";
import { buildMarkdown } from "@/lib/report";
import { buildPlaylist } from "@/lib/room-scene";

const ROTATION_KEY = "theroom.synthesisRotation";

const initialModels: ModelChoice[] = DEFAULT_MODELS.map((model) => ({ ...model, selected: true }));

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "The request failed. Check your connection and model configuration.";
}

function readRotation() {
  try {
    return Number(window.localStorage.getItem(ROTATION_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeRotation(value: number) {
  try {
    window.localStorage.setItem(ROTATION_KEY, String(value));
  } catch {
    // Without storage the rotation simply restarts each visit.
  }
}

function colorOf(model: GuestModel) {
  return model.color ?? "var(--ink-soft)";
}

export default function GuestRoom() {
  const [question, setQuestion] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(initialModels);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reading, setReading] = useState<string[]>([]);
  const [run, setRun] = useState<GuestRun | null>(null);
  const [runSeats, setRunSeats] = useState<GuestModel[]>([]);
  const [liveStage, setLiveStage] = useState<{ name: string; turns: LiveTurn[] } | null>(null);
  const [liveSynthesis, setLiveSynthesis] = useState<LiveTurn | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [controller, setController] = useState<AbortController | null>(null);
  const [phase, setPhase] = useState<ScenePhase>("idle");
  const [stageVisible, setStageVisible] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const keyControlRef = useRef<KeyControlHandle>(null);

  const seated = useMemo(() => models.filter((model) => model.selected), [models]);
  const playlist = useMemo(() => (run ? buildPlaylist(run) : []), [run]);
  const attachedChars = attachments.reduce((total, item) => total + item.text.length, 0);

  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setStageVisible(entry.isIntersecting), {
      threshold: 0.25,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [run?.createdAt]);

  async function attachFiles(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    let next = attachments;
    for (const file of Array.from(files)) {
      setReading((current) => [...current, file.name]);
      try {
        const text = await extractText(file);
        next = addAttachment(next, file.name, text);
        setAttachments(next);
      } catch (fileError) {
        setError(getErrorMessage(fileError));
      } finally {
        setReading((current) => current.filter((name) => name !== file.name));
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function runStage(
    name: string,
    entries: Array<{ model: GuestModel; messages: CompletionMessage[] }>,
    activeController: AbortController,
    options?: CompletionOptions,
  ): Promise<{ turns: GuestTurn[]; errors: string[] }> {
    setStatus(`${name}…`);
    setLiveStage({
      name,
      turns: entries.map(({ model }) => ({ model, status: "thinking", text: "" })),
    });
    const patch = (id: string, change: (turn: LiveTurn) => LiveTurn) =>
      setLiveStage((current) =>
        current
          ? { ...current, turns: current.turns.map((turn) => (turn.model.id === id ? change(turn) : turn)) }
          : current,
      );
    const results = await Promise.all(
      entries.map(async ({ model, messages }) => {
        try {
          const turn = await requestCompletion(
            apiKey,
            model,
            messages,
            activeController.signal,
            (delta) => patch(model.id, (live) => ({ ...live, status: "answering", text: live.text + delta })),
            options,
          );
          const { text, volunteered, keyPhrase } = parseTurnMarkers(turn.text);
          patch(model.id, (live) => ({ ...live, model: turn.servedModel ?? turn.model, status: "complete", text }));
          return { ...turn, text, volunteered, keyPhrase } as GuestTurn;
        } catch (stageError) {
          const message = getErrorMessage(stageError);
          patch(model.id, (live) => ({
            ...live,
            status: activeController.signal.aborted ? "stopped" : "failed",
            error: message,
          }));
          if (activeController.signal.aborted) return null;
          return { model, error: message } as const;
        }
      }),
    );
    setLiveStage(null);
    return {
      turns: results.filter((item): item is GuestTurn => !!item && "text" in item),
      errors: results
        .filter((item): item is { model: GuestModel; error: string } => !!item && "error" in item)
        .map((item) => `${name} · ${item.model.label}: ${item.error}`),
    };
  }

  async function synthesize(
    currentRun: GuestRun,
    synthesizer: GuestModel,
    allowAnotherRound: boolean,
    activeController: AbortController,
  ) {
    setStatus(`${synthesizer.label} is writing the synthesis…`);
    setLiveSynthesis({ model: synthesizer, status: "thinking", text: "" });
    try {
      const turn = await requestCompletion(
        apiKey,
        synthesizer,
        buildSynthesisPrompt(currentRun, allowAnotherRound),
        activeController.signal,
        (delta) =>
          setLiveSynthesis((current) =>
            current ? { ...current, status: "answering", text: current.text + delta } : current,
          ),
      );
      setLiveSynthesis(null);
      if (requestsAnotherRound(turn.text)) return turn;
      const { text, keyPhrase } = parseTurnMarkers(turn.text);
      return { ...turn, text, keyPhrase };
    } catch (synthesisError) {
      setLiveSynthesis(null);
      if (!activeController.signal.aborted) {
        currentRun.errors.push(`Synthesis · ${synthesizer.label}: ${getErrorMessage(synthesisError)}`);
      }
      return null;
    }
  }

  async function startRun() {
    const cleanQuestion = question.trim();
    if (!apiKey.trim()) {
      setError("Add your OpenRouter key first (top right). It stays in this browser.");
      keyControlRef.current?.open();
      return;
    }
    if (cleanQuestion.length < 5 || cleanQuestion.length > MAX_QUESTION_LENGTH) {
      setError(`Enter a question between 5 and ${MAX_QUESTION_LENGTH} characters.`);
      return;
    }
    if (seated.length < MIN_MODELS) {
      setError(`Seat at least ${MIN_MODELS} models so there is a room to talk in.`);
      return;
    }

    setRunSeats(seated);
    setPhase("writing");
    const activeController = new AbortController();
    const startedAt = performance.now();
    setController(activeController);
    setRunning(true);
    setError("");
    setElapsed(null);
    setLiveStage(null);
    setLiveSynthesis(null);
    const currentRun: GuestRun = {
      question: cleanQuestion,
      attachments,
      createdAt: new Date().toISOString(),
      rounds: [],
      synthesis: null,
      contributions: [],
      errors: [],
    };
    const publish = () =>
      setRun({
        ...currentRun,
        rounds: [...currentRun.rounds],
        contributions: [...currentRun.contributions],
        errors: [...currentRun.errors],
      });
    publish();
    const stopped = () => {
      if (!activeController.signal.aborted) return false;
      setStatus("Stopped.");
      return true;
    };

    const conversationRound = async (name: string) => {
      const entries = currentRun.rounds.at(-1)!.turns.flatMap(({ model }) => {
        const messages = buildConversationPrompt(cleanQuestion, attachments, model, currentRun.rounds);
        return messages ? [{ model, messages }] : [];
      });
      const result = await runStage(name, entries, activeController);
      currentRun.errors.push(...result.errors);
      if (result.turns.length) currentRun.rounds.push({ name, turns: result.turns });
      publish();
    };

    try {
      const independent = await runStage(
        "Independent",
        seated.map((model) => ({ model, messages: buildIndependentPrompt(cleanQuestion, attachments) })),
        activeController,
      );
      currentRun.errors.push(...independent.errors);
      if (independent.turns.length) currentRun.rounds.push({ name: "Independent", turns: independent.turns });
      publish();
      // A short breath between the blind round and the conversation; the next round is
      // already being written while the room "reads".
      setPhase("interlude");
      setTimeout(() => setPhase((current) => (current === "interlude" ? "speaking" : current)), 4000);
      if (stopped()) return;
      if (!independent.turns.length) {
        setPhase("speaking");
        setError("No model answered, so the room can't continue.");
        setStatus("Discussion ended early.");
        return;
      }

      if (independent.turns.length >= MIN_MODELS) {
        await conversationRound("The conversation");
        if (stopped()) return;
      }

      const rotation = readRotation();
      writeRotation(rotation + 1);
      const synthesizer = pickSynthesizer(currentRun.rounds.at(-1)!.turns, rotation)!;
      let synthesis = await synthesize(currentRun, synthesizer, true, activeController);
      if (stopped()) return;
      if (synthesis && requestsAnotherRound(synthesis.text) && currentRun.rounds.at(-1)!.turns.length >= MIN_MODELS) {
        await conversationRound("One more exchange");
        if (stopped()) return;
        synthesis = await synthesize(currentRun, synthesizer, false, activeController);
        if (stopped()) return;
      }
      if (synthesis && requestsAnotherRound(synthesis.text)) {
        currentRun.errors.push("The synthesizer asked for more discussion and wrote no conclusion.");
        synthesis = null;
      }
      currentRun.synthesis = synthesis;
      publish();

      if (synthesis) {
        const entries = currentRun.rounds.at(-1)!.turns
          .filter(({ model }) => model.id !== synthesizer.id)
          .flatMap(({ model }) => {
            const messages = buildContributionPrompt(currentRun, model, synthesis);
            return messages ? [{ model, messages }] : [];
          });
        if (entries.length) {
          const parting = await runStage("Parting thoughts", entries, activeController, PARTING_OPTIONS);
          currentRun.errors.push(...parting.errors);
          currentRun.contributions = parting.turns.filter((turn) => !isPass(turn.text));
          publish();
        }
      }
      setStatus(activeController.signal.aborted ? "Stopped." : "The room has spoken.");
    } finally {
      setElapsed(Math.round((performance.now() - startedAt) / 1000));
      setRunning(false);
      setController(null);
    }
  }

  function newQuestion() {
    setRun(null);
    setPhase("idle");
    setStatus("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function downloadMarkdown() {
    if (!run) return;
    const blob = new Blob([buildMarkdown(run)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "the-room.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const allTurns = run
    ? [...run.rounds.flatMap((round) => round.turns), ...(run.synthesis ? [run.synthesis] : []), ...run.contributions]
    : [];
  const totalTokens = allTurns.reduce((total, turn) => total + (turn.usage?.total_tokens ?? 0), 0);
  const totalCost = allTurns.reduce((total, turn) => total + (turn.usage?.cost ?? 0), 0);

  return (
    <>
      <header className="masthead room-masthead">
        <Link className="wordmark" href="/">The Room</Link>
        <nav className="header-nav" aria-label="About this room">
          <InfoDialogs />
          <KeyControl apiKey={apiKey} models={seated} onChange={setApiKey} ref={keyControlRef} />
          <Link className="header-link" href="/login">Sign in</Link>
        </nav>
      </header>

      <h1 className="room-title">What shall we discuss?</h1>

      <RoomScene
        apiKey={apiKey}
        finished={!running}
        items={playlist}
        key={run?.createdAt ?? "idle"}
        live={liveStage?.turns ?? (liveSynthesis ? [liveSynthesis] : [])}
        phase={phase}
        question={run?.question}
        seats={run ? runSeats : seated}
        stageRef={stageRef}
      >
        <div className="guest-composer">
          <div className="composer-box">
            <textarea
              aria-label="Your question"
              maxLength={MAX_QUESTION_LENGTH}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="A question, a decision, a draft, a problem worth more than one opinion…"
              rows={4}
              value={question}
            />
            {(!!attachments.length || !!reading.length) && (
              <ul className="attachment-list" aria-label="Attached files">
                {attachments.map((item) => (
                  <li key={item.name}>
                    <span>{item.name}</span>
                    <small>
                      ~{estimateTokens(item.text.length).toLocaleString()} tokens
                      {item.truncated ? " · trimmed to fit" : ""}
                    </small>
                    <button
                      aria-label={`Remove ${item.name}`}
                      disabled={running}
                      onClick={() => setAttachments((current) => current.filter((other) => other !== item))}
                      type="button"
                    >
                      ×
                    </button>
                  </li>
                ))}
                {reading.map((name) => (
                  <li key={`reading-${name}`} data-reading="true"><span>Reading {name}…</span></li>
                ))}
              </ul>
            )}
            <div className="composer-bar">
              <button
                aria-label="Attach documents or files"
                className="composer-plus"
                disabled={running || attachedChars >= MAX_ATTACHMENT_CHARS}
                onClick={() => fileInputRef.current?.click()}
                title="Attach documents (PDF, Word, text, code)"
                type="button"
              >
                +
              </button>
              <input
                accept={ACCEPTED_FILES}
                hidden
                multiple
                onChange={(event) => attachFiles(event.target.files)}
                ref={fileInputRef}
                type="file"
              />
              <span className="guest-count">{question.length}/{MAX_QUESTION_LENGTH}</span>
            </div>
          </div>
          {!!attachments.length && (
            <p className="guest-help">
              Files are read here in your browser. Each seated model reads them in every turn, so
              about {(estimateTokens(attachedChars) * seated.length * 3).toLocaleString()} extra
              input tokens for this run.
            </p>
          )}

          <ModelPicker disabled={running} models={models} onChange={setModels} />

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="guest-actions">
            <button className="button" disabled={running} onClick={startRun} type="button">
              Ask the room
            </button>
          </div>
        </div>
      </RoomScene>

      {run && !stageVisible && (
        <button
          className="prompt-card"
          onClick={() => stageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
          type="button"
        >
          <small>The question</small>
          <span>{run.question}</span>
        </button>
      )}

      {run && (
        <section className="guest-results" aria-label="Discussion" aria-live="polite">
          <div className="guest-run-bar">
            <p className="eyebrow guest-status">{status}</p>
            {running ? (
              <button className="quiet-link guest-stop" onClick={() => controller?.abort()} type="button">
                Stop
              </button>
            ) : (
              <button className="pill-button" onClick={newQuestion} type="button">
                Ask a new question
              </button>
            )}
          </div>

          <h2 className="transcript-heading">The written record</h2>

          {run?.rounds.map((round, index) => (
            <section className="guest-round" key={`${round.name}-${index}`}>
              <h3>{String(index + 1).padStart(2, "0")} · {round.name}</h3>
              {round.turns.map((turn) => (
                <article
                  className="guest-turn"
                  key={turn.model.id}
                  style={{ borderLeftColor: colorOf(turn.servedModel ?? turn.model) }}
                >
                  <div className="guest-turn-header">
                    <strong style={{ color: colorOf(turn.model) }}>
                      {modelLabel(turn)}
                      {turn.servedModel && <small> (standing in for {turn.model.label})</small>}
                    </strong>
                    <span>{turn.latency}s</span>
                  </div>
                  <p>{turn.text}</p>
                </article>
              ))}
            </section>
          ))}

          {run?.synthesis && (
            <section className="guest-synthesis">
              <p className="eyebrow">What the room discovered</p>
              <p>{run.synthesis.text}</p>
              <small>Synthesis by {modelLabel(run.synthesis)}</small>
              {!!run.contributions.length && (
                <div className="contributions">
                  <p className="contributions-title">Parting thoughts from inside the room</p>
                  <ol>
                    {run.contributions.map((turn) => (
                      <li key={turn.model.id}>
                        <strong style={{ color: colorOf(turn.servedModel ?? turn.model) }}>
                          {modelLabel(turn)}
                        </strong>{" "}
                        {turn.text}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </section>
          )}

          {!!run?.errors.length && (
            <section className="guest-errors" aria-label="Requests that did not complete">
              <h3>Some requests did not complete</h3>
              <ul>
                {run.errors.map((runError, index) => <li key={index}>{runError}</li>)}
              </ul>
            </section>
          )}

          {!running && (
            <>
              <p className="guest-usage">
                {allTurns.length} answers · {totalTokens.toLocaleString()} tokens reported
                {totalCost > 0 ? ` · about $${totalCost.toFixed(3)}` : ""}
                {elapsed !== null ? ` · ${elapsed}s` : ""}. Not every provider reports cost.
              </p>
              <div className="guest-actions">
                <button className="button" onClick={() => window.print()} type="button">
                  Save the report (PDF)
                </button>
                <button className="pill-button" onClick={downloadMarkdown} type="button">
                  Markdown
                </button>
              </div>
              <p className="guest-help">
                Guest conversations aren&apos;t saved to an account yet. Save the report to keep this one.
              </p>
              <PrintReport run={run} />
            </>
          )}
        </section>
      )}
    </>
  );
}
