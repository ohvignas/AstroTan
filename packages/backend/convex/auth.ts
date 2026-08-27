import { betterAuth, type BetterAuthOptions } from "better-auth/minimal"
import { admin } from "better-auth/plugins"
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api"
import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/admin/access"
import { convex } from "@convex-dev/better-auth/plugins"
import { createClient, type GenericCtx } from "@convex-dev/better-auth"
import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import authSchema from "./betterAuth/schema"
import authConfig from "./auth.config"
import { parseRole } from "./validators"
import { assertOwnerInvariant, OwnerInvariantError } from "./lib/ownerGuard"

// La synchronisation `profiles` <-> utilisateur Better Auth passe par les
// `triggers` du composant, pas par une mutation `ensure` appelée à la
// main : `triggers.user.onCreate/onUpdate/onDelete` ci-dessous, câblés au
// composant via `authFunctions` (les mêmes `onCreate`/`onUpdate`/`onDelete`
// que ce module exporte plus bas via `triggersApi()`) et
// `local.schema.user` (le modèle "user" du schéma Better Auth local).
// Vérifié contre `@convex-dev/better-auth@0.12.5` installé
// (`src/client/create-api.ts` et `src/client/adapter.ts`) plutôt qu'écrit
// de mémoire : le composant n'appelle le handle de trigger que si *les
// deux* `config.authFunctions.onCreate` et `config.triggers.user.onCreate`
// sont renseignés (idem update/delete) — omettre `authFunctions` ferait
// que `triggers` ci-dessous ne se déclenche jamais, silencieusement.
//
// `onCreate` (ci-dessous) appelle `authComponent.setUserId(...)`, donc
// l'initialiseur de `authComponent` se référence lui-même — TS7022
// (`implicitly has type 'any'` dans sa propre initialisation) sans
// annotation de type explicite. L'expression d'instanciation
// `typeof createClient<...>` calcule le type retourné sans réévaluer la
// valeur, ce qui casse le cycle : le type de `authComponent` ne dépend
// plus de `authComponent` lui-même.
type AuthComponent = ReturnType<typeof createClient<DataModel, typeof authSchema>>

export const authComponent: AuthComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    authFunctions: internal.auth,
    local: { schema: authSchema },
    triggers: {
      user: {
        // `setUserId` est la liaison officielle *composant -> application*
        // (le document Better Auth `user` porte désormais `userId` =
        // l'id du profil applicatif) ; l'index `by_auth_user` sur
        // `profiles` est la liaison inverse *application -> composant*.
        // Les deux sont conservées : elles servent des directions
        // différentes (`requireRole`/la liste des utilisateurs lisent via
        // l'index ; `setUserId` est ce que Better Auth expose comme
        // référence croisée officielle), ni l'une ni l'autre ne remplace
        // l'autre.
        //
        // Délègue la création à `internal.profiles.ensure` plutôt que
        // d'insérer directement : le brief le dit explicitement, "le hook
        // peut rejouer", et un `ctx.db.insert` nu ici ne serait pas
        // idempotent — `by_auth_user` est un index ordinaire, pas unique,
        // donc rien au niveau stockage n'empêcherait un doublon, et un
        // doublon fait lever `.unique()` dans `me`/`updateMine`/`onUpdate`/
        // `onDelete`, ce qui briquerait cet utilisateur. `ensure` fait le
        // lookup-avant-insert une seule fois ; `onCreate` ne le duplique
        // pas.
        onCreate: async (ctx, authUser) => {
          const profileId = await ctx.runMutation(internal.profiles.ensure, {
            authUserId: authUser._id,
            displayName: authUser.name ?? authUser.email,
          })
          await authComponent.setUserId(ctx, authUser._id, profileId)
        },
        // Ne synchronise plus `displayName` depuis `user.name` : une fois
        // qu'un utilisateur choisit son nom affiché via `updateMine`,
        // c'est *son* choix, pas celui de Better Auth — les laisser
        // diverger est correct, pas un oubli. Un admin qui renomme
        // quelqu'un via `/admin/update-user` ne doit pas écraser
        // silencieusement ce que cette personne a choisi d'afficher.
        //
        // À la place, `onUpdate` est le chemin de réparation : c'est le
        // hook qui se déclenche à *chaque* écriture Better Auth sur cet
        // utilisateur (rôle, ban, mot de passe, nom, tout), donc c'est
        // l'endroit naturel pour recréer un profil manquant si l'invariant
        // "un profil par utilisateur" a été rompu (ligne supprimée
        // manuellement, bug d'un chemin futur, …) — plutôt que de laisser
        // ça invisible jusqu'à ce que `me`/`updateMine` lève NOT_FOUND.
        // Corps identique à `onCreate` : même lookup-via-`ensure`, même
        // `setUserId`.
        onUpdate: async (ctx, newUser, _oldUser) => {
          const existing = await ctx.db
            .query("profiles")
            .withIndex("by_auth_user", (q) => q.eq("authUserId", newUser._id))
            .unique()
          if (existing) return
          const profileId = await ctx.runMutation(internal.profiles.ensure, {
            authUserId: newUser._id,
            displayName: newUser.name ?? newUser.email,
          })
          await authComponent.setUserId(ctx, newUser._id, profileId)
        },
        // Le profil suit le cycle de vie de son utilisateur : supprimé
        // avec lui, jamais orphelin.
        onDelete: async (ctx, authUser) => {
          const profile = await ctx.db
            .query("profiles")
            .withIndex("by_auth_user", (q) => q.eq("authUserId", authUser._id))
            .unique()
          if (profile) await ctx.db.delete(profile._id)
        },
      },
    },
  },
)

// Obligatoire : sans cet export, les callbacks `triggers` ci-dessus ne
// sont jamais câblés à un point d'entrée Convex réel — `authFunctions`
// pointe vers `internal.auth.onCreate/onUpdate/onDelete`, qui n'existent
// que parce qu'ils sont exportés ici.
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi()

// `defaultStatements` (from better-auth@1.6.17's admin plugin):
//   user: ["create", "list", "set-role", "ban", "impersonate",
//          "impersonate-admins", "delete", "set-password", "set-email",
//          "get", "update"]
//   session: ["list", "revoke", "delete"]
const ac = createAccessControl(defaultStatements)

// `impersonate` (and its `impersonate-admins` variant) is withheld from
// every role, owner included: a CMS back-office has no legitimate need to
// mint a session as another user, and granting it to any admin role would
// let that admin become the owner in all but name.
// `user:create` withheld here too (Task 8 review round 2, item 4), not
// just on `adminRole` (round 1, I4): `/admin/create-user` has no password
// floor of its own on this version of better-auth — `createUserBodySchema`
// declares `password: z.string().optional()` with no length bound, and the
// password is handled entirely *outside* `internalAdapter.createUser`
// (`routes.mjs`'s handler links the credential account itself, via
// `ctx.context.password.hash` + `internalAdapter.linkAccount`, *after*
// `createUser` returns), so `databaseHooks.user.create.before` — which
// only ever sees the arguments `createUser` itself receives — never even
// observes `password` and cannot validate it. With `adminRole` alone
// closed, the owner was still the one principal who could reach this
// route directly, with the exact C1 failure `invitations.accept` guards
// against (an empty password silently skips linking a credential account
// at all; a one-character password creates a fully working account).
// Patching a floor onto better-auth's own route isn't available without
// forking it; removing the permission is. `invitations.accept` is
// unaffected — verified in round 1's I4 note above: it calls
// `auth.api.createUser` with neither `headers` nor `request`, which skips
// every `hasPermission` check in that endpoint regardless of what any role
// grants. The owner now invites like everyone else.
const ownerRole = ac.newRole({
  user: ["list", "set-role", "ban", "delete", "set-password", "set-email", "get", "update"],
  session: ["list", "revoke", "delete"],
})

// `admin` gets user list/set-role/ban/get/update/delete — Task 10's
// user-management screen needs to list, edit and remove users, and
// `set-role` is what lets an admin change (never to `owner`) an existing
// user's role. Withheld: `impersonate`/`impersonate-admins` (nobody gets
// these, see ownerRole above) and `set-password`, which stays owner-only —
// it is the only account-recovery path until password reset by email
// exists, and letting an admin take over an owner's account would hollow
// out the single-owner invariant. Granting `user:delete` here is safe, not
// a loosening: plugin permissions gate whether the endpoint runs at all,
// and Task 6's databaseHooks guard independently prevents anyone —
// including an admin — from touching an owner. Two separate barriers doing
// two separate jobs.
//
// `user:create` is deliberately absent (Task 8 review, I4): granting it
// made `/admin/create-user` a second, parallel account-creation path open
// to every admin — no invitation token, no expiry, no `invitations` row,
// no `invitedBy`, and a password the admin picks themselves — which made
// Task 8's stated invariant ("an invitation is the *only* way an account
// comes into existence") simply false, restated by the databaseHooks
// owner-check rather than actually true. `ownerRole` keeps `user:create`;
// `invitations.accept` (Task 8) still works without it on `adminRole`
// because it calls `auth.api.createUser` with neither `headers` nor
// `request` — `routes.mjs`'s own `if (!session && (ctx.request ||
// ctx.headers)) throw UNAUTHORIZED` is skipped when both are absent, and
// every `hasPermission` check inside that endpoint is itself gated on
// `if (session) {...}`, so a session-less call never consults `adminRole`
// (or any role) at all. Task 10 invites rather than creates, from here on.
//
// `session: ["list"]` is deliberately *not* granted here (round 4, item
// B), unlike the rest of this role's otherwise-full CRUD-ish surface.
// `/admin/list-user-sessions` returns each session's raw `token`
// (`parseSessionOutput` doesn't strip it — nothing in this schema marks
// it output:false), and the bearer plugin this app installs
// (`plugins/convex/index.ts`, via `convex()`) is constructed with no
// `requireSignature` option, so it accepts an unsigned bearer token and
// signs it with the server secret on the caller's behalf. Measured
// end-to-end: an admin lists the owner's sessions, takes the raw token,
// authenticates as the owner with `Authorization: Bearer <token>`, and
// from there calls `/admin/set-user-password` — an owner-only permission
// — successfully. That's a full account takeover through a different
// door than `impersonate`, which is exactly why `impersonate` is withheld
// above; withholding one and granting the other was withholding nothing.
// `bearer({ requireSignature: true })` isn't reachable from app code
// here (the plugin is installed by `convex()`, not directly by us), so
// the only lever available is this permission. `session: ["revoke"]` and
// `["delete"]` stay: `revokeUserSession(s)` only ever *accept* a token or
// userId as input and return `{success: boolean}`, never a token, and no
// admin route in this plugin checks `session: ["delete"]` at all — there
// is nothing to leak either way.
//
// Consequence, stated plainly rather than left to be discovered: Task
// 10's admin-facing user-management screen cannot list a user's active
// sessions when the caller is an `admin` (only `owner` can). Deliberate
// loss, not an oversight — the alternative is this takeover.
const adminRole = ac.newRole({
  user: ["list", "set-role", "ban", "get", "update", "delete"],
  session: ["revoke", "delete"],
})

const editorRole = ac.newRole({
  user: [],
  session: [],
})

// Task 8 review, C1: better-auth's own default (`minPasswordLength`
// undefined -> its `8`/`128` default) was never made explicit, and the one
// route that matters most — `/admin/create-user`, verified in
// `routes.mjs`'s `createUserBodySchema` — declares `password:
// z.string().optional()` with *no length bound at all*; the shared
// `minPasswordLength`/`maxPasswordLength` option is only ever consulted by
// sign-up, `/update-user`'s own password change, and password reset, none
// of which `invitations.accept` goes through. An explicit policy here
// (rather than an inherited, easy-to-miss default) is what
// `invitations.ts`'s own check against these same two constants enforces
// on the one route that otherwise has no floor at all — see its comment
// for the two concrete exploits that gap allowed (an empty password
// leaves a permanently credential-less zombie account; a one-character
// password is a working admin account).
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

// Reads `secret`/`baseURL` plainly, with no guard: `createApi` (the
// component-side adapter, see betterAuth/adapter.ts) calls this at module
// load inside the betterAuth component's own isolated environment, which
// never sees the app deployment's env vars. The adapter only needs the
// *shape* of the options — schema and plugin list — never the secret, so
// it must tolerate an absent one. The guard lives in `createAuth` below,
// the actual auth server, mounted in http.ts on the app side where the
// vars do exist and where a missing secret would otherwise silently fall
// back to a publicly-known default constant.
export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.SITE_URL,
    database: authComponent.adapter(ctx), // requis — omis, rien ne persiste
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
    },
    plugins: [
      convex({ authConfig }),
      admin({
        ac,
        roles: { owner: ownerRole, admin: adminRole, editor: editorRole },
        adminRoles: ["owner", "admin"],
        defaultRole: "editor",
      }),
    ],
    // Enforces the single-owner invariant (see `lib/ownerGuard.ts`) at the
    // one layer every write to the `user` table traverses. The admin()
    // plugin exposes its own HTTP endpoints (`/admin/set-role`,
    // `/admin/create-user`, `/admin/update-user`, `/admin/ban-user`,
    // `/admin/remove-user`, …) that write directly through better-auth's
    // internal adapter — none of them go through a Convex mutation of
    // ours, so a guard placed in application code would be trivially
    // bypassable. `databaseHooks` runs inside better-auth's own
    // `createWithHooks`/`updateWithHooks`/`deleteWithHooks`
    // (`node_modules/better-auth/dist/db/with-hooks.mjs`), which every one
    // of those endpoints calls via `ctx.context.internalAdapter`, so this
    // is the one choke point that can't be routed around.
    //
    // Signature verified against the installed better-auth@1.6.17 (not
    // written from memory, per the task's instruction):
    // `@better-auth/core`'s `src/types/init-options.ts` declares
    // `user.update.before?: (user: Partial<User> & Record<string, unknown>,
    // context: GenericEndpointContext | null) => Promise<boolean | void |
    // { data: … }>` and `user.delete.before?: (user: User & Record<string,
    // unknown>, context: GenericEndpointContext | null) => Promise<boolean
    // | void>`. Two details only the *implementation*
    // (`dist/db/with-hooks.mjs`) reveals, and that the type alone doesn't:
    //   - `update.before`'s first argument is the raw **update delta**
    //     (e.g. `{ role: "owner" }`), never the full row and never the
    //     target id — `updateWithHooks(data, where, model)` passes `data`
    //     straight through, `where` never reaches the hook. The target id
    //     has to come from `context.body.userId` (every admin route that
    //     calls `internalAdapter.updateUser(userId, …)` puts it there)
    //     instead, with a session-id fallback for self-service updates
    //     that don't carry a `userId` body field.
    //   - `delete.before`, unlike `update.before`, DOES receive the full
    //     entity: `deleteWithHooks` fetches it via `findMany` before
    //     calling the hook specifically so `delete.before` hooks can see
    //     the row being removed.
    //   - `create.before` sees the *resolved* role, not the caller's raw
    //     input: `/admin/create-user`'s own handler already computes
    //     `role: requestedRole ?? opts.defaultRole` before ever calling
    //     `internalAdapter.createUser(...)`, so by the time any
    //     `create.before` hook runs, `data.role` is whatever the row will
    //     actually be created with.
    // Coexistence with the admin() plugin's own `databaseHooks.user.create
    // .before` (which applies `defaultRole`) verified in
    // `dist/context/helpers.mjs`'s `runPluginInit`: each plugin's `init()`
    // result can return `{ options: { databaseHooks } }`, and every one
    // found is pushed onto a `dbHooks` array tagged `source:
    // "plugin:<id>"`; *after* every plugin has run, `options.databaseHooks`
    // (ours, i.e. what's written here) is pushed last, tagged `source:
    // "user"`. `db/with-hooks.mjs`'s `createWithHooks`/`updateWithHooks`/
    // `deleteWithHooks` then iterate that whole array in order — plugin
    // hooks first, ours last — so this is additive, never a replacement of
    // admin()'s own hook.
    //
    // `context` is typed `GenericEndpointContext | null` and its shape
    // isn't precise enough to typecheck property access against (the
    // admin-plugin fields — `body.userId`, `context.session`,
    // `context.internalAdapter` — aren't part of the base `User`/context
    // types), so this reads through a narrow local shape instead of `any`
    // scattered through the body.
    databaseHooks: {
      user: {
        // C2: `/admin/create-user` honours an explicit `role` in its body
        // and performs no owner check of its own. Originally written
        // because an authenticated `admin` held the plugin's own `create`
        // permission and could call it directly with `role: "owner"` to
        // mint a second owner outright, entirely bypassing the
        // `update`/`delete` guards below (they only ever see a row that
        // already exists). Task 8's review (I4) removed `user:create` from
        // `adminRole` for a different reason (closing a parallel,
        // uninvited account-creation path), which incidentally closes that
        // *specific* route for `admin` too — but this hook is not made
        // redundant by that: `ownerRole` still holds `create`, and
        // `invitations.accept` (Task 8) calls `auth.api.createUser` with
        // neither `headers` nor `request`, which skips every
        // `hasPermission` check in that endpoint entirely (`if (session)
        // {...}` — see `adminRole`'s comment above) regardless of what any
        // role grants. A row inserted directly into the `invitations`
        // table with `role: "owner"` — bypassing `invitations.create`'s
        // own refusal, e.g. by a bug or a future write path — reaches
        // `createUser` with `role: "owner"` through exactly that
        // session-less call, and this hook is the only thing that still
        // stops it. `invitations.test.ts` seeds a real owner before
        // exercising that case, so the barrier looks unconditional there;
        // it is not — see the `owners > 0` check a few lines down.
        create: {
          before: guardOwnerInvariant(async (data, context) => {
            const raw = (data as Record<string, unknown>).role
            if (raw === undefined) return // no role requested: defaultRole applies, not this invariant's concern

            // C1 sub-requirement, round 2: reuses `parseRole` directly —
            // the exact rule the update path enforces on `nextRole` —
            // instead of the hand-rolled splitter this used to have
            // (`parts.includes("owner")`), which only refused a value
            // when one of its comma-joined components happened to parse
            // to "owner". `parseRole` only accepts a plain string that IS
            // one of the three known roles, so anything else — not a
            // string, multiple roles, an unknown role — is refused
            // *unconditionally* here, not just when it might contain
            // "owner". Two reasons that matters beyond the owner case
            // specifically:
            //  - `countOwners`'s `{field:"role", operator:"eq",
            //    value:"owner"}` filter is an exact match, blind to a
            //    stored `"owner,editor"` — the old splitter could let
            //    such a value through during the bootstrap window
            //    (`owners === 0`), and that row would then be invisible
            //    to every future owner-count check while still holding
            //    every `owner` permission via better-auth's own
            //    comma-split `hasPermission`.
            //  - any multi-role value at all (e.g. `role:
            //    ["admin","editor"]`, joined to `"admin,editor"` before
            //    this hook sees it) creates a row that `update`/
            //    `delete.before` can never classify again
            //    (`UNCLASSIFIABLE_TARGET_ROLE`) — a permanent zombie,
            //    unmodifiable and undeletable through the admin API.
            const role = parseRole(raw)
            if (role === null) {
              throw new OwnerInvariantError(
                "INVALID_ROLE: le rôle demandé n'est pas exactement un rôle connu",
              )
            }
            if (role !== "owner") return

            const internalAdapter = (context as OwnerHookEndpointContext | null)?.context
              ?.internalAdapter
            if (!internalAdapter) {
              throw new OwnerInvariantError(
                "CANNOT_VERIFY_OWNER_INVARIANT: création avec rôle owner sans contexte suffisant pour vérifier l'absence d'un owner existant",
              )
            }

            // `owners === 0` *is* the bootstrap condition — checking it
            // directly is safer than trying to infer "this is the very
            // first admin setup" from *how* the caller authenticated
            // (e.g. "no session at all"): a legitimate bootstrap script
            // and an attacker replaying a stolen admin session can look
            // identical under that heuristic. Exactly one owner, ever,
            // regardless of who's asking.
            //
            // NOT airtight, and no longer described as such (M3): this
            // read and the row creation that follows it, if this check
            // passes, are two separate Convex calls issued from an HTTP
            // action (a query here, then whatever `internalAdapter
            // .createUser` does after this hook returns) — not one atomic
            // transaction, so Convex's optimistic-concurrency control
            // doesn't span them. Two concurrent `/admin/create-user`
            // calls with `role: "owner"` during the bootstrap window
            // could both read `owners === 0` and both succeed, minting
            // two owners. Narrow — it only matters in the window before
            // any owner exists at all — and not closed by this hook;
            // closing it would mean not routing this check through
            // better-auth's per-operation adapter calls, which is a
            // bigger change than this fix round.
            const owners = await internalAdapter.countTotalUsers([
              { field: "role", operator: "eq", value: "owner" },
            ])
            if (owners > 0) {
              throw new OwnerInvariantError(
                "OWNER_ALREADY_EXISTS: un seul owner est autorisé, la création est refusée",
              )
            }
          }),
        },
        update: {
          before: guardOwnerInvariant(async (data, context) => {
            const ctx = context as OwnerHookEndpointContext | null
            const internalAdapter = ctx?.context?.internalAdapter
            // Self-service updates (e.g. a user editing their own name)
            // don't carry `userId` in the body — the session's own id is
            // the target in that case.
            const targetId = ctx?.body?.userId ?? ctx?.context?.session?.user?.id
            const rawNextRole = (data as Record<string, unknown>).role

            // M1, round 3 — round 2's "unconditional" was itself wrong,
            // and this is the corrected rule: refuse when the guard
            // cannot identify the target of a write *that names one*;
            // allow internal writes that name none.
            //
            // `update.before` never receives the write's own `where`
            // clause — verified again for this fix, not assumed:
            // `db/with-hooks.mjs`'s `updateWithHooks(data, where, model,
            // customUpdateFn)` only ever calls `toRun(data, context)`,
            // and `where` is passed straight to the adapter's own
            // `.update()` call, never to a hook. So there is no way to
            // read the *actual* target of the write here; body/session
            // is the only signal available, and it can be silent on
            // purpose. admin()'s own `databaseHooks.session.create
            // .before` (`admin.mjs`) clears an expired ban at sign-in by
            // calling `internalAdapter.updateUser(session.userId,
            // {banned: false, ...})` — at that moment `context.body` is
            // the sign-in request (`{email, password}`, no `userId`) and
            // `context.context.session` is still `null` (the session is
            // mid-creation), so `targetId` is `undefined`. Round 2's
            // unconditional throw fired here regardless, turning "your
            // ban expired" into "you are permanently locked out" — the
            // exact opposite of what that hook exists to do.
            //
            // The fix distinguishes "no target named" (`targetId ===
            // undefined`: allow, it's an internal write) from "a target
            // IS named but its shape can't be interpreted" (the actual
            // C3/M1 bypass — e.g. an array `userId`: refuse). An
            // attacker cannot forge the first case to smuggle a real
            // attack through it: every admin endpoint's own zod schema
            // requires `userId` in the body, so a call that omits it
            // entirely never reaches an admin endpoint's handler at all.
            //
            // Known, latent gap this does *not* close: `updateUserByEmail`
            // (used by email-verification flows) writes by `email`, not
            // by id — currently unreachable, since no
            // `sendVerificationEmail` is configured, but if it ever were,
            // this guard would still resolve `targetId` from body/session
            // rather than from the `email` the write is actually keyed
            // on, and could validate a *different* principal than the one
            // being written. Not fixable from inside this hook without
            // the `where` clause it doesn't receive; flagged rather than
            // silently left for a later commit to rediscover.
            if (targetId === undefined) return // no named target: internal write, not this invariant's concern

            if (typeof targetId !== "string" || !internalAdapter) {
              throw new OwnerInvariantError(
                "CANNOT_VERIFY_OWNER_INVARIANT: cible nommée mais non interprétable, mise à jour refusée par prudence",
              )
            }

            const targetUser = await internalAdapter.findUserById(targetId)
            if (!targetUser) return // NOT_FOUND is the endpoint's own concern

            assertOwnerInvariant({
              operation: "update",
              // Missing session -> `""`, which can never equal a real id,
              // so an unidentifiable actor fails closed against an owner
              // target (Check 1) exactly like a known-wrong actor would.
              actorId: ctx?.context?.session?.user?.id ?? "",
              actorRole: ctx?.context?.session?.user?.role,
              targetId,
              targetRole: targetUser.role,
              nextRole: rawNextRole === undefined ? targetUser.role : rawNextRole,
              // M2/C1: computed unconditionally, not gated on a local
              // "does this look like an owner?" pre-check. A gate here
              // has to reach the same role classification
              // `assertOwnerInvariant` reaches internally, and keeping
              // two independent classifications in sync is exactly how
              // the C1 bug happened — a comma-joined multi-role value
              // parsed to `null` at the gate (so the count was skipped
              // *and* the row was treated as non-owner) while
              // better-auth's own `hasPermission` still granted owner
              // permissions on the strength of the same string. This
              // endpoint isn't high-QPS; the extra query is worth not
              // having a second place to get the classification wrong.
              ownerCount: await internalAdapter.countTotalUsers([
                { field: "role", operator: "eq", value: "owner" },
              ]),
            })
          }),
        },
        delete: {
          before: guardOwnerInvariant(async (user, context) => {
            const ctx = context as OwnerHookEndpointContext | null
            const target = user as { id?: string; role?: string | null }
            const internalAdapter = ctx?.context?.internalAdapter

            if (typeof target.id !== "string" || !internalAdapter) {
              // Same fail-closed posture as the update path (M1):
              // better-auth's own `deleteWithHooks` only calls this hook
              // once it has already fetched the row being removed (see
              // the signature note above), so a missing id/adapter here
              // means something is wrong with the call, not that there's
              // nothing to check.
              throw new OwnerInvariantError(
                "CANNOT_VERIFY_OWNER_INVARIANT: suppression sans contexte suffisant pour vérifier l'invariant",
              )
            }

            assertOwnerInvariant({
              operation: "delete",
              actorId: ctx?.context?.session?.user?.id ?? "",
              actorRole: ctx?.context?.session?.user?.role,
              targetId: target.id,
              targetRole: target.role,
              nextRole: undefined, // ignored for delete — see ownerGuard.ts
              ownerCount: await internalAdapter.countTotalUsers([
                { field: "role", operator: "eq", value: "owner" },
              ]),
            })
          }),
        },
      },
    },
    // C3, round 2: the round-1 fix above only guarded `/admin/remove
    // -user`, and it read `ctx.body.userId` *raw* — `router.mjs` builds
    // `ctx.body` from `request.json()` untouched, and this middleware
    // (via `createAuthMiddleware`) runs in `dist/api/dispatch.mjs`'s
    // `runBeforeHooks`, *ahead of* the endpoint's own zod body validation
    // (`removeUserBodySchema`'s `userId: z.coerce.string()`, which only
    // runs once the endpoint handler itself is invoked — inside
    // `createAuthEndpoint`'s own wrapper, which is what opens the nested
    // `AsyncLocalStorage` scope `databaseHooks` sees the validated body
    // through; confirmed on re-check in round 3 — not
    // `createInternalContext` directly, that's the function *doing* the
    // validation on each entry, not the thing responsible for the nested
    // scope). zod 4.4.3 coerces a single-element array to its one element
    // as a string (`z.coerce.string()` on `["<id>"]` yields `"<id>"`), so
    // `{"userId": ["<ownerId>"]}` made the endpoint act on the real owner
    // id while `typeof userId !== "string"` saw an array and *returned*
    // (allowed). Measured: this let the whole destructive cascade run —
    // `deleteUserSessions` then `deleteUser`'s account deletion — before
    // `databaseHooks.user.delete.before` (which reads the *already
    // -fetched* row, not this raw body, so it's unaffected by the bug
    // itself) got a chance to throw on the row delete; by then the
    // damage was already done. Never re-implement zod's coercion to
    // match it here — that's a second representation of the same value
    // with its own chance to diverge from the first. Refuse instead of
    // guessing: any shape that isn't already a plain string is refused
    // outright, for every path this guards.
    //
    // Extended past `/admin/remove-user` to `/admin/update-user`,
    // `/admin/ban-user`, `/admin/revoke-user-sessions` and `/admin/revoke
    // -user-session` (round 3, item 3): all five take a coercible body
    // (four `userId: z.coerce.string()`; the singular revoke path takes
    // `sessionToken: z.string()` instead — resolved through
    // `internalAdapter.findSession` below, since it names a *session*,
    // not a user, directly) and all can call
    // `internalAdapter.deleteUserSessions`/`deleteSession` — the same
    // side effect this guard exists to stop — with no `databaseHooks` on
    // the `session` model at all to catch it independently. (`update
    // -user`/`ban-user`/`remove-user` are additionally protected by
    // `databaseHooks.user.update.before`/`delete.before` above, since
    // those go through `internalAdapter.updateUser`/`deleteUser`; the two
    // revoke paths call `deleteUserSessions`/`deleteSession` directly, so
    // this endpoint-level layer is the *only* guard for them.)
    //
    // Round 3, item 2: `if (parseRole(target?.role) !== "owner") return`
    // used to be the terminal check — a `return` (allow) on *any* role
    // that didn't parse to exactly `"owner"`, which silently included
    // "couldn't classify this at all". A row already sitting in the
    // database with `role: "owner,editor"` (round 2's `create.before`
    // fix stops the API from *manufacturing* one, but says nothing about
    // rows that predate that commit or were written directly into the
    // component tables) holds every owner permission through
    // `has-permission.mjs`'s comma-split `hasPermission` — so this guard
    // would wave a plain string `userId` straight through to
    // `deleteUserSessions`, reproducing the original C3 on a row this
    // fix round didn't anticipate. Fixed by classifying once and refusing
    // the unclassifiable: only a *positively classified* non-owner role
    // returns early; `null` (found, but unclassifiable) throws, same as
    // a genuine owner would.
    //
    // Round 4, item A: round 3's "check the session first" fix — meant to
    // close a pre-auth oracle — opened a full account takeover instead,
    // and it was my own instruction that caused it, so the correction
    // matters as much as the fix.
    //
    // `options.hooks.before` is pushed onto the `beforeHooks` list *ahead
    // of* every plugin's own before-hooks (`getHooks` in
    // `dist/api/dispatch.mjs:139-162` pushes ours first, then iterates
    // `plugins` appending each plugin's `hooks.before`) — and the
    // `convex()` plugin (`plugins/convex/index.ts`, wired above)
    // unconditionally installs the bearer plugin, whose before-hook is
    // what turns an `Authorization: Bearer <token>` header into the
    // request session `adminMiddleware` later reads. So when *this*
    // middleware ran `getSessionFromCtx(ctx)` first, for a
    // bearer-authenticated caller that call always resolved to `null` —
    // the cookie it looks for doesn't exist yet — and the round-3 code's
    // `if (!session?.user) return` treated that as "unauthenticated,
    // let the endpoint's own 401 handle it" and let the request straight
    // through. `adminMiddleware` then authenticated the *same* caller
    // normally, moments later, once its own session resolution ran. Two
    // full takeovers measured this way: revoking the owner's sessions,
    // and destroying the owner's credential account via
    // `/admin/remove-user` — both via `Authorization: Bearer`, both
    // refused via a cookie on the identical request.
    //
    // The fix is the ordering round 2 already had, restored deliberately
    // rather than reinvented: resolve the *target* first, independent of
    // any session — `internalAdapter.findUserById`/`findSession` don't
    // care how (or whether) the caller authenticated — and decide the
    // *target* side of the check before ever touching `getSessionFromCtx`.
    // Session is consulted *only* once the target is confirmed to be the
    // owner, and *only* for the self-action carve-out — and there, an
    // unresolvable session now refuses rather than allows. A
    // bearer-authenticated owner editing their own profile will get a
    // 403 instead of succeeding; that's an accepted, deliberate
    // regression in the fail-*safe* direction, not a bug — better an
    // owner has to switch to a cookie-authenticated session for that one
    // action than an admin being able to use the exact same gap to take
    // the account over.
    //
    // Do not try to resolve the bearer token here to reconstruct the
    // session ourselves — that would be a second representation of the
    // same authentication decision `adminMiddleware`/the bearer plugin
    // already make, with its own chance to diverge from theirs, which is
    // the precise anti-pattern (a guard reading a different
    // representation of the request than the code it guards) that
    // produced the original C3.
    //
    // The pre-auth oracle this reintroduces is accepted, not overlooked:
    // an unauthenticated caller who already knows a user id can learn
    // whether that id is the owner's, by whether this middleware answers
    // 403 (target resolved to owner) or lets the request fall through to
    // the endpoint's own 401 (target resolved to anyone else, or wasn't
    // found). That is a minor information leak. What round 3's ordering
    // allowed — a full account takeover over an authenticated but
    // not-yet-session-resolved request — is not one. If a future change
    // moves the session check back ahead of target resolution to close
    // the oracle again, it reopens this: don't.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const isRevokeSingle = ctx.path === "/admin/revoke-user-session"
        if (!OWNER_PROTECTED_PATHS.has(ctx.path) && !isRevokeSingle) return

        const internalAdapter = (ctx.context as OwnerHookEndpointContext["context"])
          ?.internalAdapter
        if (!internalAdapter) {
          throw APIError.from("FORBIDDEN", {
            code: "OWNER_INVARIANT",
            message: "CANNOT_VERIFY_OWNER_INVARIANT: contexte insuffisant pour vérifier l'invariant",
          })
        }

        const body = ctx.body as Record<string, unknown> | undefined

        // Resolve the target user id and their raw (unparsed) role —
        // *before* touching the session. `/admin/revoke-user-session`
        // (singular) is the odd one out — its body names a *session*, so
        // the target user is whoever that session belongs to, not a
        // field read directly off the body.
        let targetUserId: string
        let targetRoleRaw: string | null | undefined
        if (isRevokeSingle) {
          const sessionToken = body?.sessionToken
          if (typeof sessionToken !== "string") {
            throw APIError.from("FORBIDDEN", {
              code: "OWNER_INVARIANT",
              message:
                "OWNER_PROTECTED: forme de requête non reconnue pour un champ ciblant potentiellement l'owner",
            })
          }
          const found = await internalAdapter.findSession(sessionToken)
          if (!found) return // NOT_FOUND is the endpoint's own concern
          targetUserId = found.user.id
          targetRoleRaw = found.user.role
        } else {
          const userId = body?.userId
          if (typeof userId !== "string") {
            throw APIError.from("FORBIDDEN", {
              code: "OWNER_INVARIANT",
              message:
                "OWNER_PROTECTED: forme de requête non reconnue pour un champ ciblant potentiellement l'owner",
            })
          }
          const target = await internalAdapter.findUserById(userId)
          if (!target) return // NOT_FOUND is the endpoint's own concern
          targetUserId = userId
          targetRoleRaw = target.role
        }

        // Round 3, item 2 (unchanged): classify once, refuse the
        // unclassifiable. A role that doesn't parse to exactly one known
        // value is never treated as "safely not the owner".
        const targetRole = parseRole(targetRoleRaw)
        if (targetRole === null) {
          throw APIError.from("FORBIDDEN", {
            code: "OWNER_INVARIANT",
            message: "OWNER_PROTECTED: rôle de la cible non classifiable, refusé par prudence",
          })
        }
        if (targetRole !== "owner") return // positively not the owner: nothing to guard

        // The target IS the owner. Only *now* — with the target side of
        // the decision already made independent of any session — consult
        // the session, and only for the self-action carve-out.
        // `/admin/remove-user` and `/admin/ban-user` already refuse a
        // *self*-targeted call downstream (`YOU_CANNOT_REMOVE_YOURSELF` /
        // `YOU_CANNOT_BAN_YOURSELF` in `routes.mjs`) before their
        // destructive calls run, so letting a genuine self-action through
        // here changes nothing for either. `/admin/update-user` and both
        // revoke paths have no such restriction — an owner legitimately
        // edits their own profile, or revokes their own other sessions,
        // through them — so this is what keeps those usable for their
        // legitimate case. Both sides of the comparison come from the
        // signed session and the already-string-typed target id, never
        // from an unvalidated body field.
        const session = await getSessionFromCtx(ctx).catch(() => null)
        if (session?.user?.id === targetUserId && parseRole(session.user.role) === "owner") {
          return
        }

        // Unresolvable session (see the big comment above — this is the
        // expected outcome for a bearer-authenticated caller at this
        // pipeline stage) or a real non-owner actor: refuse either way.
        // Never `return` here — that's exactly the round-3 mistake.
        throw APIError.from("FORBIDDEN", {
          code: "OWNER_INVARIANT",
          message: "OWNER_PROTECTED: seul l'owner peut modifier ou supprimer son propre compte",
        })
      }),
    },
  }) satisfies BetterAuthOptions


// Paths where better-auth can destroy the owner's sessions and/or
// credential account before `databaseHooks` gets a chance to run — see
// the big comment on `hooks.before` above for the exact mechanism and why
// each of these needs it. `/admin/revoke-user-session` (singular) isn't
// in this set — it's handled by the `isRevokeSingle` branch instead,
// since it names a session token, not a `userId`, and this set is only
// ever checked against paths that do.
const OWNER_PROTECTED_PATHS = new Set([
  "/admin/remove-user",
  "/admin/update-user",
  "/admin/ban-user",
  "/admin/revoke-user-sessions",
])

// Narrow shape for the pieces of `GenericEndpointContext` the hooks above
// actually read. `body`/`context.session`/`context.internalAdapter` are
// all present at runtime (verified empirically — see
// `auth.ownerInvariant.test.ts`) but aren't part of the statically-typed
// `GenericEndpointContext`, which is generic over the endpoint and doesn't
// know about admin-plugin fields.
type OwnerHookEndpointContext = {
  body?: { userId?: string; sessionToken?: string }
  context?: {
    session?: { user?: { id?: string; role?: string | null } } | null
    internalAdapter?: {
      findUserById: (id: string) => Promise<{ id: string; role?: string | null } | null>
      findSession: (
        token: string,
      ) => Promise<{ session: unknown; user: { id: string; role?: string | null } } | null>
      countTotalUsers: (
        where?: { field: string; operator?: string; value: unknown }[],
      ) => Promise<number>
    }
  }
}

// I2: translates the pure layer's `OwnerInvariantError` into a real
// `APIError` at the one place better-auth's dispatcher actually inspects
// for one (`isAPIError` in `dist/api/dispatch.mjs`). Left as a plain
// thrown `Error`, it propagates past that check and the router answers a
// bare 500 with an **empty** body — indistinguishable from an unrelated
// crash, and useless to an admin UI trying to explain the refusal to an
// operator. `ownerGuard.ts` itself stays HTTP-free; only this wiring layer
// knows about `APIError`.
function guardOwnerInvariant<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args) => {
    try {
      await fn(...args)
    } catch (err) {
      if (err instanceof OwnerInvariantError) {
        throw APIError.from("FORBIDDEN", { code: "OWNER_INVARIANT", message: err.message })
      }
      throw err
    }
  }
}

// better-auth's own publicly-known fallback secret (verified against
// better-auth@1.6.17's dist/utils/constants.mjs: `DEFAULT_SECRET`). A
// truthiness check on `options.secret` alone would pass if someone set
// BETTER_AUTH_SECRET to this exact value, or to a short/low-entropy string
// — better-auth only warns in both cases, it never throws outside
// NODE_ENV === "production". Checked explicitly below so misconfiguration
// fails loudly in every environment, not just production.
const DEFAULT_BETTER_AUTH_SECRET = "better-auth-secret-12345678901234567890"

// `requireSecret` defaults to true for every request-serving instance
// (convex/http.ts calls `createAuth` unchanged, so it always gets the
// default). The one exception is convex/betterAuth/auth.ts, the schema
// generator's introspection-only shim: it is never reachable as a Convex
// function and never serves a request, so demanding a deployment secret
// from it buys no security and only breaks component analysis at deploy
// time (Convex components have an isolated environment — see auth.ts's
// git history for the failure this caused). The real invariant is "no
// auth instance that serves HTTP requests may run on the library's
// fallback secret," not "every call site must have a secret" — this flag
// keeps that invariant precise instead of over-applying it.
export const createAuth = (
  ctx: GenericCtx<DataModel>,
  { requireSecret = true }: { requireSecret?: boolean } = {},
) => {
  const options = createAuthOptions(ctx)

  if (requireSecret) {
    // Required — without an explicit secret, better-auth falls back to a
    // publicly-known default constant outside NODE_ENV === "production",
    // and this secret signs cookies and derives verification/state
    // tokens.
    if (!options.secret) {
      throw new Error("BETTER_AUTH_SECRET is not set on this Convex deployment")
    }
    if (options.secret === DEFAULT_BETTER_AUTH_SECRET) {
      throw new Error(
        "BETTER_AUTH_SECRET is set to Better Auth's public default — generate a real one with: openssl rand -base64 32",
      )
    }
    if (options.secret.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be at least 32 characters")
    }

    // Required — unset, better-auth derives the origin per-request from
    // request headers, so `trustedOrigins` becomes whatever host the
    // incoming request claims.
    if (!options.baseURL) {
      throw new Error("SITE_URL is not set on this Convex deployment")
    }
  }

  return betterAuth(options)
}
