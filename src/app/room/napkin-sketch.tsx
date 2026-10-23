"use client";

import { createElement } from "react";
import { SKETCH_HEIGHT, SKETCH_WIDTH, type SketchShape } from "@/lib/sketch";

const REACT_NAMES: Record<string, string> = { "stroke-width": "strokeWidth", "font-size": "fontSize" };

/**
 * The artist's napkin sketch on the rug. Every stroke draws itself in turn, as if a pen were
 * moving, over `drawMs`; labels fade in as their turn comes. Shapes are already checked
 * (see lib/sketch.ts) and rendered as React elements, never as raw markup.
 */
export default function NapkinSketch({ shapes, drawMs }: { shapes: SketchShape[]; drawMs: number }) {
  const step = drawMs / Math.max(1, shapes.length);
  return (
    <svg
      aria-hidden="true"
      className="napkin-sketch"
      preserveAspectRatio="xMidYMid meet"
      viewBox={`0 0 ${SKETCH_WIDTH} ${SKETCH_HEIGHT}`}
    >
      {shapes.map((shape, i) => {
        const props: Record<string, string | number | object> = {
          key: i,
          className: shape.tag === "text" ? "sketch-label" : "sketch-stroke",
          style: { animationDelay: `${Math.round(i * step)}ms`, animationDuration: `${Math.round(Math.max(step * 1.6, 260))}ms` },
        };
        for (const [name, value] of Object.entries(shape.attrs)) props[REACT_NAMES[name] ?? name] = value;
        if (shape.tag !== "text") props.pathLength = 1;
        return createElement(shape.tag, props, shape.text);
      })}
    </svg>
  );
}
