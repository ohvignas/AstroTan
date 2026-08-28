# AGENTS.md

AstroTan is a template for a marketing site with a small CMS: a public Astro
site (`apps/web`), a TanStack Start dashboard (`apps/admin`), and a shared
Convex backend (`packages/backend`), shipped as Docker images to a single VPS
behind Traefik.

An adopter clones it, points it at their own Convex deployment, GitHub
repository, domains and VPS, then writes pages as `.astro` files. The
dashboard controls publication, SEO and access — never page content.

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

Steps 2 to 4 below are `pnpm bootstrap` (`scripts/bootstrap.mjs`). It is the
only place that knows all of the configuration at once, because the three
destinations cannot read each other.

```bash
pnpm bootstrap --dry-run   # creates .env.deploy, then shows every action
$EDITOR .env.deploy        # the ONLY file a human fills in
pnpm bootstrap             # distributes
```

Flags: `--dry-run` (writes nothing, calls neither `gh` nor `convex`),
`--skip-convex`, `--skip-github`, `--help`. Every step announces itself and
is skipped, loudly, when its prerequisite is missing (`gh` absent or not
authenticated, `node_modules` not installed). The script never prints a
secret's value — state, length and a short SHA-256 fingerprint only.

An agent may run it: nothing in it is interactive. `npx convex dev` in step 1
still is, and still must be left to the human.

1. **Create the Convex deployment.** Run `npx convex dev` from
   `packages/backend` in a real terminal (it is interactive, see Environment
   below) and let it create the project, or create it in the Convex
   dashboard. Note the `*.convex.cloud` and `*.convex.site` URLs, and
   generate a production deploy key (Settings → Deploy keys).
2. **The Convex deployment's own variables** — `BETTER_AUTH_SECRET`,
   `SITE_URL`, `WEB_SITE_URL`, `PREVIEW_SECRET`, `REVALIDATE_SECRET`,
   `RESEND_API_KEY`, `RESEND_TEST_MODE` — posted by `convex env set`, value
   on stdin. Each is documented in
   [`packages/backend/.env.example`](packages/backend/.env.example), which
   stays authoritative. An empty `RESEND_API_KEY` is not posted at all, and
   the script says so.
3. **The app-side variables for local development**: `apps/web/.env.local` and
   `apps/admin/.env.local`, written from the matching `.env.example` (that is
   the filename those examples ask for, and the one Vite and Astro load last,
   so a generated `.env` would be shadowed by any `.env.local` already there). Their Convex
   URLs stay at the local defaults on purpose — `.env.deploy` carries the
   *production* URLs, and pointing `pnpm dev` at production is not what step
   1 built you. `PREVIEW_SECRET` and `REVALIDATE_SECRET` are injected: they
   must be byte-identical to the Convex deployment's, being HMAC keys checked
   on both sides of a boundary, not passwords.
4. **The nine GitHub Actions secrets**, posted by `gh secret set --repo
   <owner/name>`, value on stdin. `--repo` is mandatory here: a fresh clone
   of this template usually has no git remote, and without it `gh` fails on
   "no git remote found". The name comes from `GITHUB_REPOSITORY` in
   `.env.deploy` — the script never guesses it. Two of the nine are files
   rather than typed values: `VPS_SSH_KEY` (read from `VPS_SSH_KEY_PATH`) and
   `VPS_SSH_KNOWN_HOSTS` (from `ssh-keyscan -H`, announced before it runs).
   `docker/README.md` §7 lists all nine and where each comes from.

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
