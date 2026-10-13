# TheRoom

This repository contains TheRoom, the separate hosted application being built to bring a multi-model discussion experience to `theroom.click`. It is not the existing Room of Models site at RoomOfModels.site.

The `/room` guest experience sends requests directly from the browser to OpenRouter using a key held only in page memory; OpenRouter forwards prompts and discussion turns to the selected model providers, and bills the account for the supplied key. Guest transcripts are not saved to an account and can be downloaded.

The default guest lineup is Claude Haiku 5.5, GPT-6 Luna, GPT-5.4 Mini, Gemini 3.8 Flash, and DeepSeek V4.1 Flash. OpenRouter may retry a model-routing/provider error with GLM-5.3 Flash. Keep data-training and prompt-publishing opt-ins disabled. Both Room implementations require ZDR endpoints for every selected model and the fallback. OpenRouter's provider and model privacy policies still apply; do not treat ZDR routing as a guarantee that all processing is private.

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
