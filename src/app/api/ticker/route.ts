import { PARTING_OPTIONS, requestCompletion } from "@/lib/guest-room";
import { buildTickerPrompt, FEEDS, interleave, parseFeed, parseTickerReply, type TickerPrompt } from "@/lib/ticker";

/**
 * Today's prompts for the ticker, refreshed at most once an hour. The rewrite runs on the
 * server with its own OpenRouter key (OPENROUTER_TICKER_KEY, a server-side secret, never a
 * NEXT_PUBLIC_ variable), on a zero-data-retention route. Without the key the ticker is empty
 * and the page simply doesn't show it.
 */
export const dynamic = "force-static";
export const revalidate = 3600;

const TICKER_MODEL = process.env.TICKER_MODEL || "google/gemini-3.8-flash";

async function readFeeds() {
  const groups = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const response = await fetch(feed.url, {
          headers: { "User-Agent": "TheRoom ticker", Accept: "application/rss+xml, application/atom+xml, application/xml" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return [];
        return parseFeed(await response.text(), feed);
      } catch {
        return [];
      }
    }),
  );
  return interleave(groups);
}

export async function GET() {
  const key = process.env.OPENROUTER_TICKER_KEY;
  let prompts: TickerPrompt[] = [];
  if (key) {
    try {
      const items = await readFeeds();
      if (items.length) {
        const reply = await requestCompletion(
          key,
          { id: TICKER_MODEL, label: "Ticker", vendor: "TheRoom" },
          buildTickerPrompt(items),
          AbortSignal.timeout(60_000),
          undefined,
          PARTING_OPTIONS,
        );
        prompts = parseTickerReply(reply.text, items);
      }
    } catch {
      // A quiet ticker is better than a broken page: try again at the next refresh.
    }
  }
  return Response.json({ prompts, updatedAt: new Date().toISOString() });
}
