"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildCritiquePrompt,
  buildIndependentPrompt,
  buildSynthesisPrompt,
  DEFAULT_MODELS,
  MAX_MODELS,
  MAX_QUESTION_LENGTH,
  requestCompletion,
  type GuestModel,
  type GuestRun,
  type GuestRound,
  type GuestTurn,
  type LiveTurn,
} from "@/lib/guest-room";

type ModelChoice = GuestModel & { selected: boolean };
type Mode = "quick" | "deliberate";

const initialModels: ModelChoice[] = DEFAULT_MODELS.map((model, index) => ({
  ...model,
  selected: index < 5,
}));

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "The request failed. Check your connection and model configuration.";
}

function turnList(turns: GuestTurn[]) {
  return turns.map((turn) => {
    const responder = turn.servedModel ?? turn.model;
    return {
      model: responder.label,
      modelId: responder.id,
      seatModel: turn.model.label,
      seatModelId: turn.model.id,
      text: turn.text,
      latencySeconds: turn.latency,
      usage: turn.usage,
    };
  });
}

export default function GuestRoom() {
  const [question, setQuestion] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(initialModels);
  const [mode, setMode] = useState<Mode>("quick");
  const [run, setRun] = useState<GuestRun | null>(null);
  const [liveStage, setLiveStage] = useState<{ name: string; turns: LiveTurn[] } | null>(
    null,
  );
  const [liveSynthesis, setLiveSynthesis] = useState<LiveTurn | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [controller, setController] = useState<AbortController | null>(null);

  const selectedModels = useMemo(
    () => models.filter((model) => model.selected),
    [models],
  );

  function toggleModel(id: string) {
    setModels((current) => {
      const selectedCount = current.filter((model) => model.selected).length;
      return current.map((model) =>
        model.label === id
          ? { ...model, selected: !model.selected || selectedCount > 2 }
          : model,
      );
    });
  }

  function updateModelId(index: number, id: string) {
    setModels((current) =>
      current.map((model, modelIndex) =>
        modelIndex === index ? { ...model, id } : model,
      ),
    );
  }

  async function runStage(
    name: string,
    activeModels: GuestModel[],
    promptFor: (model: GuestModel) => Parameters<typeof requestCompletion>[2],
    activeController: AbortController,
  ): Promise<{ round: GuestRound; errors: string[] }> {
    setStatus(`${name}: asking ${activeModels.length} models…`);
    setLiveStage({
      name,
      turns: activeModels.map((model) => ({ model, status: "thinking", text: "" })),
    });
    const results = await Promise.all(
      activeModels.map(async (model) => {
        try {
          const turn = await requestCompletion(
            apiKey,
            model,
            promptFor(model),
            activeController.signal,
            (delta) => {
              setLiveStage((current) =>
                current
                  ? {
                      ...current,
                      turns: current.turns.map((liveTurn) =>
                        liveTurn.model.id === model.id
                          ? {
                              ...liveTurn,
                              status: "answering",
                              text: liveTurn.text + delta,
                            }
                          : liveTurn,
                      ),
                    }
                  : current,
              );
            },
          );
          setLiveStage((current) =>
            current
              ? {
                  ...current,
                  turns: current.turns.map((liveTurn) =>
                    liveTurn.model.id === model.id
                      ? {
                          ...liveTurn,
                          model: turn.servedModel ?? turn.model,
                          status: "complete",
                          text: turn.text,
                        }
                      : liveTurn,
                  ),
                }
              : current,
          );
          return turn;
        } catch (stageError) {
          const message = getErrorMessage(stageError);
          setLiveStage((current) =>
            current
              ? {
                  ...current,
                  turns: current.turns.map((liveTurn) =>
                    liveTurn.model.id === model.id
                      ? {
                          ...liveTurn,
                          status: activeController.signal.aborted ? "stopped" : "failed",
                          error: message,
                        }
                      : liveTurn,
                  ),
                }
              : current,
          );
          if (activeController.signal.aborted) return null;
          return { model, error: message } as const;
        }
      }),
    );
    const turns = results.filter((item): item is GuestTurn => !!item && "text" in item);
    const errors = results
      .filter(
        (item): item is { model: GuestModel; error: string } =>
          !!item && "error" in item,
      )
      .map((item) => `${item.model.label}: ${item.error}`);
    setLiveStage(null);
    return { round: { name, turns }, errors };
  }

  async function startRun() {
    const cleanQuestion = question.trim();
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      setError("Add your OpenRouter API key to start. It stays in this browser tab.");
      return;
    }
    if (cleanQuestion.length < 5 || cleanQuestion.length > MAX_QUESTION_LENGTH) {
      setError(`Enter a question between 5 and ${MAX_QUESTION_LENGTH} characters.`);
      return;
    }
    if (selectedModels.length < 2) {
      setError("Choose at least two models so they have perspectives to compare.");
      return;
    }
    if (selectedModels.some((model) => !model.id.trim())) {
      setError("Each selected model needs an OpenRouter model ID.");
      return;
    }

    const activeController = new AbortController();
    setController(activeController);
    setRunning(true);
    setError("");
    setRun(null);
    setLiveStage(null);
    setLiveSynthesis(null);
    const currentRun: GuestRun = {
      question: cleanQuestion,
      createdAt: new Date().toISOString(),
      rounds: [],
      synthesis: null,
      errors: [],
    };
    setRun(currentRun);

    try {
      const independent = await runStage(
        "Independent answers",
        selectedModels,
        () => buildIndependentPrompt(cleanQuestion),
        activeController,
      );
      currentRun.rounds.push(independent.round);
      currentRun.errors.push(...independent.errors);
      setRun({ ...currentRun, rounds: [...currentRun.rounds], errors: [...currentRun.errors] });

      if (activeController.signal.aborted) {
        setStatus("Stopped.");
        return;
      }
      if (independent.round.turns.length < 2) {
        setError("Fewer than two models answered. There is not enough discussion to continue.");
        setStatus("Discussion ended early.");
        return;
      }

      if (mode === "deliberate") {
        const critique = await runStage(
          "Comparing perspectives",
          independent.round.turns.map((turn) => turn.model),
          (model) =>
            buildCritiquePrompt(
              cleanQuestion,
              model,
              independent.round.turns.filter((turn) => turn.model.id !== model.id),
            ),
          activeController,
        );
        currentRun.rounds.push(critique.round);
        currentRun.errors.push(...critique.errors);
        setRun({ ...currentRun, rounds: [...currentRun.rounds], errors: [...currentRun.errors] });
        if (activeController.signal.aborted) {
          setStatus("Stopped.");
          return;
        }
      }

      const participants = currentRun.rounds.flatMap((round) => round.turns);
      if (!participants.length) {
        setError("No model answers were completed, so there is nothing to synthesize.");
        setStatus("Discussion ended early.");
        return;
      }
      setStatus("Building the synthesis…");
      const synthesizer = independent.round.turns[0]?.model ?? selectedModels[0];
      setLiveSynthesis({ model: synthesizer, status: "thinking", text: "" });
      try {
        currentRun.synthesis = await requestCompletion(
          cleanKey,
          synthesizer,
          buildSynthesisPrompt(currentRun),
          activeController.signal,
          (delta) => {
            setLiveSynthesis((current) =>
              current
                ? {
                    ...current,
                    status: "answering",
                    text: current.text + delta,
                  }
                : current,
            );
          },
        );
        setLiveSynthesis({
          model: synthesizer,
          status: "complete",
          text: currentRun.synthesis.text,
        });
      } catch (synthesisError) {
        setLiveSynthesis({
          model: synthesizer,
          status: activeController.signal.aborted ? "stopped" : "failed",
          text: "",
          error: getErrorMessage(synthesisError),
        });
        if (!activeController.signal.aborted) {
          currentRun.errors.push(`Synthesis: ${getErrorMessage(synthesisError)}`);
        }
      }
      setRun({
        ...currentRun,
        rounds: [...currentRun.rounds],
        errors: [...currentRun.errors],
      });
      setLiveSynthesis(null);
      setStatus(activeController.signal.aborted ? "Stopped." : "Discussion complete.");
    } finally {
      setRunning(false);
      setController(null);
    }
  }

  function downloadTranscript() {
    if (!run) return;
    const transcript = {
      product: "The Room",
      privacy: "Guest run; this file was generated in your browser.",
      ...run,
      rounds: run.rounds.map((round) => ({
        name: round.name,
        turns: turnList(round.turns),
      })),
      synthesis: run.synthesis
        ? {
            model: run.synthesis.model.label,
            modelId: run.synthesis.model.id,
            text: run.synthesis.text,
            latencySeconds: run.synthesis.latency,
            usage: run.synthesis.usage,
          }
        : null,
    };
    const blob = new Blob([JSON.stringify(transcript, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "the-room-conversation.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const totalTokens = run
    ? [...run.rounds.flatMap((round) => round.turns), ...(run.synthesis ? [run.synthesis] : [])]
        .reduce((total, turn) => total + (turn.usage?.total_tokens ?? 0), 0)
    : 0;

  return (
    <>
      <section className="page-heading guest-heading">
        <div>
          <p className="eyebrow">A guest session</p>
          <h1>Bring a question into the room.</h1>
          <p className="muted">
            Models answer independently, compare perspectives, and leave you with
            a synthesis. You can begin without creating an account.
          </p>
        </div>
      </section>

      <section className="guest-composer" aria-label="Start a discussion">
        <label className="field" htmlFor="guest-question">
          What would you like the room to think about?
          <textarea
            id="guest-question"
            maxLength={MAX_QUESTION_LENGTH}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="A question, a decision, a draft, or a problem worth more than one perspective…"
            rows={4}
            value={question}
          />
        </label>
        <p className="guest-count">{question.length}/{MAX_QUESTION_LENGTH}</p>

        <label className="field" htmlFor="openrouter-key">
          OpenRouter API key
          <input
            autoComplete="off"
            id="openrouter-key"
            onChange={(event) => setApiKey(event.target.value)}
            spellCheck={false}
            type="password"
            value={apiKey}
          />
        </label>
        <p className="guest-help">
          The key is held only in this page&apos;s memory and sent directly to{" "}
          <a href="https://openrouter.ai/keys" rel="noreferrer" target="_blank">
            OpenRouter
          </a>
          . The Room&apos;s server does not receive it. OpenRouter and the selected
          model providers process your prompt; usage is billed to your OpenRouter
          account. Requests require Zero Data Retention (ZDR) endpoints. For
          routing/provider errors such as an outage or rate limit, OpenRouter may
          retry with GLM-5.3 Flash using the same ZDR requirement; the transcript
          identifies the model that actually answered. ZDR does not cover every
          downstream tool or provider&apos;s data practices.
        </p>

        <fieldset className="guest-models">
          <legend className="field">Choose the participants (2–5)</legend>
          <div className="guest-model-list">
            {models.map((model, index) => (
              <div className="guest-model" key={model.label}>
                <label>
                  <input
                    checked={model.selected}
                    disabled={model.selected && selectedModels.length <= 2}
                    onChange={() => toggleModel(model.label)}
                    type="checkbox"
                  />
                  <span>{model.label}</span>
                  <small>{model.vendor}</small>
                </label>
                {model.selected && (
                  <input
                    aria-label={`${model.label} OpenRouter model ID`}
                    autoComplete="off"
                    onChange={(event) => updateModelId(index, event.target.value)}
                    spellCheck={false}
                    value={model.id}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="guest-help">
            These are TheRoom&apos;s default OpenRouter model IDs. Edit them if
            needed; OpenRouter&apos;s current catalog is at{" "}
            <a href="https://openrouter.ai/models" rel="noreferrer" target="_blank">
              openrouter.ai/models
            </a>
            .
          </p>
        </fieldset>

        <fieldset className="guest-modes">
          <legend className="field">How long should the room talk?</legend>
          <label>
            <input
              checked={mode === "quick"}
              onChange={() => setMode("quick")}
              type="radio"
              value="quick"
            />
            Quick <span>Independent answers + synthesis</span>
          </label>
          <label>
            <input
              checked={mode === "deliberate"}
              onChange={() => setMode("deliberate")}
              type="radio"
              value="deliberate"
            />
            Deliberate <span>Answers + one critique round + synthesis</span>
          </label>
        </fieldset>
        <p className="guest-help">
          Each selected model makes one request in Quick or two in Deliberate.
          Synthesis makes one additional request. Provider charges vary by model
          and response length.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="guest-actions">
          <button
            className="button"
            disabled={running || selectedModels.length > MAX_MODELS}
            onClick={startRun}
            type="button"
          >
            {running ? "The room is thinking…" : "Ask the room"}
          </button>
          {running && (
            <button
              className="quiet-link guest-stop"
              onClick={() => controller?.abort()}
              type="button"
            >
              Stop
            </button>
          )}
        </div>
      </section>

      {(running || run) && (
        <section className="guest-results" aria-label="Discussion results" aria-live="polite">
          <div className="guest-status">
            <p className="eyebrow">{status}</p>
            {run && (
              <h2>{run.question}</h2>
            )}
          </div>
          {liveStage && (
            <section className="guest-live-stage" aria-label={`${liveStage.name} live progress`}>
              <div className="guest-live-heading">
                <span className="live-indicator" aria-hidden="true" />
                <div>
                  <h3>{liveStage.name}</h3>
                  <p>
                    {liveStage.name === "Independent answers"
                      ? "Each model is answering on its own, without seeing the others."
                      : "Now each model can respond to the other participants' answers."}
                  </p>
                </div>
              </div>
              <div className="guest-live-grid">
                {liveStage.turns.map((turn) => (
                  <article
                    className="guest-live-seat"
                    data-state={turn.status}
                    key={turn.model.id}
                  >
                    <div className="guest-turn-header">
                      <strong>{turn.model.label}</strong>
                      <span>
                        {turn.status === "thinking"
                          ? "Thinking"
                          : turn.status === "answering"
                            ? "Answering"
                            : turn.status === "complete"
                              ? "Complete"
                              : turn.status === "stopped"
                                ? "Stopped"
                                : "Could not answer"}
                      </span>
                    </div>
                    <p>{turn.text || (turn.status === "thinking" ? "Gathering a perspective…" : "")}</p>
                    {turn.error && <small>{turn.error}</small>}
                  </article>
                ))}
              </div>
            </section>
          )}
          {run?.rounds.map((round, index) => (
            <section className="guest-round" key={`${round.name}-${index}`}>
              <h3>{String(index + 1).padStart(2, "0")} · {round.name}</h3>
              {round.turns.map((turn) => (
                <article className="guest-turn" key={`${round.name}-${turn.model.id}`}>
                  <div className="guest-turn-header">
                    <strong>{turn.model.label}</strong>
                    <span>
                      {turn.latency}s
                      {turn.usage?.total_tokens
                        ? ` · ${turn.usage.total_tokens.toLocaleString()} tokens`
                        : ""}
                    </span>
                  </div>
                  <p>{turn.text}</p>
                </article>
              ))}
              {!round.turns.length && (
                <p className="muted">No participant completed this round.</p>
              )}
            </section>
          ))}
          {liveSynthesis && (
            <section className="guest-live-stage guest-live-synthesis">
              <div className="guest-live-heading">
                <span className="live-indicator" aria-hidden="true" />
                <div>
                  <h3>Connecting the perspectives</h3>
                  <p>
                    {liveSynthesis.model.label} is reading the discussion and
                    drawing out what holds together, what differs, and what remains open.
                  </p>
                </div>
              </div>
              <article className="guest-live-seat" data-state={liveSynthesis.status}>
                <div className="guest-turn-header">
                  <strong>{liveSynthesis.model.label}</strong>
                  <span>
                    {liveSynthesis.status === "thinking"
                      ? "Reading the discussion"
                      : liveSynthesis.status === "answering"
                        ? "Writing the synthesis"
                        : liveSynthesis.status === "complete"
                          ? "Complete"
                          : liveSynthesis.status === "stopped"
                            ? "Stopped"
                            : "Could not finish"}
                  </span>
                </div>
                <p>
                  {liveSynthesis.text ||
                    (liveSynthesis.status === "thinking" ? "Finding the thread…" : "")}
                </p>
                {liveSynthesis.error && <small>{liveSynthesis.error}</small>}
              </article>
            </section>
          )}
          {run?.synthesis && (
            <section className="guest-synthesis">
              <p className="eyebrow">The strongest answer the room can support</p>
              <p>{run.synthesis.text}</p>
              <small>
                Synthesized by {run.synthesis.model.label} · {run.synthesis.latency}s
              </small>
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
          {run && !running && (
            <>
              <p className="guest-usage">
                {totalTokens.toLocaleString()} reported tokens. Provider costs vary
                and may not be reported for every model.
              </p>
              <div className="guest-actions">
                <button className="button" onClick={downloadTranscript} type="button">
                  Download conversation
                </button>
                <Link className="text-link" href="/login">
                  Sign in to explore workspaces
                </Link>
              </div>
              <p className="guest-help">
                Guest conversations are not saved to your account yet. Download
                this copy to keep it; account-based saving is not available in
                this first guest version.
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}
