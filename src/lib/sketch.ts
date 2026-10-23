/**
 * The room's artist: after a turn, a model sketches what was just said as a quick napkin
 * drawing, simple pen strokes the rug draws line by line while that turn is spoken.
 *
 * The artist writes SVG, which is model output, so it never reaches the page as markup. It is
 * parsed here into a small list of shapes with checked numeric attributes; anything else
 * (scripts, links, styles, foreign content, unknown attributes) is dropped. The page renders
 * that list as React elements, which escape any text.
 */
import { speakerName, type CompletionMessage, type GuestTurn } from "@/lib/guest-room";

export const SKETCH_WIDTH = 400;
export const SKETCH_HEIGHT = 240;
const MAX_SHAPES = 60;

export type SketchShape = {
  tag: "path" | "line" | "polyline" | "polygon" | "circle" | "ellipse" | "rect" | "text";
  attrs: Record<string, string>;
  text?: string;
};

export function buildSketchPrompt(question: string, recent: GuestTurn[], turn: GuestTurn): CompletionMessage[] {
  const context = recent.map((item) => `${speakerName(item)}: ${item.text}`).join("\n");
  return [
    {
      role: "system",
      content:
        "You are the artist in a room of thinkers. While they talk, you draw quick napkin sketches " +
        "of what was just said: a loose pen drawing that captures the idea, the way a person sketches " +
        "on a napkin to make a point. Simple, wobbly, charming lines; a picture, diagram or metaphor, " +
        "whatever makes the idea visible.\n\n" +
        `Reply with only an SVG: <svg viewBox="0 0 ${SKETCH_WIDTH} ${SKETCH_HEIGHT}">…</svg>. Use only ` +
        "<path>, <line>, <polyline>, <polygon>, <circle>, <ellipse>, <rect> and at most three short " +
        "<text> labels of a few words. Strokes only, no fills, no colors, no styles. Keep it under 40 " +
        "shapes and leave some empty space. If what was said has nothing worth drawing, reply exactly PASS.",
    },
    {
      role: "user",
      content: `The question: ${question}\n\nRecent talk:\n${context}\n\nDraw what ${speakerName(turn)} just said:\n${turn.text}`,
    },
  ];
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const NUMBERS = /^[\d\s.,-]+$/;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz\d\s.,-]+$/;
const TRANSFORM = /^((translate|rotate|scale)\(\s*-?[\d.]+(\s*[,\s]\s*-?[\d.]+){0,2}\s*\)\s*)+$/;

/** Which attributes each shape may keep, and what a valid value looks like. */
const ALLOWED: Record<SketchShape["tag"], Record<string, RegExp>> = {
  path: { d: PATH },
  line: { x1: NUMBER, y1: NUMBER, x2: NUMBER, y2: NUMBER },
  polyline: { points: NUMBERS },
  polygon: { points: NUMBERS },
  circle: { cx: NUMBER, cy: NUMBER, r: NUMBER },
  ellipse: { cx: NUMBER, cy: NUMBER, rx: NUMBER, ry: NUMBER },
  rect: { x: NUMBER, y: NUMBER, width: NUMBER, height: NUMBER, rx: NUMBER },
  text: { x: NUMBER, y: NUMBER, "font-size": NUMBER },
};
const SHARED: Record<string, RegExp> = { "stroke-width": NUMBER, transform: TRANSFORM };

/** The artist's drawing as safe shapes, or null for a pass or nothing usable. */
export function parseSketch(reply: string): SketchShape[] | null {
  if (/^\s*pass\.?\s*$/i.test(reply)) return null;
  const svg = reply.match(/<svg[\s\S]*?<\/svg>/i)?.[0];
  if (!svg) return null;
  const shapes: SketchShape[] = [];
  const element = /<(path|line|polyline|polygon|circle|ellipse|rect|text)\b([^>]*?)(?:\/>|>([^<]*)<\/\1\s*>)/gi;
  for (const match of svg.matchAll(element)) {
    if (shapes.length >= MAX_SHAPES) break;
    const tag = match[1].toLowerCase() as SketchShape["tag"];
    const rules = { ...ALLOWED[tag], ...SHARED };
    const attrs: Record<string, string> = {};
    for (const [, name, value] of match[2].matchAll(/([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*"([^"]*)"/g)) {
      const rule = rules[name.toLowerCase()];
      if (rule?.test(value.trim())) attrs[name.toLowerCase()] = value.trim();
    }
    const required = Object.keys(ALLOWED[tag]).filter((name) => !["rx", "font-size"].includes(name));
    if (!required.every((name) => name in attrs)) continue;
    if (tag === "text") {
      const words = (match[3] ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!words) continue;
      shapes.push({ tag, attrs, text: words });
    } else {
      shapes.push({ tag, attrs });
    }
  }
  return shapes.length ? shapes : null;
}
