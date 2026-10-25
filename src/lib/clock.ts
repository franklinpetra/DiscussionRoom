/**
 * Creative Clock: a room that makes things. The person describes a project and seats the makers it
 * needs; the hand goes once around the face in stages (thinkers, then shapers, then makers,
 * then testers), each seat building on what the earlier ones made. Some seats write, some build
 * a page you can click (a prototype, a picture of the data), one paints, one composes.
 */
import {
  FALLBACK_MODEL,
  OPENROUTER_API,
  webAddresses,
  withoutWebAddresses,
  type CompletionMessage,
  type Usage,
} from "@/lib/guest-room";

export type SeatGroup = "think" | "shape" | "make" | "change" | "test";
/** text: words · page: a self-contained page you can click · image: a picture · music: a short theme. */
export type SeatKind = "text" | "page" | "image" | "music";

export type ClockSeat = {
  id: string;
  name: string;
  /** A few words under the seat's name. */
  job: string;
  group: SeatGroup;
  /** Seats in the same stage work at once; later stages see what earlier ones made. */
  stage: number;
  kind: SeatKind;
  model: string;
  /** What this seat does, in its own system prompt. */
  instructions: string;
  /** Set when the seat's model can't promise zero data retention. */
  privacyNote?: string;
};

export const GROUPS: Record<SeatGroup, { name: string; about: string; color: string }> = {
  think: { name: "Thinkers", about: "the need, what exists, the people, play", color: "#3a5fb0" },
  shape: { name: "Shapers", about: "steps, the data, the look, the interface", color: "#1c6b5c" },
  make: { name: "Makers", about: "words, sound, film", color: "#8a5a12" },
  change: { name: "Change-makers", about: "money, reach, measures, harms", color: "#a23c6b" },
  test: { name: "Testers", about: "try it before it is built", color: "#6250d6" },
};

const PAGE_RULES =
  "Return one complete, self-contained HTML file inside a ```html code block: inline CSS and " +
  "JavaScript only, no external scripts, fonts, images or network requests, readable on a " +
  "phone and on a laptop. Use real-feeling content, never lorem ipsum.";

export const SEATS: readonly ClockSeat[] = [
  {
    id: "spark",
    name: "Spark",
    job: "Finds the real need",
    group: "think",
    stage: 0,
    kind: "text",
    model: "openai/gpt-6-luna",
    instructions:
      "Find the real need beneath the brief: who it is for, the exact moment it fixes, and what " +
      "would make it matter. If the brief is aiming at the wrong problem, say so kindly. End " +
      "with the one question the room should keep asking.",
  },
  {
    id: "scout",
    name: "Scout",
    job: "Prior art and patents",
    group: "think",
    stage: 0,
    kind: "text",
    model: "perplexity/sonar-pro",
    instructions:
      "Search for what already exists: products, projects, research and patents close to this " +
      "idea. Name the closest few and what each lacks, then where the open space is. Cite what " +
      "you find; never invent a product, patent or number.",
  },
  {
    id: "people",
    name: "People",
    job: "Who will use it",
    group: "think",
    stage: 0,
    kind: "text",
    model: "google/gemini-3.8-flash",
    instructions:
      "Describe three people this is for, including the one it is hardest to design for. For " +
      "each, one line on their situation, what they need in the moment, and what would make " +
      "them give up.",
  },
  {
    id: "play",
    name: "Play",
    job: "What if…?",
    group: "think",
    stage: 0,
    kind: "text",
    model: "openai/gpt-5.4-mini",
    instructions:
      "Play with the idea, because play is often the road to insight. Offer three quick " +
      "\"what if\" twists: turn it upside down, borrow from an unrelated world (a game, a " +
      "kitchen, a festival), or shrink it or blow it up. Keep it light and fast; at least one " +
      "should turn out to be genuinely useful.",
  },
  {
    id: "flow",
    name: "Flow",
    job: "The steps they take",
    group: "shape",
    stage: 1,
    kind: "text",
    model: "anthropic/claude-haiku-5.5",
    instructions:
      "Lay out the journey in as few steps as it takes, from the moment someone needs this to " +
      "the moment it is done. Number the steps; for each, what the person sees and does. Mark " +
      "the step where people are most likely to get lost, and how to catch them.",
  },
  {
    id: "look",
    name: "Look",
    job: "Colour, type, imagery",
    group: "shape",
    stage: 1,
    kind: "image",
    model: "google/gemini-3.1-flash-image",
    instructions:
      "Give it a look that fits the slant. Make one image that captures how it should feel: no " +
      "words or lettering in the image. Then, in your text, write PALETTE: followed by four or " +
      "five hex colours, and one sentence on why this look.",
  },
  {
    id: "data",
    name: "Data",
    job: "Facts, made meaningful",
    group: "shape",
    stage: 1,
    kind: "page",
    model: "anthropic/claude-sonnet-5.5",
    instructions:
      "Find the facts that matter most here and show them in their most meaningful form: the " +
      "comparison, scale or human story that makes the point land and could move someone to " +
      "act. Data is often not shown in its most meaningful form; fix that. Start with one " +
      "sentence on why you chose this form. Use only figures you are confident are real, and " +
      "list their sources on a last line, SOURCES: followed by web addresses separated by " +
      "semicolons. If real figures aren't available, show the shape of the data that is needed " +
      `and label it clearly as illustrative. ${PAGE_RULES}`,
  },
  {
    id: "interface",
    name: "Interface",
    job: "A prototype to try",
    group: "shape",
    stage: 2,
    kind: "page",
    model: "anthropic/claude-sonnet-5.5",
    instructions:
      "Build a clickable prototype of the first key screens (two to four), designed for " +
      "optimal use: follow Flow's steps, Look's palette and the people described, if the room " +
      "has them. Buttons and links should really move between screens. Start with one sentence " +
      `on what you built and the design choice that matters most. ${PAGE_RULES}`,
  },
  {
    id: "voice",
    name: "Voice",
    job: "Words and tone",
    group: "make",
    stage: 3,
    kind: "text",
    model: "deepseek/deepseek-v4.1-flash",
    instructions:
      "Write how it talks: two name ideas, the first words people see, one helpful message for " +
      "when something goes wrong, and its tone in three words.",
  },
  {
    id: "sound",
    name: "Sound",
    job: "A short theme",
    group: "make",
    stage: 3,
    kind: "music",
    model: "google/lyria-3-clip-preview",
    instructions: "",
    privacyNote: "The music model may keep a copy of its short prompt; it is sent nothing else.",
  },
  {
    id: "film",
    name: "Film",
    job: "A film that moves people",
    group: "make",
    stage: 3,
    kind: "text",
    model: "openai/gpt-6-luna",
    instructions:
      "Often a film is what delivers the facts in a way that makes change possible. Storyboard " +
      "a 30-second film that makes someone care: five or six numbered shots, each with what we " +
      "see and the line we hear. Real moments, not stock-footage clichés.",
  },
  {
    id: "economist",
    name: "Economist",
    job: "Who pays, who gains",
    group: "change",
    stage: 3,
    kind: "text",
    model: "google/gemini-3.8-flash",
    instructions:
      "Follow the money: who pays, who saves, what it costs to run, and the incentive that " +
      "could make it fail or spread.",
  },
  {
    id: "reach",
    name: "Reach",
    job: "Getting it to people",
    group: "change",
    stage: 3,
    kind: "text",
    model: "anthropic/claude-haiku-5.5",
    instructions:
      "How does this reach the people who need it most, who are often the hardest to reach? " +
      "Name the channels, the trusted messengers, and the barriers: cost, language, trust, access.",
  },
  {
    id: "measure",
    name: "Measure",
    job: "How we'd know",
    group: "change",
    stage: 3,
    kind: "text",
    model: "anthropic/claude-haiku-5.5",
    instructions:
      "How would we know it is working? Name the one number that matters most, two supporting " +
      "signs, and an early warning that it isn't.",
  },
  {
    id: "ethics",
    name: "Ethics",
    job: "Who could be harmed",
    group: "change",
    stage: 3,
    kind: "text",
    model: "openai/gpt-5.4-mini",
    instructions:
      "Who could this harm, and how? Name the risk most likely to be overlooked, and the " +
      "simplest safeguard.",
  },
  {
    id: "testers",
    name: "Testers",
    job: "Try it and stumble",
    group: "test",
    stage: 4,
    kind: "text",
    model: "google/gemini-3.8-flash",
    instructions:
      "Try what the room made as the people described (or three typical users if none were). " +
      "Be honest, not polite. For each person: where they got stuck, what confused them, and " +
      "what delighted them. End with the two fixes that matter most.",
  },
];

export const MAX_SEATED = 12;

export const KITS = [
  { id: "product", name: "Product", seats: ["spark", "scout", "people", "flow", "look", "interface", "voice", "testers"] },
  { id: "data", name: "Data story", seats: ["spark", "scout", "people", "data", "look", "film", "voice"] },
  {
    id: "change",
    name: "Social change",
    seats: ["spark", "scout", "people", "economist", "reach", "measure", "ethics", "interface", "testers"],
  },
  { id: "play", name: "Play", seats: ["spark", "play", "look", "interface", "sound", "voice", "film"] },
] as const;

export const seatById = (id: string) => SEATS.find((seat) => seat.id === id);

export type Slant = { feel: string; spirit: string; forWhom: string };

/** What a seat made: its words, and a page, picture or theme when it makes one. */
export type Making = {
  seatId: string;
  text: string;
  html?: string;
  image?: string;
  palette?: string[];
  audio?: string;
  sources?: string[];
  usage?: Usage | null;
  error?: string;
  /** The person's request this answers, when they steered the seat. */
  note?: string;
};

function slantLine(slant: Slant) {
  return (
    `The person's slant, which every seat follows: feel ${slant.feel}; spirit ${slant.spirit}` +
    (slant.forWhom.trim() ? `; made for ${slant.forWhom.trim()}.` : ".")
  );
}

/** What the room has made so far, as one seat reads it. Testers also get the prototype's code. */
function roomSoFar(makings: Making[], reader: ClockSeat) {
  return makings
    .filter((making) => !making.error)
    .map((making) => {
      const seat = seatById(making.seatId);
      let block = `--- ${seat?.name ?? making.seatId}${making.note ? ` (asked: ${making.note})` : ""} ---\n${making.text}`;
      if (making.palette?.length) block += `\nPalette: ${making.palette.join(", ")}`;
      if (making.html && (reader.id === "testers" || reader.kind === "page")) {
        block += `\n[The page ${seat?.name ?? "it"} built]\n${making.html.slice(0, 14000)}`;
      } else if (making.html) {
        block += `\n[${seat?.name ?? "It"} built a page you can click.]`;
      }
      return block;
    })
    .join("\n\n");
}

export function buildSeatPrompt(
  seat: ClockSeat,
  brief: string,
  slant: Slant,
  makings: Making[],
  note?: string,
): CompletionMessage[] {
  const words = seat.kind === "text" ? " Stay under 130 words." : "";
  const sofar = roomSoFar(makings, seat);
  return [
    {
      role: "system",
      content:
        `You are ${seat.name} at the Clock, a room where several AI makers build one idea ` +
        `together, each adding their own layer. Your part: ${seat.job.toLowerCase()}.\n\n` +
        `${seat.instructions}\n\n` +
        "Build on what the others have already made, and never repeat them. Plain words, short " +
        `and concrete, no headings.${words}\n\n${slantLine(slant)}`,
    },
    {
      role: "user",
      content:
        `The project:\n${brief}` +
        (sofar ? `\n\nWhat the room has made so far:\n\n${sofar}` : "") +
        (note ? `\n\nThe person now asks you: ${note}` : ""),
    },
  ];
}

/** The theme's prompt: the music model hears the project and the slant, nothing more. */
export function buildMusicPrompt(brief: string, slant: Slant) {
  const gist = brief.replace(/\s+/g, " ").trim().slice(0, 300);
  return (
    `A 30-second instrumental theme, no vocals, for this project: ${gist}. ` +
    `Feel: ${slant.feel}. Spirit: ${slant.spirit}.` +
    (slant.forWhom.trim() ? ` Made for ${slant.forWhom.trim()}.` : "")
  );
}

/** Takes the HTML out of a reply; the words around it become the seat's note on what it built. */
export function splitPage(reply: string): { text: string; html?: string } {
  const fenced = reply.match(/```html\s*\n([\s\S]*?)(```|$)/i);
  const bare = !fenced ? reply.match(/<!doctype html[\s\S]*<\/html>/i) ?? reply.match(/<html[\s\S]*<\/html>/i) : null;
  const html = fenced?.[1]?.trim() || bare?.[0];
  if (!html) return { text: reply.trim() };
  const text = reply.replace(fenced?.[0] ?? bare?.[0] ?? "", "").trim();
  return { text, html };
}

/** The SOURCES line and any addresses in the text, kept as notes; the words are returned without them. */
export function splitSources(text: string): { text: string; sources: string[] } {
  const kept: string[] = [];
  const listed: string[] = [];
  for (const line of text.split("\n")) {
    const plain = line.replace(/^[*_\s]+/, "");
    if (/^SOURCES:/i.test(plain)) listed.push(...webAddresses(plain.slice(8)));
    else kept.push(line);
  }
  const body = kept.join("\n").trim();
  return { text: withoutWebAddresses(body), sources: [...new Set([...webAddresses(body), ...listed])] };
}

export function parsePalette(text: string): { text: string; palette: string[] } {
  const match = text.match(/PALETTE:\s*([^\n]+)/i);
  const palette = match ? (match[1].match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []).slice(0, 6) : [];
  return { text: (match ? text.replace(match[0], "") : text).replace(/\n{3,}/g, "\n\n").trim(), palette };
}

type ChatPayload = {
  choices?: Array<{ message?: Record<string, unknown> & { content?: unknown } }>;
  citations?: unknown;
  usage?: Usage;
  error?: { message?: string };
};

/** Words from a message's content, which may be a string or a list of parts. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("");
}

/** The first media data URL of a kind anywhere in a message (models nest it differently). */
export function findMedia(value: unknown, kind: "image" | "audio", depth = 0): string | undefined {
  if (depth > 6 || value == null) return undefined;
  if (typeof value === "string") return value.startsWith(`data:${kind}/`) ? value : undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMedia(item, kind, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // OpenAI-style audio: { data: base64, format: "mp3" } under an "audio" key.
    if (kind === "audio" && typeof record.data === "string" && record.data.length > 200 && !record.data.startsWith("data:")) {
      const format = typeof record.format === "string" ? record.format : typeof record.mime_type === "string" ? record.mime_type.split("/")[1] : "mpeg";
      return `data:audio/${format === "mp3" ? "mpeg" : format};base64,${record.data}`;
    }
    for (const key of Object.keys(record)) {
      const found = findMedia(record[key], kind, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

/** One seat's request, whole rather than streamed: the face shows the seat at work meanwhile. */
export async function askSeat(
  apiKey: string,
  seat: ClockSeat,
  messages: CompletionMessage[],
  signal: AbortSignal,
): Promise<Omit<Making, "seatId">> {
  const body: Record<string, unknown> = { messages, stream: false };
  if (seat.kind === "music") {
    body.model = seat.model;
    body.modalities = ["text", "audio"];
  } else if (seat.kind === "image") {
    body.model = seat.model;
    body.modalities = ["image", "text"];
    body.provider = { zdr: true };
  } else {
    body.models = [seat.model, FALLBACK_MODEL.id];
    body.reasoning = { effort: seat.kind === "page" ? "medium" : "low", exclude: true };
    body.provider = { zdr: true };
  }
  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as ChatPayload | null;
  if (!response.ok || !payload) throw new Error(payload?.error?.message || `OpenRouter returned HTTP ${response.status}.`);
  if (payload.error?.message) throw new Error(payload.error.message);
  const message = payload.choices?.[0]?.message ?? {};
  const raw = contentText(message.content);
  const citations = Array.isArray(payload.citations) ? payload.citations.filter((item): item is string => typeof item === "string") : [];

  if (seat.kind === "music") {
    const audio = findMedia(message, "audio");
    if (!audio) throw new Error("The music model answered without any audio.");
    return { text: raw.trim(), audio, usage: payload.usage ?? null };
  }
  if (seat.kind === "image") {
    const image = findMedia(message, "image");
    const { text, palette } = parsePalette(raw);
    if (!image) throw new Error("The image model answered without a picture.");
    return { text, image, palette, usage: payload.usage ?? null };
  }
  const page = seat.kind === "page" ? splitPage(raw) : { text: raw };
  if (seat.kind === "page" && !page.html) throw new Error("The page didn't come back complete. Try asking again.");
  const { text, sources } = splitSources(page.text.replace(/\[\d+\]/g, ""));
  if (!text && !page.html) throw new Error("The model returned no answer.");
  const allSources = [...new Set([...sources, ...citations])];
  return {
    text,
    ...(page.html ? { html: page.html } : {}),
    ...(allSources.length ? { sources: allSources } : {}),
    usage: payload.usage ?? null,
  };
}

/** Seated seats grouped into stages, in clock order within each stage. */
export function stagesOf(seated: string[]) {
  const seats = SEATS.filter((seat) => seated.includes(seat.id));
  const stages = [...new Set(seats.map((seat) => seat.stage))].sort((a, b) => a - b);
  return stages.map((stage) => seats.filter((seat) => seat.stage === stage));
}

/** Who answers a message: a seat named at the start or anywhere in it, else Spark (or the first seated). */
export function addressee(message: string, seated: string[]): ClockSeat | undefined {
  const seats = SEATS.filter((seat) => seated.includes(seat.id));
  const named = seats
    .map((seat) => ({ seat, at: message.search(new RegExp(`\\b${seat.name}\\b`, "i")) }))
    .filter((item) => item.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.seat;
  return named ?? seats.find((seat) => seat.id === "spark") ?? seats.find((seat) => seat.kind === "text");
}
