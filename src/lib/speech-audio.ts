export const SPEECH_API = "https://openrouter.ai/api/v1/audio/speech";
// Microsoft MAI-Voice: natural English voices, available on zero-data-retention routes.
export const SPEECH_MODEL = "microsoft/mai-voice-2.1-flash";
export const SPEECH_PRICE_PER_CHARACTER = 0.000015;

// The first voice is Australian (fun for an American ear); the rest are American, each distinct.
const VOICES = ["en-AU-Isla", "en-US-Harper", "en-US-Jasper", "en-US-Olivia", "en-US-Grant", "en-US-Iris", "en-US-Sage"];

/** A distinct natural voice for each seat. */
export function seatVoice(index: number) {
  return VOICES[index % VOICES.length];
}

export async function requestSpeech(apiKey: string, text: string, voice: string, signal?: AbortSignal) {
  const response = await fetch(SPEECH_API, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: SPEECH_MODEL,
      input: text,
      voice: `${voice}:MAI-Voice-2.1-Flash`,
      response_format: "mp3",
      provider: { zdr: true },
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `Speech request returned HTTP ${response.status}.`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("The speech model returned no audio.");
  return blob;
}

/** Which sentence is being heard, estimated from how far through the audio playback is. */
export function sentenceAt(sentences: string[], fraction: number) {
  const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0) || 1;
  let covered = 0;
  for (const [index, sentence] of sentences.entries()) {
    covered += sentence.length;
    if (fraction <= covered / total) return index;
  }
  return Math.max(0, sentences.length - 1);
}
