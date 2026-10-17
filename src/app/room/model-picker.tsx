"use client";

import { useMemo, useRef, useState } from "react";
import {
  ADDED_MODEL_COLORS,
  CHAIRS,
  fetchCatalog,
  MAX_MODELS,
  MIN_MODELS,
  type CatalogModel,
  type GuestModel,
} from "@/lib/guest-room";

export type ModelChoice = GuestModel & { selected: boolean; added?: boolean };

type ModelPickerProps = {
  models: ModelChoice[];
  onChange: (models: ModelChoice[]) => void;
  disabled?: boolean;
};

function price(value: number | null) {
  if (value === null) return "?";
  return value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}

export default function ModelPicker({ models, onChange, disabled }: ModelPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [search, setSearch] = useState("");
  const seated = models.filter((model) => model.selected).length;

  function toggle(id: string) {
    onChange(
      models.map((model) => {
        if (model.id !== id) return model;
        if (model.selected && seated <= MIN_MODELS) return model;
        if (!model.selected && seated >= MAX_MODELS) return model;
        return { ...model, selected: !model.selected };
      }),
    );
  }

  function remove(id: string) {
    onChange(models.filter((model) => model.id !== id));
  }

  async function openCatalog() {
    dialogRef.current?.showModal();
    if (catalog) return;
    setCatalogError("");
    try {
      setCatalog(await fetchCatalog());
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Couldn't load OpenRouter's model list.");
    }
  }

  function add(model: CatalogModel) {
    const usedColors = new Set(models.map((item) => item.color));
    const color = ADDED_MODEL_COLORS.find((item) => !usedColors.has(item)) ?? ADDED_MODEL_COLORS[0];
    const usedChairs = new Set(models.map((item) => item.chair));
    const chair = CHAIRS.find((item) => !usedChairs.has(item)) ?? CHAIRS[models.length % CHAIRS.length];
    onChange([
      ...models,
      {
        id: model.id,
        label: model.label,
        vendor: model.vendor,
        color,
        chair,
        selected: seated < MAX_MODELS,
        added: true,
      },
    ]);
    dialogRef.current?.close();
  }

  const matches = useMemo(() => {
    if (!catalog) return [];
    const present = new Set(models.map((model) => model.id));
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    return catalog
      .filter((model) => !present.has(model.id))
      .filter((model) => {
        const haystack = `${model.id} ${model.label} ${model.vendor}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, 40);
  }, [catalog, models, search]);

  return (
    <div className="seat-picker">
      <div className="seat-chips" role="group" aria-label="Models in the room">
        {models.map((model) => (
          <span className="seat-chip" data-selected={model.selected} key={model.id}>
            <button
              aria-pressed={model.selected}
              disabled={disabled}
              onClick={() => toggle(model.id)}
              title={model.selected ? `Unseat ${model.label}` : `Seat ${model.label}`}
              type="button"
            >
              <span aria-hidden="true" className="seat-dot" style={{ background: model.color }} />
              {model.label}
              <small>{model.vendor}</small>
            </button>
            {model.added && (
              <button
                aria-label={`Remove ${model.label} from the list`}
                className="seat-remove"
                disabled={disabled}
                onClick={() => remove(model.id)}
                type="button"
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button className="seat-add" disabled={disabled} onClick={openCatalog} type="button">
          + Add a model
        </button>
      </div>
      <p className="seat-hint">
        Click to seat or unseat · {seated} of {MAX_MODELS} seats filled (at least {MIN_MODELS})
      </p>

      <dialog aria-labelledby="catalog-title" className="room-dialog room-dialog-wide" ref={dialogRef}>
        <h2 id="catalog-title">Invite a model</h2>
        <p>
          Every OpenRouter model that can run on a zero-data-retention route, so it keeps
          no copy of your conversation. Models that store or train on data aren&apos;t listed.
          Prices are per million tokens (input / output), from OpenRouter&apos;s list.
        </p>
        <input
          aria-label="Search models"
          autoFocus
          className="text-input"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search: claude, llama, mistral, qwen…"
          type="search"
          value={search}
        />
        {catalogError && <p className="form-error">{catalogError}</p>}
        {!catalog && !catalogError && <p className="dialog-note">Loading OpenRouter&apos;s list…</p>}
        <ul className="catalog-list">
          {matches.map((model) => (
            <li key={model.id}>
              <button onClick={() => add(model)} type="button">
                <span>
                  <strong>{model.label}</strong> <small>{model.vendor}</small>
                  <code>{model.id}</code>
                </span>
                <span className="catalog-price">
                  {price(model.promptPrice)} / {price(model.completionPrice)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {catalog && !matches.length && <p className="dialog-note">No models match that search.</p>}
        <div className="dialog-actions">
          <span />
          <button className="pill-button" onClick={() => dialogRef.current?.close()} type="button">
            Close
          </button>
        </div>
      </dialog>
    </div>
  );
}
