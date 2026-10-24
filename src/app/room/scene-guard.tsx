"use client";

import { catchError, type ErrorInfo } from "next/error";
import { useEffect, type ReactNode } from "react";

type Props = {
  // The question box, kept on screen when the scene itself has fallen over.
  composer: ReactNode;
};

function SceneFallback({ composer }: Props, { error, reset }: ErrorInfo) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="room-scene room-fallback" aria-label="The room">
      <div className="stage-message" role="alert">
        <strong>The room stumbled.</strong>
        <span>Something went wrong drawing the scene. The written record below is safe.</span>
        <button className="pill-button" onClick={() => reset()} type="button">
          Try again
        </button>
      </div>
      {composer}
    </section>
  );
}

// A render bug in the scene shows a short note here instead of blanking the page.
export default catchError(SceneFallback);
