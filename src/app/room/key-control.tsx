"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { GuestModel } from "@/lib/guest-room";
import { fetchKeyInfo, testModel, testSpeech, type CheckResult } from "@/lib/openrouter-check";

const STORAGE_KEY = "theroom.openrouterKey";

function readStoredKey() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredKey(value: string | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private windows, blocked site data); the key still works for this tab.
  }
}

export type KeyControlHandle = { open: () => void };

type KeyControlProps = {
  apiKey: string;
  onChange: (key: string) => void;
  models: GuestModel[];
  ref?: Ref<KeyControlHandle>;
};

export default function KeyControl({ apiKey, onChange, models, ref }: KeyControlProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(false);
  const [stored, setStored] = useState(false);
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);

  async function runChecks() {
    const key = draft.trim();
    if (!key) return;
    setChecking(true);
    setChecks([]);
    const keyResult = await fetchKeyInfo(key);
    setChecks([keyResult]);
    if (keyResult.ok || keyResult.info) {
      const results = await Promise.all([...models.map((model) => testModel(key, model)), testSpeech(key)]);
      setChecks([keyResult, ...results]);
    }
    setChecking(false);
  }

  useEffect(() => {
    const saved = readStoredKey();
    if (saved) onChange(saved);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({ open }));

  function open() {
    const saved = !!readStoredKey();
    setDraft(apiKey);
    setStored(saved);
    setRemember(saved);
    setChecks(null);
    dialogRef.current?.showModal();
  }

  function save() {
    const clean = draft.trim();
    onChange(clean);
    writeStoredKey(remember && clean ? clean : null);
    setStored(remember && !!clean);
    dialogRef.current?.close();
  }

  function forget() {
    onChange("");
    setDraft("");
    writeStoredKey(null);
    setStored(false);
    setRemember(false);
    dialogRef.current?.close();
  }

  return (
    <>
      <button className="key-pill" data-set={!!apiKey} onClick={open} type="button">
        <span aria-hidden="true" className="key-dot" />
        {apiKey ? "Key set" : "Add key"}
      </button>
      <dialog aria-labelledby="key-dialog-title" className="room-dialog" ref={dialogRef}>
        <form method="dialog" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <h2 id="key-dialog-title">Your OpenRouter key</h2>
          <p>
            One key reaches every model in the room. Get one at{" "}
            <a href="https://openrouter.ai/keys" rel="noreferrer" target="_blank">
              openrouter.ai/keys
            </a>
            . This tab sends it only to <code>openrouter.ai</code>, in the{" "}
            <code>Authorization</code> header. This site&apos;s server never receives it, and
            OpenRouter bills you directly. Enter it here, not in <code>.env.local</code>.
          </p>
          <input
            aria-label="OpenRouter API key"
            autoComplete="off"
            className="text-input"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="sk-or-…"
            spellCheck={false}
            type="password"
            value={draft}
          />
          <label className="check-row">
            <input
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              type="checkbox"
            />
            Keep it in this browser so I don&apos;t have to paste it again
          </label>
          <p className="dialog-note">
            {stored ? "A key is saved in this browser." : "Without the box ticked, the key lives only in this tab's memory."}
          </p>
          <div className="key-check">
            <button className="pill-button" disabled={!draft.trim() || checking} onClick={runChecks} type="button">
              {checking ? "Testing…" : "Test my key"}
            </button>
            <span>Sends each seated model a one-word test (a fraction of a cent).</span>
          </div>
          {checks && (
            <ul className="check-list" aria-live="polite">
              {checks.map((check) => (
                <li data-ok={check.ok} key={check.name}>
                  <strong>{check.ok ? "✓" : "✕"} {check.name}</strong>
                  <span>{check.detail}</span>
                  {check.advice && <em>{check.advice}</em>}
                </li>
              ))}
              {checking && <li>Testing the models…</li>}
            </ul>
          )}
          <div className="dialog-actions">
            {apiKey || stored ? (
              <button className="pill-button" onClick={forget} type="button">Forget key</button>
            ) : <span />}
            <div>
              <button className="pill-button" onClick={() => dialogRef.current?.close()} type="button">
                Cancel
              </button>
              <button className="button" type="submit">Save</button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}
