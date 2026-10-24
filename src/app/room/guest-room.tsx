"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InfoDialogs from "@/app/room/info-dialogs";
import KeyControl, { type KeyControlHandle } from "@/app/room/key-control";
import ModelPicker, { type ModelChoice } from "@/app/room/model-picker";
import RoomScorecard from "@/app/room/scorecard";
import PrintReport from "@/app/room/print-report";
import RoomScene, { type ScenePhase } from "@/app/room/room-scene";
import SceneGuard from "@/app/room/scene-guard";
import {
  ACCEPTED_FILES,
  addAttachment,
  estimateTokens,
  extractText,
  MAX_ATTACHMENT_CHARS,
} from "@/lib/attachments";
import {
  buildFloorTurnPrompt,
  buildInterjectionPrompt,
  buildListenPrompt,
  buildPartingPrompt,
  buildReplyPrompt,
  askedSeat,
  EXTRA_FLOOR_TURNS,
  MAX_BREAKS,
  MAX_FLOOR_TURNS,
  parseListen,
  pickNextSpeaker,
  spokenText,
  type FloorContext,
} from "@/lib/floor";
import {
  assignNicknames,
  buildChasePrompt,
  buildIndependentPrompt,
  buildSynthesisPrompt,
  CHASE,
  DEFAULT_MODELS,
  isPass,
  MAX_QUESTION_LENGTH,
  MIN_MODELS,
  modelLabel,
  parseChase,
  parseTurnMarkers,
  PERSON,
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
  type Hand,
  type LiveTurn,
} from "@/lib/guest-room";
import {
  buildJudgePrompt,
  buildSoloPrompt,
  parseScorecard,
  pickJudge,
  readScoreHistory,
  recordScorecard,
  recordTap,
  type ScoreHistory,
  type TapId,
} from "@/lib/scorecard";
import { keyUsage } from "@/lib/openrouter-check";
import { buildMarkdown, sourceHref, sourceLabel } from "@/lib/report";
import { buildSharpenPrompt, parseSharpened, type Sharpened } from "@/lib/sharpen";
import { SPEECH_PRICE_PER_CHARACTER } from "@/lib/speech-audio";
import { buildPlaylist, splitSentences } from "@/lib/room-scene";

const CONVERSATION = "The conversation";
const MAX_PERSON_LENGTH = 600;

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

/** Marks a turn where the outside judge found the room discovered something; the point shows on hover. */
function DiscoveryChip({ point }: { point: string }) {
  return (
    <span className="discovery-chip" title={point}>
      ✦ Sparked a discovery
    </span>
  );
}

/** A turn's cited web addresses, listed in the written record. */
function Sources({ sources }: { sources: string[] }) {
  return (
    <p className="turn-sources">
      Sources:{" "}
      {sources.map((address, index) => (
        <span key={address}>
          {index > 0 && " · "}
          <a href={sourceHref(address)} rel="noreferrer" target="_blank">
            {sourceLabel(address)}
          </a>
        </span>
      ))}
    </p>
  );
}

function colorOf(model: GuestModel) {
  return model.color ?? "var(--ink-soft)";
}

export default function GuestRoom({ initialQuestion = "" }: { initialQuestion?: string }) {
  const [question, setQuestion] = useState(initialQuestion.slice(0, MAX_QUESTION_LENGTH));
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
  const [conversing, setConversing] = useState(false);
  const [personDraft, setPersonDraft] = useState("");
  const [personQueued, setPersonQueued] = useState(false);
  const pendingPersonRef = useRef<string | null>(null);
  const [voiceCharacters, setVoiceCharacters] = useState(0);
  // "Sharpen my question": the suggestion, and the person's own words to go back to.
  const [sharpening, setSharpening] = useState(false);
  const [history, setHistory] = useState<ScoreHistory>({ runs: [], sparks: {} });
  // The person's own answer to "did it change your mind?", for the current discussion.
  const [tap, setTap] = useState<TapId | null>(null);
  const [sharpened, setSharpened] = useState<(Sharpened & { original: string }) | null>(null);
  // What the key had spent when this discussion began, to read the exact charge afterwards.
  const usageAtStart = useRef<Promise<number | null> | null>(null);
  const [exactCharge, setExactCharge] = useState<string>("");
  const countSpeech = useCallback((characters: number) => setVoiceCharacters((total) => total + characters), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const keyControlRef = useRef<KeyControlHandle>(null);

  const seated = useMemo(() => models.filter((model) => model.selected), [models]);
  const seatedNames = useMemo(() => assignNicknames(seated), [seated]);
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
          const { text, volunteered, keyPhrase, sources } = parseTurnMarkers(turn.text);
          patch(model.id, (live) => ({ ...live, model: turn.servedModel ?? turn.model, status: "complete", text }));
          return { ...turn, text, volunteered, keyPhrase, ...(sources ? { sources } : {}) } as GuestTurn;
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
      const { text, keyPhrase, sources } = parseTurnMarkers(turn.text);
      return { ...turn, text, keyPhrase, ...(sources ? { sources } : {}) };
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

    const seats = assignNicknames(seated);
    setRunSeats(seats);
    setSharpened(null);
    setTap(null);
    setVoiceCharacters(0);
    setExactCharge("");
    usageAtStart.current = keyUsage(apiKey);
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
      hands: {},
      listening: { tokens: 0, cost: 0 },
    };
    const publish = () =>
      setRun({
        ...currentRun,
        rounds: currentRun.rounds.map((round) => ({ ...round, turns: round.turns.map((turn) => ({ ...turn })) })),
        contributions: [...currentRun.contributions],
        errors: [...currentRun.errors],
        hands: { ...currentRun.hands },
        listening: { ...currentRun.listening! },
        scorecard: currentRun.scorecard ? { ...currentRun.scorecard } : undefined,
      });
    publish();
    pendingPersonRef.current = null;
    setPersonQueued(false);
    const stopped = () => {
      if (!activeController.signal.aborted) return false;
      setStatus("Stopped.");
      return true;
    };

    /** One seat speaks: streamed into the live view, markers stripped. */
    const speak = async (
      model: GuestModel,
      messages: CompletionMessage[] | null,
      kind: NonNullable<GuestTurn["kind"]>,
      options?: CompletionOptions,
    ): Promise<GuestTurn | null> => {
      if (!messages) return null;
      setLiveStage({ name: CONVERSATION, turns: [{ model, status: "thinking", text: "" }] });
      try {
        const turn = await requestCompletion(
          apiKey,
          model,
          messages,
          activeController.signal,
          (delta) =>
            setLiveStage((current) =>
              current
                ? { ...current, turns: current.turns.map((live) => ({ ...live, status: "answering", text: live.text + delta })) }
                : current,
            ),
          options,
        );
        const { text, volunteered, keyPhrase, asks, sources } = parseTurnMarkers(turn.text);
        return {
          ...turn,
          text,
          volunteered,
          keyPhrase,
          asks,
          ...(sources ? { sources } : {}),
          kind,
          id: `c${Date.now().toString(36)}-${model.id}`,
        };
      } catch (turnError) {
        if (!activeController.signal.aborted) {
          currentRun.errors.push(`${CONVERSATION} · ${model.label}: ${getErrorMessage(turnError)}`);
        }
        return null;
      } finally {
        setLiveStage(null);
      }
    };

    /** Every listener genuinely decides, in parallel, whether it has something to add. */
    const listen = async (context: FloorContext, listeners: GuestModel[], canBreak: boolean) => {
      const hands: Hand[] = [];
      await Promise.all(
        listeners.map(async (model) => {
          const messages = buildListenPrompt(context, model, canBreak);
          if (!messages) return;
          try {
            const reply = await requestCompletion(apiKey, model, messages, activeController.signal, undefined, PARTING_OPTIONS);
            currentRun.listening!.tokens += reply.usage?.total_tokens ?? 0;
            currentRun.listening!.cost += reply.usage?.cost ?? 0;
            const hand = parseListen(model, reply.text, context.conversation.at(-1));
            if (hand) hands.push(hand);
          } catch {
            // A listener that couldn't be reached simply doesn't raise a hand.
          }
        }),
      );
      return hands;
    };

    /**
     * The conversation: one short turn at a time, the next speaker chosen from real raised
     * hands. It ends when nobody has anything new to add, or at the turn limit.
     */
    const floor = async (maxTurns: number, rotation: number) => {
      const blind = currentRun.rounds[0].turns;
      const seats = blind.map((turn) => turn.model);
      let round = currentRun.rounds.find((item) => item.name === CONVERSATION);
      if (!round) {
        round = { name: CONVERSATION, turns: [] };
        currentRun.rounds.push(round);
      }
      const conversation = round.turns;
      const context = (): FloorContext => ({ question: cleanQuestion, attachments, blind, conversation });
      const record = (turn: GuestTurn) => {
        conversation.push(turn);
        publish();
      };
      const others = (id?: string) => seats.filter((model) => model.id !== id);
      let breaks = conversation.filter((turn) => turn.kind === "interjection").length;

      setConversing(true);
      setStatus("The room is deciding who speaks first…");
      let hands = await listen(context(), others(conversation.at(-1)?.model.id), false);
      let taken = 0;
      let misses = 0;
      // A seat someone just put a direct question to answers next.
      let addressed: { model: GuestModel; by: string } | null = null;
      while (taken < maxTurns && misses < 3 && !activeController.signal.aborted) {
        const personText = pendingPersonRef.current;
        if (personText) {
          pendingPersonRef.current = null;
          setPersonQueued(false);
          const turn: GuestTurn = {
            model: PERSON,
            text: personText,
            latency: 0,
            usage: null,
            kind: "person",
            id: `p${Date.now().toString(36)}`,
          };
          record(turn);
          setStatus("The room is listening to you…");
          hands = await listen(context(), seats, false);
          currentRun.hands![turn.id!] = hands;
          publish();
          continue;
        }

        const last = conversation.at(-1);
        const askedBy = addressed?.by;
        const chosen = addressed
          ? { model: addressed.model, kind: "hand" as const, reason: "" }
          : (pickNextSpeaker(hands, conversation, last?.model.id) ??
            (conversation.length ? null : { model: seats[rotation % seats.length], kind: "hand" as const, reason: "" }));
        addressed = null;
        if (!chosen) break;
        setStatus(`${chosen.model.nickname ?? chosen.model.label} has the floor…`);
        const turn = await speak(
          chosen.model,
          buildFloorTurnPrompt(context(), chosen.model, chosen.reason || undefined, askedBy),
          "turn",
        );
        if (stopped()) return;
        hands = hands.filter((hand) => hand.model.id !== chosen.model.id);
        if (!turn || isPass(turn.text) || /^(i('|’)ll\s+)?pass\b/i.test(turn.text.trim())) {
          misses++;
          continue;
        }
        misses = 0;
        taken++;
        record({ ...turn, respondingTo: last ? (last.model.id === PERSON.id ? "you" : modelLabel(last)) : undefined });
        const spoken = conversation.at(-1)!;
        const asked = askedSeat(spoken, seats);
        if (asked) addressed = { model: asked, by: spoken.model.nickname ?? spoken.model.label };

        setStatus("The room is listening…");
        hands = await listen(context(), others(spoken.model.id), breaks < MAX_BREAKS);
        currentRun.hands![spoken.id!] = hands;
        publish();
        if (stopped()) return;

        const interrupter = breaks < MAX_BREAKS ? hands.find((hand) => hand.kind === "break") : undefined;
        if (interrupter?.atSentence == null) continue;
        breaks++;
        spoken.cutAt = interrupter.atSentence;
        publish();
        setStatus(`${interrupter.model.label} is breaking in…`);
        const interjection = await speak(
          interrupter.model,
          buildInterjectionPrompt(context(), interrupter.model, spoken, interrupter.reason),
          "interjection",
          PARTING_OPTIONS,
        );
        if (!interjection) {
          spoken.cutAt = undefined;
          publish();
          continue;
        }
        record({ ...interjection, respondingTo: modelLabel(spoken) });
        const reply = await speak(
          spoken.model,
          buildReplyPrompt(context(), spoken.model, spoken, conversation.at(-1)!),
          "reply",
        );
        if (reply) record({ ...reply, respondingTo: interrupter.model.label });
        if (stopped()) return;
        const latest = conversation.at(-1)!;
        setStatus("The room is listening…");
        hands = await listen(context(), others(latest.model.id), false);
        currentRun.hands![latest.id!] = hands;
        publish();
      }
    };

    try {
      const independent = await runStage(
        "Independent",
        seats.map((model) => ({ model, messages: buildIndependentPrompt(cleanQuestion, attachments) })),
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

      const rotation = readRotation();
      writeRotation(rotation + 1);
      const canTalk = independent.turns.length >= MIN_MODELS;
      if (canTalk) {
        // Chase cuts to the chase in one line, so the conversation starts from what most needs saying.
        setStatus("Chase is cutting to the chase…");
        const quip = await requestCompletion(
          apiKey,
          CHASE,
          buildChasePrompt(cleanQuestion, independent.turns),
          activeController.signal,
          undefined,
          PARTING_OPTIONS,
        ).catch(() => null);
        if (stopped()) return;
        const said = quip ? parseChase(quip.text) : null;
        if (quip && said) {
          currentRun.listening!.tokens += quip.usage?.total_tokens ?? 0;
          currentRun.listening!.cost += quip.usage?.cost ?? 0;
          currentRun.rounds.push({
            name: CONVERSATION,
            turns: [
              {
                model: CHASE,
                text: said.line,
                ...(said.brief ? { brief: said.brief } : {}),
                latency: quip.latency,
                usage: null,
                kind: "quip",
                id: `chase-${Date.now().toString(36)}`,
              },
            ],
          });
          publish();
        }
        await floor(MAX_FLOOR_TURNS, rotation);
        if (stopped()) return;
      }

      // The synthesizer reads what the room actually heard; a volunteer from any turn counts.
      const heard = () => ({
        ...currentRun,
        rounds: currentRun.rounds.map((round) => ({ ...round, turns: round.turns.map((turn) => ({ ...turn, text: spokenText(turn) })) })),
      });
      const blind = currentRun.rounds[0].turns;
      const candidates = blind.map((turn) => ({
        ...turn,
        volunteered: currentRun.rounds.some((round) =>
          round.turns.some((other) => other.model.id === turn.model.id && other.volunteered),
        ),
      }));
      const synthesizer = pickSynthesizer(candidates, rotation)!;
      setConversing(false);
      // The fair comparison for "did the room beat one model?": the synthesizer's model, alone.
      const solo = requestCompletion(
        apiKey,
        synthesizer,
        buildSoloPrompt(cleanQuestion, attachments),
        activeController.signal,
      ).then(
        (turn) => ({ ...turn, text: parseTurnMarkers(turn.text).text }),
        () => null,
      );
      let synthesis = await synthesize(heard(), synthesizer, true, activeController);
      if (stopped()) return;
      if (synthesis && requestsAnotherRound(synthesis.text) && canTalk) {
        await floor(EXTRA_FLOOR_TURNS, rotation + 1);
        setConversing(false);
        if (stopped()) return;
        synthesis = await synthesize(heard(), synthesizer, false, activeController);
        if (stopped()) return;
      }
      if (synthesis && requestsAnotherRound(synthesis.text)) {
        currentRun.errors.push("The synthesizer asked for more discussion and wrote no conclusion.");
        synthesis = null;
      }
      currentRun.synthesis = synthesis;
      publish();

      // A strong outside judge scores the room, blind to who said what, while the parting thoughts are written.
      const spokenTurns = currentRun.rounds.find((round) => round.name === CONVERSATION)?.turns ?? [];
      const judge = pickJudge(seats);
      const judging = synthesis
        ? (async () => {
            currentRun.judging = "pending";
            currentRun.judge = judge;
            publish();
            const alone = await solo;
            if (alone) {
              currentRun.solo = alone;
              currentRun.listening!.tokens += alone.usage?.total_tokens ?? 0;
              currentRun.listening!.cost += alone.usage?.cost ?? 0;
            }
            const roomFirst = Math.random() < 0.5;
            const reply = alone
              ? await requestCompletion(
                  apiKey,
                  judge,
                  buildJudgePrompt({
                    question: cleanQuestion,
                    seats,
                    blind,
                    conversation: spokenTurns,
                    roomAnswer: synthesis.text,
                    soloAnswer: alone.text,
                    roomFirst,
                  }),
                  activeController.signal,
                ).catch(() => null)
              : null;
            if (reply) {
              currentRun.listening!.tokens += reply.usage?.total_tokens ?? 0;
              currentRun.listening!.cost += reply.usage?.cost ?? 0;
            }
            const card = reply ? parseScorecard(reply.text, spokenTurns, roomFirst) : null;
            if (card) {
              currentRun.scorecard = card;
              currentRun.judging = "done";
              setHistory(recordScorecard(readScoreHistory(), currentRun.createdAt, seats, card));
            } else {
              // Without a judge the discussion still stands; the scorecard says it couldn't be scored.
              currentRun.judging = "failed";
            }
            publish();
          })()
        : Promise.resolve();

      if (synthesis) {
        const conversation = spokenTurns;
        const context: FloorContext = { question: cleanQuestion, attachments, blind, conversation };
        const entries = blind
          .filter(({ model }) => model.id !== synthesizer.id)
          .flatMap(({ model }) => {
            const messages = buildPartingPrompt(context, model, synthesis);
            return messages ? [{ model, messages }] : [];
          });
        if (entries.length) {
          const parting = await runStage("Parting thoughts", entries, activeController, PARTING_OPTIONS);
          currentRun.errors.push(...parting.errors);
          currentRun.contributions = parting.turns.filter((turn) => !isPass(turn.text));
          publish();
        }
      }
      await judging;
      setStatus(activeController.signal.aborted ? "Stopped." : "The room has spoken.");
    } finally {
      setElapsed(Math.round((performance.now() - startedAt) / 1000));
      setRunning(false);
      setConversing(false);
      setController(null);
    }
  }

  async function checkExactCharge() {
    setExactCharge("Asking OpenRouter…");
    const [before, now] = await Promise.all([usageAtStart.current, keyUsage(apiKey)]);
    if (before == null || now == null) {
      setExactCharge("OpenRouter didn't say. Your activity page at openrouter.ai has the full record.");
      return;
    }
    setExactCharge(
      `Charged to your key since this discussion began: $${Math.max(0, now - before).toFixed(4)}. ` +
        "OpenRouter can take a minute to record the last requests, and anything else using this key counts too.",
    );
  }

  async function sharpenQuestion() {
    const original = question.trim();
    if (!apiKey.trim()) {
      setError("Add your OpenRouter key first (top right) to sharpen a question.");
      keyControlRef.current?.open();
      return;
    }
    if (original.length < 5) {
      setError("Write your question first, then sharpen it.");
      return;
    }
    setError("");
    setSharpening(true);
    try {
      const helper = seated[0] ?? DEFAULT_MODELS[0];
      const reply = await requestCompletion(
        apiKey,
        helper,
        buildSharpenPrompt(original),
        new AbortController().signal,
        undefined,
        PARTING_OPTIONS,
      );
      const result = parseSharpened(reply.text);
      if (!result) {
        setError("That one didn't come back clearly. Try sharpening again.");
        return;
      }
      setSharpened({ ...result, original });
      setQuestion(result.question.slice(0, MAX_QUESTION_LENGTH));
    } catch (sharpenError) {
      setError(getErrorMessage(sharpenError));
    } finally {
      setSharpening(false);
    }
  }

  function revertQuestion() {
    if (sharpened) setQuestion(sharpened.original);
    setSharpened(null);
  }

  function joinIn() {
    const text = personDraft.trim();
    if (!text) return;
    pendingPersonRef.current = text.slice(0, MAX_PERSON_LENGTH);
    setPersonQueued(true);
    setPersonDraft("");
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

  // Turns where the judge found the room discovered something, with the point it found.
  const discoveryAt = new Map(
    (run?.scorecard?.discoveries ?? []).flatMap((item) => (item.turnId ? [[item.turnId, item.point] as const] : [])),
  );

  function answerTap(answer: TapId) {
    if (!run) return;
    setTap(answer);
    setHistory(recordTap(readScoreHistory(), run.createdAt, answer));
  }

  const allTurns = run
    ? [...run.rounds.flatMap((round) => round.turns), ...(run.synthesis ? [run.synthesis] : []), ...run.contributions]
    : [];
  const totalTokens =
    allTurns.reduce((total, turn) => total + (turn.usage?.total_tokens ?? 0), 0) + (run?.listening?.tokens ?? 0);
  const totalCost = allTurns.reduce((total, turn) => total + (turn.usage?.cost ?? 0), 0) + (run?.listening?.cost ?? 0);

  const joinForm = conversing ? (
    <form
                className="join-in"
                onSubmit={(event) => {
                  event.preventDefault();
                  joinIn();
                }}
              >
                <label htmlFor="join-in-text">Join the conversation</label>
                <div className="join-in-row">
                  <input
                    disabled={personQueued}
                    id="join-in-text"
                    maxLength={MAX_PERSON_LENGTH}
                    onChange={(event) => setPersonDraft(event.target.value)}
                    placeholder={personQueued ? "You're next: the room will hear you after this turn." : "Add a thought, a fact, a question…"}
                    value={personDraft}
                  />
                  <button className="button" disabled={personQueued || !personDraft.trim()} type="submit">
                    Join in
                  </button>
                </div>
              </form>
  ) : null;

  const composer = (
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
          <button
            className="sharpen-button"
            disabled={running || sharpening || question.trim().length < 5}
            onClick={sharpenQuestion}
            title="Suggest a livelier version of your question"
            type="button"
          >
            {sharpening ? "Sharpening…" : "✦ Sharpen my question"}
          </button>
          <span className="guest-count">{question.length}/{MAX_QUESTION_LENGTH}</span>
        </div>
      </div>
      {sharpened && !running && (
        <div className="sharpen-card" role="status">
          <p className="sharpen-title">Sharpened. Here&apos;s what changed:</p>
          <ul>
            {sharpened.lessons.length ? (
              sharpened.lessons.map((lesson) => <li key={lesson}>{lesson}</li>)
            ) : (
              <li>Your question was already strong; it changed very little.</li>
            )}
          </ul>
          <p className="sharpen-original">
            <small>Yours:</small> {sharpened.original}
          </p>
          <div className="sharpen-actions">
            <button className="pill-button" onClick={revertQuestion} type="button">
              Back to mine
            </button>
            <button className="quiet-link" onClick={() => setSharpened(null)} type="button">
              Keep this one
            </button>
          </div>
        </div>
      )}
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
  );

  return (
    <>
      <header className="masthead room-masthead">
        <Link className="wordmark" href="/">The Room</Link>
        <nav className="header-nav" aria-label="About this room">
          <InfoDialogs />
          <KeyControl
            apiKey={apiKey}
            models={seated}
            onChange={(key) => {
              setApiKey(key);
              // A "add your key first" message no longer applies once a key is in.
              if (key.trim()) setError("");
            }}
            ref={keyControlRef}
          />
          <Link className="header-link" href="/login">Sign in</Link>
        </nav>
      </header>

      <h1 className="room-title">What shall we discuss?</h1>

      <SceneGuard composer={composer} key={run?.createdAt ?? "idle"}>
        <RoomScene
          apiKey={apiKey}
          finished={!running}
          hands={run?.hands}
          join={joinForm}
          onSpeech={countSpeech}
          items={playlist}
          key={run?.createdAt ?? "idle"}
          live={liveStage?.turns ?? (liveSynthesis ? [liveSynthesis] : [])}
          phase={phase}
          question={run?.question}
          seats={run ? runSeats : seatedNames}
          stageRef={stageRef}
        >
          {composer}
        </RoomScene>
      </SceneGuard>

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
              <h3>{String(index + 1).padStart(2, "0")} · {round.name === "Independent" ? "Independent (blind)" : round.name}</h3>
              {round.turns.map((turn, turnIndex) => {
                const sentences = turn.cutAt != null ? splitSentences(turn.text) : [];
                return (
                  <article
                    className="guest-turn"
                    data-kind={turn.kind ?? "turn"}
                    key={turn.id ?? `${turn.model.id}-${turnIndex}`}
                    style={{ borderLeftColor: colorOf(turn.servedModel ?? turn.model) }}
                  >
                    <div className="guest-turn-header">
                      <strong style={{ color: colorOf(turn.model) }}>
                        {modelLabel(turn)}
                        {turn.servedModel && <small> (standing in for {turn.model.label})</small>}
                        {turn.kind === "interjection" && <small> breaks in on {turn.respondingTo}</small>}
                        {turn.kind === "reply" && <small> answers {turn.respondingTo}</small>}
                        {turn.kind === "person" && <small> joins in</small>}
                        {turn.kind === "quip" && <small> cuts to the chase</small>}
                      </strong>
                      {turn.id && discoveryAt.get(turn.id) && <DiscoveryChip point={discoveryAt.get(turn.id)!} />}
                      {turn.kind !== "person" && <span>{turn.latency}s</span>}
                    </div>
                    {turn.cutAt != null ? (
                      <p>
                        {sentences.slice(0, turn.cutAt + 1).join(" ")}{" "}
                        <span className="unsaid" title="Not heard: someone broke in">
                          {sentences.slice(turn.cutAt + 1).join(" ")}
                        </span>
                      </p>
                    ) : (
                      <p>{turn.text}</p>
                    )}
                    {turn.brief && <p className="turn-brief">For the room: {turn.brief}</p>}
                    {!!turn.sources?.length && <Sources sources={turn.sources} />}
                  </article>
                );
              })}
            </section>
          ))}

          {run?.synthesis && (
            <section className="guest-synthesis">
              <p className="eyebrow">What the room discovered</p>
              <p>{run.synthesis.text}</p>
              {!!run.synthesis.sources?.length && <Sources sources={run.synthesis.sources} />}
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

          {run?.synthesis && run.judging && run.judge && (
            <RoomScorecard
              history={history}
              judge={run.judge}
              judging={run.judging}
              onTap={answerTap}
              scorecard={run.scorecard}
              seats={runSeats}
              solo={run.solo}
              tap={tap}
            />
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
                {allTurns.length} turns · {totalTokens.toLocaleString()} tokens
                {totalCost > 0 ? ` · about $${totalCost.toFixed(3)} for the models` : ""}
                {voiceCharacters > 0
                  ? ` · about $${(voiceCharacters * SPEECH_PRICE_PER_CHARACTER).toFixed(3)} for natural voices`
                  : ""}
                {elapsed !== null ? ` · written in ${elapsed}s` : ""}. Some providers don&apos;t report cost,
                so your OpenRouter activity page has the exact total.
              </p>
              <p className="guest-usage">
                <button className="quiet-link" onClick={checkExactCharge} type="button">
                  Check the exact charge on my key
                </button>
                {exactCharge && <> · {exactCharge}</>}
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
