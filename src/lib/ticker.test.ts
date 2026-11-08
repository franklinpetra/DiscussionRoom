import { describe, expect, it } from "vitest";
import {
  buildTickerPrompt,
  feedText,
  interleave,
  parseFeed,
  parseTickerReply,
  storyAttachment,
  type Feed,
  type FeedItem,
} from "@/lib/ticker";

const science: Feed = { source: "ScienceDaily", url: "https://example.org/rss", tag: "Discovery" };

const rss = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title><![CDATA[Bees can count to four]]></title><link>https://example.org/bees</link>
<description>&lt;p&gt;Honeybees &amp;amp; numbers: a study finds bees track up to four objects.&lt;/p&gt;</description></item>
<item><title>No link here</title><description>Skipped.</description></item>
<item><title>Plain http is skipped</title><link>http://example.org/x</link></item>
<item><title>Ocean heat record</title><link>https://example.org/ocean</link><description>Oceans hit a new high.</description></item>
</channel></rss>`;

const atom = `<feed><entry><title>Atom story</title><link rel="alternate" href="https://example.org/atom"/>
<summary>An &#8220;Atom&#8221; summary.</summary></entry></feed>`;

describe("feeds", () => {
  it("reads RSS stories with https links, text cleaned", () => {
    const items = parseFeed(rss, science);
    expect(items.map((item) => item.title)).toEqual(["Bees can count to four", "Ocean heat record"]);
    expect(items[0].summary).toBe("Honeybees & numbers: a study finds bees track up to four objects.");
    expect(items[0]).toMatchObject({ source: "ScienceDaily", tag: "Discovery", link: "https://example.org/bees" });
  });

  it("reads Atom entries too", () => {
    const [item] = parseFeed(atom, science);
    expect(item.link).toBe("https://example.org/atom");
    expect(item.summary).toBe("An “Atom” summary.");
    expect(feedText("<b>a</b>&nbsp;b")).toBe("a b");
  });

  it("mixes feeds so no one source fills the ticker", () => {
    const a = [{ title: "a1" }, { title: "a2" }] as FeedItem[];
    const b = [{ title: "b1" }] as FeedItem[];
    expect(interleave([a, b]).map((item) => item.title)).toEqual(["a1", "b1", "a2"]);
  });
});

describe("rewriting stories as questions", () => {
  const items = parseFeed(rss, science);

  it("asks for questions in the room's own words, never the headline's", () => {
    const [system, user] = buildTickerPrompt(items);
    expect(system.content).toContain("never the headline's wording");
    expect(user.content).toContain("[1] (Discovery, ScienceDaily)");
  });

  it("keeps well-formed lines, tied to their story, and drops copies of the headline", () => {
    const reply = [
      "[1] | PLAYFUL | Why would a bee need to count? | A study finds honeybees can track up to four objects.",
      "[2] | SERIOUS | Ocean heat record | Oceans reached a new high.",
      "[2] | WILD | What does warmer water change? | Oceans reached a new high.",
      "not a line",
    ].join("\n");
    const prompts = parseTickerReply(reply, items);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      tag: "Discovery",
      tone: "playful",
      question: "Why would a bee need to count?",
      link: "https://example.org/bees",
    });
  });

  it("attaches the story's summary and link for the room to read", () => {
    const [prompt] = parseTickerReply("[1] | MIXED | Why would a bee need to count? | Bees track four objects.", items);
    const story = storyAttachment(prompt);
    expect(story.name).toBe("Story · ScienceDaily");
    expect(story.text).toContain("Bees track four objects.");
    expect(story.text).toContain("https://example.org/bees");
  });
});
