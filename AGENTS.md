# AGENTS.md

AstroTan is a template for a marketing site with a small CMS: a public Astro
site (`apps/web`), a TanStack Start dashboard (`apps/admin`), and a shared
Convex backend (`packages/backend`), shipped as Docker images to a single VPS
behind Traefik.

An adopter clones it, points it at their own Convex deployment, GitHub
repository, domains and VPS, then writes pages as `.astro` files. The
dashboard controls publication, SEO and access — never page content.

**This is a template, and that changes what "done" means.** Nobody deploys
AstroTan; people install it, each on their own infrastructure. Every
unguided manual step is a step *every* adopter repeats — and several get
wrong. A feature shipped with "just run this command" is not shipped: it is
pending, and it will be pending for everyone at once.

So a task is only finished when the wiring lives somewhere that acts on its
own: generated or asked for in `scripts/bootstrap.mjs`; guarded by
`scripts/check-env-wiring.mjs` when the wiring has several links and one can
go missing; a build that fails when a build-time value is absent or
malformed; a container that refuses to start when a runtime value diverges
from the one frozen at build (the failure then lands during deploy, where
rollback exists); or a dashboard screen when the value is the adopter's own
and changes later. A README line is none of these — it describes wiring
without being any.

What stays manual by nature — legal notices, the processing registry, the
company identity — does not escape the rule, it moves it: what holds it is a
guard that refuses to publish the example values, not a documentation page.
A site that goes live with AstroTan named as data controller is a defect of
the template, not a mistake by the adopter.

Companion files: [`CLAUDE.md`](CLAUDE.md) (project conventions and
invariants, in French), [`docker/README.md`](docker/README.md) (the operations
runbook — the authority on everything VPS, DNS, certificates and rollback),
and `docs/superpowers/specs/2026-08-27-astrotan-design.md` (the architecture
spec: data model, security invariants, cache strategy, rollback procedure).

## Commands

Node 22.x, pnpm 10.34.5 (pinned by `packageManager`; do not upgrade pnpm
casually — see `docker/README.md` §11). pnpm workspaces + Turborepo.

```bash
corepack enable            # provides the pinned pnpm; assumes Node <= 24
pnpm install               # --frozen-lockfile in CI
pnpm bootstrap             # one-time: distribute .env.deploy (see below)

pnpm dev                   # all apps: web on :4321, admin on :3001
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm codegen               # asserts convex/_generated is present; never pushes
```

Per package, when you only need one:

```bash
pnpm --filter @astrotan/web   dev|build|preview|typecheck|lint|test
pnpm --filter @astrotan/admin dev|build|preview|start|typecheck|lint|test|format|check
pnpm --filter @astrotan/backend codegen|typecheck|lint|test|test:e2e
```

`typecheck`, `lint`, `test` and `build` all depend on `^codegen`, which only
*checks* that `packages/backend/convex/_generated` exists. On a cold clone
with a missing or stale `_generated`, regenerate it with a real
`npx convex dev --once` against a running deployment before anything else.

## First-time setup

Steps 2 to 4, and step 9, are `pnpm bootstrap` (`scripts/bootstrap.mjs`). It
is the only place that knows all of the configuration at once, because the
three destinations cannot read each other. It is replayable by design, and
step 9 is that design being used: the two things it cannot do before the
first `convex deploy` are done by running it a second time.

```bash
pnpm bootstrap --dry-run   # creates .env.deploy, then shows every action
$EDITOR .env.deploy        # the ONLY file a human fills in
pnpm bootstrap             # distributes
```

Flags: `--dry-run` (writes nothing, calls neither `gh` nor `convex`),
`--skip-convex`, `--skip-github`, `--skip-seed`, `--skip-invite`, `--help`.
Every step announces itself and is skipped, loudly, when its prerequisite is
missing (`gh` absent or not authenticated, `node_modules` not installed).
The script never prints a secret's value — state, length and a short SHA-256
fingerprint only. The one exception is the first account's invitation link,
which has no purpose unless a human reads it, and which grants nothing the
deploy key in hand does not already grant.

An agent may run it, and nothing in it ever blocks. It asks one question —
the first account's address — only when `stdin` is a TTY and `/dev/tty` can
be opened; otherwise it keeps the default (`ADMIN_EMAIL`, else `ACME_EMAIL`)
and says which one it took. `npx convex dev` in step 1 is still interactive,
and still must be left to the human.

1. **Create the Convex deployment.** Run `npx convex dev` from
   `packages/backend` in a real terminal (it is interactive, see Environment
   below) and let it create the project, or create it in the Convex
   dashboard. Note the `*.convex.cloud` and `*.convex.site` URLs, and
   generate a production deploy key (Settings → Deploy keys).
2. **The Convex deployment's own variables** — `BETTER_AUTH_SECRET`,
   `SITE_URL`, `WEB_SITE_URL`, `PREVIEW_SECRET`, `REVALIDATE_SECRET`,
   `LEAD_SUBMIT_SECRET`, `CONSENT_LOG_SECRET`, `SECRETS_KEY`,
   `RESEND_API_KEY`, `RESEND_TEST_MODE` — posted by `convex env set`, value
   on stdin. Each is documented in
   [`packages/backend/.env.example`](packages/backend/.env.example), which
   stays authoritative, and `scripts/check-env-wiring.mjs` fails when
   `packages/backend/convex/` reads one that file does not document. An
   empty `RESEND_API_KEY` is not posted at all, and the script says so.
   `SECRETS_KEY` is the master key for tokens typed into the dashboard:
   without it the whole `secrets` family is inert — the refusal is clean,
   but `/settings/mesure` and `/settings/ia` do nothing.
3. **The app-side variables for local development**: `apps/web/.env.local` and
   `apps/admin/.env.local`, written from the matching `.env.example` (that is
   the filename those examples ask for, and the one Vite and Astro load last,
   so a generated `.env` would be shadowed by any `.env.local` already there). Their Convex
   URLs stay at the local defaults on purpose — `.env.deploy` carries the
   *production* URLs, and pointing `pnpm dev` at production is not what step
   1 built you. `PREVIEW_SECRET` and `REVALIDATE_SECRET` are injected: they
   must be byte-identical to the Convex deployment's, being HMAC keys checked
   on both sides of a boundary, not passwords.
4. **The GitHub Actions secrets**, posted by `gh secret set --repo
   <owner/name>`, value on stdin. `--repo` is mandatory here: a fresh clone
   of this template usually has no git remote, and without it `gh` fails on
   "no git remote found". The name comes from `GITHUB_REPOSITORY` in
   `.env.deploy` — the script never guesses it. Two of them are files
   rather than typed values: `VPS_SSH_KEY` (read from `VPS_SSH_KEY_PATH`) and
   `VPS_SSH_KNOWN_HOSTS` (from `ssh-keyscan -H`, announced before it runs).
   `docker/README.md` §7 is authoritative on the list and on where each
   value comes from. Five build-time `PUBLIC_*` are deliberately left out —
   `PUBLIC_UMAMI_URL`, `PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_UMAMI_RECORDER`,
   `PUBLIC_META_PIXEL_ID`, `PUBLIC_GOOGLE_TAG_ID`: none of those values
   exists before a human has opened Umami or an advertiser's console, and
   their absence costs measurement, never a build.

What the script cannot do, and prints as a reminder with its runbook section:

5. **Prepare the VPS and GHCR**: `docker/README.md` §1 (Docker, non-root
   user, ports) and §2 (GHCR packages are private by default — decide
   public-vs-`docker login` *before* the first deploy, it is a blocking
   prerequisite).
6. **Point DNS at the VPS**, and check for a proxy in front of it:
   `docker/README.md` §3. A Cloudflare orange cloud breaks the HTTP-01
   challenge.
7. **Fill `~/astrotan/.env` on the VPS**: `pnpm bootstrap` writes `.env.vps`,
   ready to copy, and prints the `scp` and `chmod 600` commands. It does not
   connect to the VPS itself — that file is the one thing the deploy pipeline
   never overwrites (`rsync --exclude '.env'`), which is what makes it the
   machine's own source of truth. `docker/README.md` §4;
   [`docker/.env.example`](docker/.env.example) documents each variable.
8. **First deploy**: use the Let's Encrypt **staging** CA first
   (`docker/README.md` §5 — the production CA allows 5 certificates per
   7 days and a botched first attempt costs a week; `.env.vps` ships the
   `ACME_CA_SERVER` line commented, ready to uncomment), then push to `main`
   and let the `Deploy` workflow run (§8).

Then back to the script, one last time:

9. **Run `pnpm bootstrap` again**, once, after that first deploy. Nothing to
   edit and no secret is re-posted; the two steps below simply needed the
   functions to exist, and `convex deploy` (step 1 of the `Deploy` workflow)
   is what puts them there. Without them a deployment whose pipeline is
   green and whose containers are `healthy` is unusable:
   - `seed:demoContent` creates the `pages` rows. Despite the name it is not
     decoration: it is the only code in the repository that creates them,
     and **without them every URL answers 404**, `/` included. A page is a
     pair — its `.astro` file *and* its row. Idempotent by slug.
   - `bootstrap:createInvitation` issues the first account's invitation,
     with `role: "owner"`. Access is invitation-only (`disableSignUp: true`,
     no OAuth), so **without it nobody can get in**. `owner` and never
     `admin`: `invitations.create` refuses `role: "owner"` for every actor,
     and an admin may not invite, promote, demote or remove another admin —
     a deployment whose first account is an admin never has an owner and
     stays capped at one administrator, with no way out through the UI. Not
     idempotent, so the script reads `bootstrap:owners` first and skips when
     an owner already exists, rather than minting a link that will be
     refused at acceptance time. Open the printed
     `/accept-invite?token=…` link and choose a password on the ordinary
     page; no password ever passes through the script or a shell history.

Rollback: `docker/README.md` §9. Schema changes: expand → migrate →
contract, §10.

`.env.deploy`, `.env.vps` and the two app `.env` files are gitignored and
written `0600`. `.env.deploy.example` is the only one of the five that is
committed.

## Invariants — never break these

One line each; the reasoning is in [`CLAUDE.md`](CLAUDE.md).

1. `apps/web` holds no Convex admin key and no session; every public query
   filters `status === "published"` server-side.
2. Preview queries are a separate function family, guarded by an expiring
   HMAC token verified twice — in Astro, then again in Convex.
3. Every Convex mutation re-checks permissions. The UI hides; it does not
   decide.
4. The role lives on the Better Auth user, never duplicated app-side.
5. The database carries no page content. A page *is* its `.astro` file; the
   `pages` row carries only slug, title, status, `seo` and `geo`.
6. No destructive schema change in a single deployment — expand / migrate /
   contract.
7. A rollback replays the whole pipeline at a sha, never the images alone.
8. A secret lives in exactly one of three places, never anywhere else: a
   `PUBLIC_*` frozen AT BUILD time (so visible to everyone), a container
   `process.env` read at runtime, or the Convex environment. A token entered
   from the dashboard is encrypted with a master key that itself lives in the
   Convex environment — never in plaintext, and never in the `settings`
   table, whose `get` query is public. Reasoning and sources:
   `docs/superpowers/specs/2026-08-29-secrets-et-chiffrement.md`.
9. No third-party tag is ever written into the HTML. A tag that stores
   something on the visitor's device, or identifies them, is declared in
   `apps/web/src/lib/consent.ts` and injected only after an answer. Adding
   one means bumping `consentVersion` in `apps/web/src/config/consent.ts`,
   otherwise people will have "accepted" a third party that did not exist
   when they clicked. Skill: `consent-rgpd`.

## Environment gotchas

Read these before running anything.

- **`convex dev` requires an interactive terminal.** An agent must never
  launch it — it will hang. Ask the human to run it and report the output.
  The same applies to the first `npx convex dev` that creates a project.
- **`packages/backend/convex/_generated/` is committed.** Regenerate it with
  a real `npx convex dev --once`; never hand-edit it. A manual edit that
  "looks right" diverges silently.
- **Every simply-named file under `packages/backend/convex/` is a deployment
  entry point.** The Convex bundler analyses it on push. Only two-dot names
  (`*.test.ts`) are excluded — so test helpers and fixtures live in
  `packages/backend/testing/`, outside `convex/`. A fixture placed under
  `convex/` once broke deployment with `TypeError: import.meta unsupported`
  while tests and typecheck stayed green.
- **`tsc` and vitest do not see what the Convex runtime rejects.** After
  changing anything under `convex/`, a real `npx convex dev --once` is the
  only proof the change deploys.
- **Do not write API calls for this stack from memory.** Astro 7, TanStack
  Start 1 and `@convex-dev/better-auth` move fast; check the MCP servers
  listed in `CLAUDE.md` (`astro-docs`, `convex-docs`, `better-auth`).
- **Never add TanStack Query or TanStack DB.** Convex is already the
  reactive data layer; a second cache in front of it creates two sources of
  truth about freshness.
- **Adding a page means writing `apps/web/src/pages/<slug>.astro`**, plus a
  `pages` row for its slug and status — there is no content model to fill in
  and nothing else to wire up. `CLAUDE.md` has the three lines to copy at the
  top of the file.

## Conventions

- TDD: failing test, minimal implementation, passing test, commit.
- Commit messages in English, Conventional Commits.
- Prose in the repository (comments, docs, `docker/README.md`) is French;
  this file is English because it is read by third-party tools.
