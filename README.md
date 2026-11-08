# TheRoom

This repository contains TheRoom, the separate hosted application being built to bring a multi-model discussion experience to `thediscussion.app` (formerly `theroom.click`, which now redirects there). It is not the existing Room of Models site at RoomOfModels.site.

The `/room` guest experience sends requests directly from the browser to OpenRouter using a key held only in page memory; OpenRouter forwards prompts and discussion turns to the selected model providers, and bills the account for the supplied key. Guest transcripts are not saved to an account and can be downloaded.

The default guest lineup is Claude Haiku 5.5, GPT-6 Luna, GPT-5.4 Mini, Gemini 3.8 Flash, and DeepSeek V4.1 Flash. OpenRouter may retry a model-routing/provider error with GLM-5.3 Flash. Keep data-training and prompt-publishing opt-ins disabled. Both Room implementations require ZDR endpoints for every selected model and the fallback. OpenRouter's provider and model privacy policies still apply; do not treat ZDR routing as a guarantee that all processing is private.

## The Discussion Room

A run has four parts. The full design is in the Discussion Room spec.

1. **Blind round.** Each seat answers alone. The answer appears on its card as live "thinking aloud" text, in the seat's own typeface and with its own marks (bold, italic, small and struck-out words; see `src/lib/thinking.ts`). It is never read aloud. Each seat uses it afterwards as private notes, and it stays in the written record.
2. **The host opens.** The house host (`HOST` in `src/lib/guest-room.ts`) is never seated. It reads everyone's notes, picks a tone (playful, mixed or serious), and asks an open question of the seat whose notes hold the least obvious idea. Chase still cuts in with his one-liner first.
3. **The conversation.** Seats answer, carry ideas past their notes, raise hands and break in, all under shared house rules (yes-and, callbacks, an arc, teaching by discovery, depth). The host steps back in every few turns and whenever the room goes quiet. Turns that read their notes aloud, and host questions that give a finding away, are rewritten once (`isRecitation`, `isSpoiler` in `src/lib/floor.ts`).
4. **Synthesis and parting thoughts**, as before. The outside judge also reports how far past the obvious the room got.

**Host audition.** The host's model is `HOST_MODEL_ID`, a stand-in. To try another, open `/?host=<OpenRouter model id>` (it must have a zero-data-retention route). Each scored run records which model hosted, and "All your discussions" on the scorecard ranks the hosts once more than one has been tried.

**News ticker.** `/api/ticker` reads a few public feeds (`FEEDS` in `src/lib/ticker.ts`) at most once an hour and has a low-cost model rewrite each story as a short question in its own words, with a summary. A click fills the question box and attaches the summary and link, because the models don't know today's news. It needs `OPENROUTER_TICKER_KEY` (and optionally `TICKER_MODEL`) as server-side secrets; without the key the ticker stays hidden. This is the one place the app calls a model from its own server. Confirm each feed's terms before launch; AP and Fix the News are left out until licensed.

## Local development

Requirements: Node.js 22 and npm.

Install dependencies if needed:

```bash
npm ci
```

Choose one Supabase target:

### Isolated local Supabase

This runs a separate local database and requires Docker Desktop or Podman:

```bash
cp .env.example .env.local
npx supabase start
npx supabase status
```

Copy the local API URL and publishable key from `supabase status` into `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-local-publishable-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then reset the local database and start Next.js:

```bash
npx supabase db reset
npm run dev
```

The local Supabase Studio is available at `http://127.0.0.1:54323`. With local email confirmation enabled, inspect the local mail catcher shown by `npx supabase status` to complete signup.

### Existing hosted Supabase project

To run only the Next.js app against an existing hosted project, set that project's Project URL and publishable key in `.env.local`, and set `NEXT_PUBLIC_SITE_URL=http://localhost:3000`. Then run `npm run dev`; do not run `supabase start`, `db reset`, or `db push` for this mode. The app will read and write to the hosted project, so use only synthetic or explicitly non-confidential test information until provider, operational-log, backup, and deletion disclosures are approved. Do not paste keys into chat or commit `.env.local`.

Without Supabase credentials, the landing page remains viewable, but account access is disabled. Do not put a Supabase service-role key or model-provider key in `.env.local` or any `NEXT_PUBLIC_` variable.

## Remembered provider credentials

Remembered provider keys are encrypted in the application before they are stored. The key-connections page stays disabled unless `PROVIDER_CREDENTIALS_ENABLED=true`. Enable it only after its migration is applied to the matching non-production database and the encryption keyring is configured. Set `PROVIDER_CREDENTIAL_ENCRYPTION_KEYS` and `PROVIDER_CREDENTIAL_ENCRYPTION_ACTIVE_KEY_ID` only as server-side secrets in the matching Vercel environment. Each keyring value must be a base64-encoded 32-byte key; generate a different key for every environment with `openssl rand -base64 32`. Keep old key versions configured until every credential encrypted with them has been re-encrypted. Never put these variables in a `NEXT_PUBLIC_` setting or commit their values.

Do not save provider credentials from a local app connected to a production Supabase project. Configure a separate development Supabase project and a distinct local encryption key first. The encryption settings are optional for guest sessions and required only for the remembered-key feature.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx supabase test db
```

`npm run test:db` is a convenience alias for the final command. Supabase CLI and Docker are needed for local database migrations and pgTAP tests.

`npm test` also starts an embedded PostgreSQL instance, applies the migration, and exercises the RLS policies without Docker. `npx supabase test db` is an additional integration check against the configured local Supabase stack.

## Supabase and Vercel setup

1. Create separate Supabase projects for development, preview, and production.
2. Link a project with the Supabase CLI and apply reviewed migrations with `npx supabase db push`; do not use an unreviewed dashboard schema edit as the source of truth.
3. Configure Auth's site URL and allowed redirect URLs for the deployed origin and `/auth/callback`.
4. In Vercel, use this repository root as the project root directory and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL` separately for each environment.
5. Never expose the Supabase service-role key to the browser. Stage 1 uses user-scoped clients and RLS.

## Stage 1 boundary

The hosted foundation covers Auth integration, profiles, workspaces, memberships, projects, conversations, and workspace RLS. The guest `/room` page runs browser-to-OpenRouter discussions, but does not persist transcripts to workspace conversations. It does not accept uploads. Saved workspace records are intended to persist until users delete them. Before using confidential client material, finish and disclose operational-log/backup retention, provider data handling, and deletion expectations.

The guest `/room` MVP does run model discussions directly from the browser through OpenRouter with a user-supplied key. The Room does not receive that key or proxy the model request. Account-based run persistence, server-side provider calls, secure stored credentials, and the durable multi-stage workflow are not implemented. The Room does not fund model usage; OpenRouter bills the key owner.
