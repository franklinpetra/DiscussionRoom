/**
 * The news ticker: "Not sure what to ask? From today's news →". Each prompt carries a subject
 * label (Science, Politics, International…). A server job reads a few
 * public feeds, and a low-cost model rewrites each story as a short question in its own words,
 * with a brief summary the room can read (the models don't know today's news). The ticker
 * never shows an outlet's headline: only the room's question, with a link to the source.
 *
 * Before launch, confirm each feed's terms allow this use. AP's headlines are licensed and AP
 * has no public feed, so AP is left out until it's licensed; Fix the News is a paid newsletter
 * and is left out without permission.
 */
import { TONES, type CompletionMessage, type Tone } from "@/lib/guest-room";

/** Each story is labelled by its subject. The model picks one; the feed's own topic is the fallback. */
export const TICKER_TAGS = [
  "Science",
  "Technology",
  "Health",
  "Climate",
  "Politics",
  "International",
  "Business",
  "Culture",
] as const;
export type TickerTag = (typeof TICKER_TAGS)[number];

export type Feed = { source: string; url: string; tag: TickerTag };

export const FEEDS: readonly Feed[] = [
  { source: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/science.xml", tag: "Science" },
  { source: "Nature", url: "https://www.nature.com/nature.rss", tag: "Science" },
  { source: "Reasons to be Cheerful", url: "https://reasonstobecheerful.world/feed/", tag: "Culture" },
  { source: "Positive News", url: "https://www.positive.news/feed/", tag: "Culture" },
  { source: "NPR", url: "https://feeds.npr.org/1001/rss.xml", tag: "Politics" },
  { source: "NPR Politics", url: "https://feeds.npr.org/1014/rss.xml", tag: "Politics" },
  { source: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", tag: "International" },
];

function asTag(text: string): TickerTag | undefined {
  const wanted = text.trim().toLowerCase();
  return TICKER_TAGS.find((tag) => tag.toLowerCase() === wanted);
}

/** Stories taken from each feed, and prompts kept in all. */
export const PER_FEED = 4;
export const MAX_PROMPTS = 20;

export type FeedItem = { source: string; tag: TickerTag; title: string; link: string; summary: string };

export type TickerPrompt = {
  tag: TickerTag;
  tone: Tone;
  /** The room's own question, a few words long. */
  question: string;
  /** A short, plain summary of the story, attached to the room's question. */
  summary: string;
  source: string;
  link: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(\w+);/g, (match, name) => ENTITIES[name] ?? match);
}

/** Plain text from a feed field: CDATA unwrapped, escaped HTML decoded, tags removed. */
export function feedText(raw: string) {
  const unwrapped = decode(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
  return decode(unwrapped.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function field(block: string, names: string[]) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (match) return feedText(match[1]);
  }
  return "";
}

/** The first stories in an RSS or Atom feed. */
export function parseFeed(xml: string, feed: Feed, limit = PER_FEED): FeedItem[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = field(block, ["title"]);
    const atomLink = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
    const link = (field(block, ["link"]) || atomLink || "").trim();
    if (!title || !/^https:\/\//i.test(link)) continue;
    const summary = field(block, ["description", "summary", "content"]).slice(0, 600);
    items.push({ source: feed.source, tag: feed.tag, title, link, summary });
    if (items.length >= limit) break;
  }
  return items;
}

export function buildTickerPrompt(items: FeedItem[]): CompletionMessage[] {
  const listed = items
    .map((item, i) => `[${i + 1}] (${item.source}, usually ${item.tag})\nTitle: ${item.title}\nSummary: ${item.summary || "(none)"}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "You write prompts for a discussion app. For each news story, write a short question, " +
        "three to nine words, that a curious person might bring to a thoughtful discussion about " +
        "it: open, specific and inviting. Use your own words, never the headline's wording or " +
        "structure. Then write a neutral summary of two or three sentences, also in your own " +
        "words, using only the facts in the title and summary given: no outside knowledge, no " +
        "opinion. Label its subject with exactly one of: " +
        `${TICKER_TAGS.join(", ")}. ` +
        "Choose a tone: PLAYFUL for light or delightful stories, MIXED for most, " +
        "SERIOUS for grave ones (harm, loss, conflict, injustice). Skip any story that is too " +
        "thin to discuss, or that is about a private person's tragedy.\n\n" +
        "Reply with one line per story you keep, and nothing else:\n" +
        "[number] | SUBJECT | TONE | question | summary",
    },
    { role: "user", content: listed },
  ];
}

/** Reads the model's lines back into prompts, each tied to the story it came from. */
export function parseTickerReply(reply: string, items: FeedItem[]): TickerPrompt[] {
  const prompts: TickerPrompt[] = [];
  const used = new Set<number>();
  for (const raw of reply.split("\n")) {
    const parts = raw.replace(/[*`]/g, "").split("|").map((part) => part.trim());
    if (parts.length < 5) continue;
    const index = Number(parts[0].replace(/[[\]]/g, "")) - 1;
    const item = items[index];
    if (!item) continue;
    const tag = asTag(parts[1]) ?? item.tag;
    const tone = parts[2].toLowerCase() as Tone;
    const question = parts[3].replace(/^["“]|["”]$/g, "");
    const summary = parts.slice(4).join(" | ");
    if (used.has(index) || !(TONES as readonly string[]).includes(tone)) continue;
    const words = question.split(/\s+/).length;
    if (words < 2 || words > 14 || !summary) continue;
    // Never the outlet's own headline: a question that copies it is dropped.
    if (question.toLowerCase().replace(/[^\w ]/g, "") === item.title.toLowerCase().replace(/[^\w ]/g, "")) continue;
    used.add(index);
    prompts.push({ tag, tone, question, summary, source: item.source, link: item.link });
    if (prompts.length >= MAX_PROMPTS) break;
  }
  return prompts;
}

/** Feeds take turns, so the ticker mixes discoveries, good news, headlines and world stories. */
export function interleave(groups: FeedItem[][]): FeedItem[] {
  const out: FeedItem[] = [];
  for (let i = 0; groups.some((group) => i < group.length); i++) {
    for (const group of groups) if (group[i]) out.push(group[i]);
  }
  return out;
}

/** What the room reads about the story: the summary, the source and its link. */
export function storyAttachment(prompt: TickerPrompt) {
  return {
    name: `Story · ${prompt.source}`,
    text:
      `${prompt.summary}\n\nSource: ${prompt.source}, ${prompt.link}\n` +
      "This is a short summary of a recent news story. Treat it as the facts known so far, and " +
      "say so when something isn't in it.",
  };
}
