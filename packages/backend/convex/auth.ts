import { betterAuth, type BetterAuthOptions } from "better-auth/minimal"
import { admin } from "better-auth/plugins"
import { APIError, createAuthMiddleware, getIp, getSessionFromCtx } from "better-auth/api"
import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/admin/access"
import { convex } from "@convex-dev/better-auth/plugins"
import { createClient, type GenericCtx } from "@convex-dev/better-auth"
import { RateLimiter } from "@convex-dev/rate-limiter"
import { components, internal } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import authSchema from "./betterAuth/schema"
import authConfig from "./auth.config"
import { parseRole, type Role } from "./validators"
import { assertOwnerInvariant, OwnerInvariantError } from "./lib/ownerGuard"
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_SCORE,
  scorePassword,
} from "./lib/passwordStrength"
import {
  PASSWORD_RESET_RATE_LIMIT_CONFIG,
  PASSWORD_RESET_RATE_LIMIT_NAME,
  buildPasswordResetRateLimitKey,
} from "./lib/passwordResetRateLimit"
import {
  SIGN_IN_EMAIL_RATE_LIMIT_CONFIG,
  SIGN_IN_EMAIL_RATE_LIMIT_NAME,
  SIGN_IN_RATE_LIMIT_CONFIG,
  SIGN_IN_RATE_LIMIT_NAME,
  UNRESOLVED_SIGN_IN_ORIGIN,
  buildSignInEmailRateLimitKey,
  buildSignInRateLimitKey,
} from "./lib/signInRateLimit"
import { deriverOrigines } from "./lib/origines"

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

// Rate limiting for `/sign-in/email` (Lot 1's deferred gate — see
// `lib/signInRateLimit.ts` for the full rationale, including why the key
// is (origin, email) rather than either alone). Better Auth's own rate
// limiter (`options.rateLimit`) defaults to `storage: "memory"`, which
// cannot persist or be shared across Convex HTTP-action isolates — each
// request may land on a fresh isolate with empty in-memory state, making
// that limiter a no-op here regardless of `enabled`. `@convex-dev/rate
// -limiter` persists in the database instead, so it actually works across
// requests.
//
// One instance at module scope, exactly like `authComponent` above: the
// config is static, and the per-request Convex ctx (needed for the
// `.limit()` call itself) is only ever supplied later, at call time —
// see `guardSignInRateLimit`'s `convexCtx` parameter below.
const signInRateLimiter = new RateLimiter(components.rateLimiter, {
  [SIGN_IN_RATE_LIMIT_NAME]: SIGN_IN_RATE_LIMIT_CONFIG,
  [SIGN_IN_EMAIL_RATE_LIMIT_NAME]: SIGN_IN_EMAIL_RATE_LIMIT_CONFIG,
})

// Wiring-boundary translation, same role as `guardOwnerInvariant` below:
// the decision (config, key) lives in the dependency-free
// `lib/signInRateLimit` module; this is the one place that (a) makes the
// real `ctx.runMutation` call through the rate-limiter component and (b)
// turns an exceeded limit into a better-auth `APIError` the router
// actually inspects for (an ordinary thrown `Error` would surface as an
// empty-bodied 500 — see `guardOwnerInvariant`'s own comment for the same
// pitfall, measured there first).
//
// `authCtx` is intentionally left untyped (inferred from the
// `createAuthMiddleware` callback that calls this — see `hooks.before`
// below): `GenericEndpointContext` isn't exported from `better-auth/api`,
// and the two fields this reads (`body`, and one of `request`/`headers`)
// are already part of the *statically typed* `EndpointContext` from
// `better-call` (unlike `context.session`/`context.internalAdapter` below,
// which needed the narrow `OwnerHookEndpointContext` cast) — unlike that
// case, there is nothing here worth fighting the type system to name.
async function guardSignInRateLimit(
  convexCtx: GenericCtx<DataModel>,
  authCtx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): Promise<void> {
  // `GenericCtx<DataModel>` (`@convex-dev/better-auth`'s own type) is a
  // union of query/mutation/action ctx, because `createAuth` is typed to
  // accept whichever one a caller has on hand — but `signInRateLimiter
  // .limit()` needs `runMutation`, which only the latter two carry.
  // `/sign-in/email` is only ever reached via the HTTP action `http.ts`
  // constructs `createAuth` with per request, which always has it — this
  // is a static-typing gap, not a reachable runtime state — but fail
  // closed rather than assume: an `as` cast here would silently compile
  // even if that stopped being true.
  if (!("runMutation" in convexCtx)) {
    throw APIError.from("INTERNAL_SERVER_ERROR", {
      code: "SIGN_IN_RATE_LIMIT_UNAVAILABLE",
      message:
        "SIGN_IN_RATE_LIMIT_UNAVAILABLE: contexte insuffisant pour appliquer la limitation de débit, connexion refusée par prudence",
    })
  }

  const body = authCtx.body as { email?: unknown } | undefined

  // `request`/`headers` are only populated for a call that actually went
  // through the HTTP router (or `auth.api.*`, which re-enters the same
  // pipeline) with a real `Request` — an internal call like this file's
  // own `seedUser` fixture's `auth.api.createUser({body: user})` supplies
  // neither. `/sign-in/email` is never called that way in this app, but
  // fail safe rather than throw a type error if it ever were: still rate
  // limit, under a fixed sentinel that can never collide with a real IP
  // (see `UNRESOLVED_SIGN_IN_ORIGIN`'s own comment).
  const requestLike = authCtx.request ?? authCtx.headers
  const ip = requestLike
    ? (getIp(requestLike, authCtx.context.options) ?? UNRESOLVED_SIGN_IN_ORIGIN)
    : UNRESOLVED_SIGN_IN_ORIGIN

  // C1 (Lot 1 final review): the tight (origin, email) bucket alone is a
  // no-op against the attacker it names — see `lib/signInRateLimit.ts`'s
  // header comment on `SIGN_IN_EMAIL_RATE_LIMIT_CONFIG` for the two facts
  // (`getIp` trusts a caller-controlled header verbatim; nothing sits in
  // front of `*.convex.site` to strip or validate it) that make rotating
  // `x-forwarded-for` mint an unbounded number of fresh buckets. This
  // second bucket — keyed on the normalized email alone, origin-independent
  // by construction — is what still catches that: always consulted,
  // regardless of whether `ip` resolved to anything.
  const emailKey = buildSignInEmailRateLimitKey(body?.email)
  const emailStatus = await signInRateLimiter.limit(convexCtx, SIGN_IN_EMAIL_RATE_LIMIT_NAME, {
    key: emailKey,
  })

  // The tight bucket only means something when `ip` actually distinguishes
  // one requester from another. When it doesn't — no `x-forwarded-for` at
  // all, `ip === UNRESOLVED_SIGN_IN_ORIGIN` — keying it anyway would
  // silently collapse *every* headerless request for this email (a real
  // owner's included, should their traffic ever lack the header) onto one
  // shared 5-per-2-minute budget: exactly the per-email-only design this
  // module's own header comment rejects, and exactly how an attacker with
  // no origin at all could lock the owner out. Skipped in that case, so an
  // attacker who omits the header faces the same 50/hour backstop as one
  // who rotates a spoofed one — never a smaller bucket than that.
  let originStatus: { ok: boolean; retryAfter?: number } = { ok: true }
  if (ip !== UNRESOLVED_SIGN_IN_ORIGIN) {
    const originKey = buildSignInRateLimitKey(body?.email, ip)
    originStatus = await signInRateLimiter.limit(convexCtx, SIGN_IN_RATE_LIMIT_NAME, {
      key: originKey,
    })
  }

  if (emailStatus.ok && originStatus.ok) return

  const retrySeconds = Math.ceil(
    Math.max(emailStatus.retryAfter ?? 0, originStatus.retryAfter ?? 0) / 1000,
  )
  throw APIError.from("TOO_MANY_REQUESTS", {
    code: "SIGN_IN_RATE_LIMITED",
    message: `SIGN_IN_RATE_LIMITED: trop de tentatives de connexion pour ce compte depuis cette origine, réessayez dans ${retrySeconds}s`,
  })
}

// Path checked by the sign-in rate limiter above, kept as its own `Set`
// deliberately parallel to (not merged into) `OWNER_PROTECTED_PATHS`
// further down: same shape — a path-matching guard wired into
// `hooks.before` — but a different concern with a different lifecycle, and
// merging the two sets would make a future edit to one silently affect the
// other's matching.
const SIGN_IN_PATHS = new Set(["/sign-in/email"])

// La consommation d'un jeton de réinitialisation. Son propre `Set`, pour
// la même raison que `SIGN_IN_PATHS` ci-dessus : une autre préoccupation,
// un autre cycle de vie, et fusionner les ensembles ferait qu'une
// modification de l'un changerait silencieusement ce que l'autre attrape.
const RESET_PASSWORD_PATHS = new Set(["/reset-password"])

// La DEMANDE d'un jeton — publique, non authentifiée, et elle envoie un
// email. Distincte du `Set` ci-dessus, et pas seulement par le chemin :
// les deux routes sont gardées par des mécanismes différents (une limite
// de débit ici, deux vérifications de contenu là) qui ne partagent rien.
const REQUEST_PASSWORD_RESET_PATHS = new Set(["/request-password-reset"])

// Le limiteur de `/request-password-reset` — voir
// `lib/passwordResetRateLimit.ts` pour le raisonnement complet, y compris
// pourquoi UN seul seau (par adresse, indépendant de l'origine) plutôt que
// les deux de la connexion, et pourquoi pas de seau global au déploiement.
//
// Une seconde instance plutôt qu'un nom de plus sur `signInRateLimiter` :
// les deux configurations n'ont ni la même forme ni la même raison d'être,
// et les loger sous un client nommé pour la connexion aurait fait mentir
// ce nom. Le composant, lui, est le même — un client `RateLimiter` ne
// porte que de la configuration.
const passwordResetRateLimiter = new RateLimiter(components.rateLimiter, {
  [PASSWORD_RESET_RATE_LIMIT_NAME]: PASSWORD_RESET_RATE_LIMIT_CONFIG,
})

// Frontière de câblage, même rôle que `guardSignInRateLimit` ci-dessus :
// la décision (configuration, clé) vit dans le module pur, et c'est ici
// qu'on fait le vrai `ctx.runMutation` à travers le composant puis qu'on
// traduit un dépassement en `APIError` — la seule forme que le routeur
// de better-auth inspecte réellement (une `Error` ordinaire ressortirait
// en 500 au corps vide).
async function guardPasswordResetRateLimit(
  convexCtx: GenericCtx<DataModel>,
  authCtx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): Promise<void> {
  // Même trou de typage que pour la connexion : `GenericCtx<DataModel>`
  // est une union query/mutation/action et seules les deux dernières
  // portent `runMutation`. Cette route n'est atteignable que par l'action
  // HTTP de `http.ts`, qui l'a toujours — mais on échoue fermé plutôt que
  // de le supposer, un `as` compilerait encore si ça cessait d'être vrai.
  if (!("runMutation" in convexCtx)) {
    throw APIError.from("INTERNAL_SERVER_ERROR", {
      code: "PASSWORD_RESET_RATE_LIMIT_UNAVAILABLE",
      message:
        "PASSWORD_RESET_RATE_LIMIT_UNAVAILABLE: contexte insuffisant pour appliquer la limitation de débit, demande refusée par prudence",
    })
  }

  const body = authCtx.body as { email?: unknown } | undefined
  const status = await passwordResetRateLimiter.limit(convexCtx, PASSWORD_RESET_RATE_LIMIT_NAME, {
    key: buildPasswordResetRateLimitKey(body?.email),
  })
  if (status.ok) return

  // Le message ne porte AUCUN délai calculé, contrairement à celui de la
  // connexion, et c'est délibéré : deux adresses limitées à une seconde
  // d'intervalle rendraient deux `retryAfter` différents, donc deux corps
  // différents — une différence observable de l'extérieur sur un chemin
  // dont toute la conception consiste à n'en laisser aucune. La fenêtre
  // est fixe et connue (voir `PASSWORD_RESET_RATE_LIMIT_CONFIG`), donc il
  // n'y a rien à apprendre dans ce délai qui vaille cet écart.
  throw APIError.from("TOO_MANY_REQUESTS", {
    code: "PASSWORD_RESET_RATE_LIMITED",
    message:
      "PASSWORD_RESET_RATE_LIMITED: trop de demandes de réinitialisation pour cette adresse, réessayez plus tard",
  })
}

// Les deux pièces que `guardPasswordReset` lit sur le contexte de
// l'endpoint. Type étroit et séparé de `OwnerHookEndpointContext` plus
// bas, exactement comme les `Set` de chemins sont séparés : les deux
// gardes lisent `internalAdapter`, mais pas les mêmes méthodes ni pour la
// même décision, et un type partagé ferait qu'élargir l'un élargirait
// l'autre sans que personne ne l'ait voulu.
type PasswordResetEndpointContext = {
  context?: {
    internalAdapter?: {
      findVerificationValue: (identifier: string) => Promise<{ value: string } | null>
      findUserById: (id: string) => Promise<{ id: string; email: string } | null>
    }
  }
}

/**
 * Le refus qu'un jeton inconnu reçoit déjà, reproduit à l'identique.
 *
 * `BASE_ERROR_CODES` n'est exporté par aucune entrée publique de
 * `better-auth` (vérifié : ni `better-auth`, ni `better-auth/minimal`, ni
 * `better-auth/api` ne le ré-exportent ; il vit dans
 * `@better-auth/core/error`, une dépendance transitive qu'on ne déclare
 * pas). Le littéral est donc recopié depuis
 * `@better-auth/core@1.6.17`'s `dist/error/codes.mjs`
 * (`INVALID_TOKEN: "Invalid token"`), et `api/routes/password.mjs` le lève
 * sous `APIError.from("BAD_REQUEST", …)`.
 *
 * Une copie peut diverger, et une divergence ici serait précisément
 * l'oracle qu'on veut éviter. C'est le test qui la rattrape, pas ce
 * commentaire : `passwordReset.test.ts` compare le corps de ce refus à
 * celui d'un jeton réellement inconnu, octet pour octet — si Better Auth
 * changeait ce message, le test virerait au rouge.
 */
function refuserCommeJetonInvalide(): never {
  throw APIError.from("BAD_REQUEST", { code: "INVALID_TOKEN", message: "Invalid token" })
}

/**
 * Les deux choses que `/reset-password` ne vérifie pas, et que ce dépôt
 * vérifie ailleurs.
 *
 * **1. La robustesse.** Better Auth ne contrôle que la LONGUEUR sur ce
 * chemin (`api/routes/password.mjs` de la version installée :
 * `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG`, rien d'autre), là où
 * `invitations.accept` applique en plus `MIN_PASSWORD_SCORE`. Un chemin de
 * récupération plus permissif que l'inscription est une porte dérobée
 * involontaire — et c'est celle qu'un attaquant choisira.
 *
 * **2. La suspension, à la CONSOMMATION.** `sendResetPassword` refuse déjà
 * d'ÉMETTRE vers un compte suspendu, mais quelqu'un suspendu dans l'heure
 * qui suit sa demande gardait un jeton valide, donc un retour dans
 * l'administration.
 *
 * Les deux vivent dans la même fonction parce qu'elles ont besoin de la
 * même chose — le compte que ce jeton désigne — et que la résoudre deux
 * fois serait deux occasions de la résoudre différemment.
 *
 * Ne consomme jamais le jeton : `findVerificationValue` lit (elle balaie
 * au passage les lignes expirées, ce que l'endpoint fait de toute façon
 * juste après), là où `consumeVerificationValue` — celle que l'endpoint
 * appelle — le détruit. Refuser ne doit pas coûter à la personne le seul
 * lien qu'elle ait reçu.
 */
async function guardPasswordReset(
  convexCtx: GenericCtx<DataModel>,
  authCtx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
): Promise<void> {
  const body = authCtx.body as { newPassword?: unknown; token?: unknown } | undefined

  // `hooks.before` s'exécute AVANT la validation zod du corps par
  // l'endpoint (voir le grand commentaire de `hooks.before` plus bas,
  // round 2 / C3) : rien ici ne peut supposer une forme. Tout ce qui n'est
  // pas déjà une chaîne simple est laissé à l'endpoint, dont c'est le
  // travail de le refuser — et qui rendra son propre `INVALID_TOKEN`.
  //
  // Le jeton se lit dans le corps OU dans la query, et il faut le lire
  // avec le MÊME ordre de vérité que l'endpoint, pas seulement dans le
  // même ordre de sources : `const token = ctx.body.token ||
  // ctx.query?.token` (`api/routes/password.mjs` de la version
  // installée, ligne 140). Ce `||` bascule sur la VÉRACITÉ, pas sur la
  // présence ni sur le type.
  //
  // La version précédente choisissait par le TYPE (`typeof body.token
  // === "string" ? … : query.token`), et cet écart était exploitable :
  // `""` est un `string`, donc la garde s'arrêtait dessus, n'y trouvait
  // aucune ligne `reset-password:` et sortait en silence — pendant que
  // l'endpoint, pour qui `""` est falsy, basculait sur la query et
  // consommait le VRAI jeton qui s'y trouvait. Un
  // `POST /reset-password?token=<vrai>` au corps `{"token":"",
  // "newPassword":"…"}` passait donc les deux gardes ci-dessous d'un
  // coup : plancher de robustesse et compte suspendu. `""` est la seule
  // valeur qui produise cet écart — `null` et `undefined` ne sont des
  // chaînes pour personne, et zod refuse tout le reste.
  //
  // Reprendre le `||` tel quel est ce qui referme l'écart par
  // construction : la garde ne peut plus désigner un autre jeton que
  // celui que l'endpoint consommera. Le `.length > 0` qui suit n'est pas
  // une seconde règle mais la conséquence directe du même `||` : une
  // chaîne vide des deux côtés n'est un jeton pour personne, et
  // l'endpoint la refuse lui-même par son `if (!token)`.
  const query = authCtx.query as { token?: unknown } | undefined
  const brut = (body?.token || query?.token) as unknown
  const jeton = typeof brut === "string" && brut.length > 0 ? brut : null
  if (jeton === null || typeof body?.newPassword !== "string") return
  const nouveauMotDePasse = body.newPassword

  const internalAdapter = (authCtx.context as PasswordResetEndpointContext["context"])
    ?.internalAdapter
  if (!internalAdapter) {
    throw APIError.from("INTERNAL_SERVER_ERROR", {
      code: "PASSWORD_RESET_GUARD_UNAVAILABLE",
      message:
        "PASSWORD_RESET_GUARD_UNAVAILABLE: contexte insuffisant pour vérifier le compte visé, réinitialisation refusée par prudence",
    })
  }

  // Le préfixe est celui de Better Auth (`reset-password:${token}` dans
  // `api/routes/password.mjs`, aux deux extrémités : à l'écriture ligne 68
  // et à la consommation ligne 147). Le recopier est le seul moyen de
  // retrouver la ligne, et s'il changeait de leur côté cette garde
  // deviendrait un no-op silencieux — d'où le test de `passwordReset
  // .test.ts` qui suspend un compte détenteur d'un VRAI jeton et exige le
  // refus : il vire au rouge dans ce cas-là.
  //
  // L'expiration n'est pas vérifiée ici, et ce n'est pas un oubli : un
  // jeton expiré est refusé par l'endpoint lui-même (`consume
  // VerificationValue` rend `null` au-delà de `expiresAt`) avec exactement
  // le refus que cette fonction rendrait. Le vérifier deux fois n'aurait
  // aucun effet observable, et donnerait une seconde lecture de
  // `expiresAt` capable de diverger de la première.
  const verification = await internalAdapter.findVerificationValue(`reset-password:${jeton}`)
  if (!verification) return // jeton inconnu : l'endpoint rend SON propre refus
  const cible = await internalAdapter.findUserById(verification.value)
  if (!cible) return

  if (!("runQuery" in convexCtx)) {
    throw APIError.from("INTERNAL_SERVER_ERROR", {
      code: "PASSWORD_RESET_GUARD_UNAVAILABLE",
      message:
        "PASSWORD_RESET_GUARD_UNAVAILABLE: contexte sans runQuery, réinitialisation refusée par prudence",
    })
  }

  // La MÊME décision que celle de l'émission, pas une seconde. On rappelle
  // `passwordReset.envoiInterditPour`, dont la question est exactement
  // celle-ci — « ce compte est-il suspendu, ou n'existe-t-il plus ? » —
  // et qui la pose par le chemin brut du composant (donc `banExpires` en
  // nombre, comme le schéma le stocke) plutôt qu'à travers l'adaptateur.
  // Son nom parle d'ENVOI parce que c'est là qu'elle est née ; en écrire
  // une seconde ici, ne serait-ce qu'un `doc.banned === true`, ferait
  // diverger les deux bouts du même parcours — et un ban EXPIRÉ est un ban
  // levé, qui doit laisser passer aux deux bouts.
  const suspendu = await convexCtx.runQuery(internal.passwordReset.envoiInterditPour, {
    email: cible.email,
  })
  if (suspendu) refuserCommeJetonInvalide()

  // La longueur est laissée à l'endpoint, qui la vérifie contre les mêmes
  // `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH` posés plus bas et rend un
  // refus plus précis (`PASSWORD_TOO_SHORT`/`PASSWORD_TOO_LONG`) que le
  // `WEAK_PASSWORD` générique ci-dessous. Deux bornes identiques, une
  // seule qui répond.
  if (
    nouveauMotDePasse.length < MIN_PASSWORD_LENGTH ||
    nouveauMotDePasse.length > MAX_PASSWORD_LENGTH
  ) {
    return
  }

  // Scoré contre l'adresse du compte que le JETON désigne, jamais contre
  // une adresse fournie par l'appelant — même règle que
  // `invitations.accept`, qui score contre l'email lu dans la ligne
  // d'invitation. `WEAK_PASSWORD` est aussi le code qu'elle lève : l'écran
  // qui soumet ce formulaire branche sur un seul vocabulaire.
  if (scorePassword(nouveauMotDePasse, { email: cible.email }).score < MIN_PASSWORD_SCORE) {
    throw APIError.from("BAD_REQUEST", {
      code: "WEAK_PASSWORD",
      message:
        "WEAK_PASSWORD: ce mot de passe est trop faible, choisissez-en un plus robuste — la même exigence qu'à la création du compte",
    })
  }
}

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
// Re-exported, not redeclared: `lib/passwordStrength.ts` owns these because
// the browser form needs them too, and it can be imported there without
// dragging Better Auth and the Convex component wiring into the bundle. Every
// existing importer of `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH` from this
// module keeps working, against one definition instead of two.
export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH }

/**
 * Combien de temps un lien de réinitialisation reste utilisable, en
 * secondes.
 *
 * Nommée plutôt qu'écrite en ligne dans les options : c'est la durée que
 * `/confidentialite` publie pour la table `verification` (voir
 * `_dataRegistry.ts` et `apps/web/src/config/legal.ts`), et une constante
 * nommée est ce qui rend visible qu'il s'agit de la même valeur des deux
 * côtés. Égale à la valeur de repli de Better Auth — le but n'est pas de
 * la changer, c'est de cesser d'en hériter.
 */
export const RESET_PASSWORD_TOKEN_TTL_SECONDS = 60 * 60

// Reads `secret`/`baseURL` plainly, with no guard: `createApi` (the
// component-side adapter, see betterAuth/adapter.ts) calls this at module
// load inside the betterAuth component's own isolated environment, which
// never sees the app deployment's env vars. The adapter only needs the
// *shape* of the options — schema and plugin list — never the secret, so
// it must tolerate an absent one. The guard lives in `createAuth` below,
// the actual auth server, mounted in http.ts on the app side where the
// vars do exist and where a missing secret would otherwise silently fall
// back to a publicly-known default constant.
export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
  // Captured under a different name than the `hooks.before` callback's own
  // `ctx` parameter below, which shadows this one within that closure —
  // `guardSignInRateLimit` needs *this* (the real, per-request Convex ctx,
  // with `runMutation`/`runQuery`) to call the rate limiter, not the
  // better-auth endpoint context the inner `ctx` refers to there.
  const convexCtx = ctx
  return {
    secret: process.env.BETTER_AUTH_SECRET,
    // `baseURL` RESTE sur l'environnement, et ce n'est pas un oubli : la
    // lire en base est IMPOSSIBLE ici, pour deux raisons vérifiées plutôt
    // que supposées.
    //
    // 1. Le contrat du composant est SYNCHRONE. `CreateAuth` vaut
    //    `(ctx: GenericCtx<DataModel>) => A` (@convex-dev/better-auth
    //    0.12.5, `dist/utils/index.d.ts`), et `http.ts` passe `createAuth`
    //    tel quel à `authComponent.registerRoutes`. Rendre une promesse
    //    d'ici ne rend pas `baseURL` tardif : ça casse le montage des
    //    routes, donc l'authentification entière.
    // 2. `betterAuth/auth.ts` appelle `createAuth({} as any)` AU
    //    CHARGEMENT DU MODULE, avec un contexte factice et dans
    //    l'environnement isolé du composant. Il n'y a là ni base à lire ni
    //    `await` où le faire.
    //
    // Ce que `baseURL` décide vraiment, c'est `trustedOrigins` : better
    // -auth y pousse `new URL(baseURL).origin`
    // (`dist/context/helpers.mjs`). Faux, il fait REFUSER des requêtes
    // légitimes — le dashboard entier devient inutilisable, et personne ne
    // peut plus revenir en arrière sans SSH. C'est exactement le
    // verrouillage que ce lot existe pour éviter.
    //
    // D'où la forme retenue : `baseURL` figée par l'environnement, et
    // `trustedOrigins` ci-dessous qui AJOUTE l'origine du domaine déclaré
    // et celles des domaines sortants.
    //
    // `baseURL` seule ne suffit PAS à garder l'ancienne origine acceptée,
    // et l'avoir cru est ce qui a laissé passer le défaut : elle ne
    // conserve que l'origine du PREMIER domaine, celle de `SITE_URL`.
    // Au deuxième changement, l'origine intermédiaire — la seule encore
    // routée quand le nouveau domaine n'obtient pas de certificat —
    // disparaissait de la liste. Ce sont les sortants qui la gardent, et
    // c'est ce qui rend enfin vrai le « on ajoute, on vérifie, puis
    // seulement on retire » que le service `routeur` applique au routage.
    baseURL: process.env.SITE_URL,
    // Fonction, et asynchrone : better-auth accepte
    // `(request?) => Awaitable<(string|null|undefined)[]>` et la rappelle
    // À CHAQUE REQUÊTE (`dist/auth/base.mjs`, `getTrustedOrigins(...,
    // request)`), pas une fois au démarrage. C'est le seul point de ces
    // options où une lecture de la base est possible — et c'est ce qui
    // fait suivre l'origine du dashboard quand le domaine change.
    //
    // Elle ne LÈVE JAMAIS, et c'est la propriété la plus importante de ce
    // bloc : une exception ici casserait toute requête d'authentification,
    // y compris celles qui n'ont rien à voir avec le domaine. Une base
    // injoignable rend donc `[]` — la liste retombe sur `baseURL` seule,
    // c'est-à-dire exactement le comportement d'avant ce changement.
    //
    // `deriverOrigines(..., {})` avec un environnement VIDE, exprès :
    // l'origine de `SITE_URL` est déjà dans la liste par `baseURL`, et la
    // repousser ici n'ajouterait qu'un doublon. Ce que cette fonction
    // apporte, c'est l'origine du domaine déclaré et celles des domaines
    // SORTANTS, et rien d'autre.
    //
    // Les sortants, parce que sans eux le DEUXIÈME changement de domaine
    // enferme. `[baseURL, domaine déclaré]` seuls, c'est-à-dire
    // `[admin.A, admin.C]` après A → B → C : l'origine encore ROUTÉE,
    // `admin.B`, n'y figure plus, et tout `POST` qui en vient est refusé
    // en 403 `INVALID_ORIGIN` — `/sign-in/email` comme
    // `/request-password-reset`. Le raisonnement entier, ce que
    // `trustedOrigins` autorise réellement dans better-auth 1.6.17, et ce
    // que cette confiance n'élargit PAS : en-tête de `lib/origines.ts`.
    //
    // UNE lecture de base, pas deux. Better-auth rappelle cette fonction à
    // chaque requête d'authentification et rien ici n'est mis en cache —
    // un cache périmé sur cette liste EST le verrouillage. D'où
    // `settings.domaineEtSortants`, qui rend les deux champs de la même
    // ligne, plutôt qu'un `domaineDeclare` suivi d'une seconde query.
    //
    // L'origine courante d'abord : better-auth parcourt la liste jusqu'au
    // premier accord, et le cas de très loin le plus fréquent est celui où
    // aucun domaine n'est sortant.
    //
    // CETTE LISTE SE REFERME À T+72 h, ET LE ROUTEUR, LUI, NE SE REFERME
    // PAS. Les deux fenêtres ne se parlent pas. Un nouveau domaine qui
    // n'obtient JAMAIS son certificat laisse le routeur garder l'ancien
    // hôte routé indéfiniment — `sertUnCertificatValide` ne rendra jamais
    // `true` —, mais cet hôte quitte `adminSortantes` au bout de trois
    // jours : le seul hôte encore joignable devient le seul depuis lequel
    // on ne peut plus se connecter, et le 403 `INVALID_ORIGIN` que ce lot
    // existe pour fermer revient entier, différé de trois jours.
    //
    // C'est un ARBITRAGE assumé, pas un oubli — l'enfermement à J+3 contre
    // un domaine revendu reconnu pour toujours —, et l'asymétrie qui le
    // rend piégeux est écrite là où on la cherche : la dégradation d'un
    // hôte sortant retombe « sur le comportement d'avant » aux deux autres
    // points d'usage, alors qu'ici le comportement d'avant EST
    // l'enfermement. Le raisonnement, l'issue manuelle et les trois voies
    // examinées pour faire mieux qu'un commentaire sont dans
    // `lib/hotesSortants.ts`, au-dessus de `FENETRE_SORTANTE_MS`. Si vous
    // arrivez ici en diagnostiquant un `INVALID_ORIGIN` après un
    // changement de domaine, c'est là qu'il faut lire.
    trustedOrigins: async () => {
      if (!("runQuery" in convexCtx)) return []
      try {
        const { declare, sortants } = await convexCtx.runQuery(
          internal.settings.domaineEtSortants,
          {},
        )
        const { admin, adminSortantes } = deriverOrigines(declare, {}, sortants)
        return admin === null ? adminSortantes : [admin, ...adminSortantes]
      } catch (err) {
        console.error("TRUSTED_ORIGINS_UNREAD:", err)
        return []
      }
    },
    // Écrit plutôt qu'hérité, comme `resetPasswordTokenExpiresIn` plus
    // bas et pour la même raison — sauf qu'ici le défaut hérité DÉPEND DE
    // L'ENVIRONNEMENT, ce qui est pire qu'une constante.
    //
    // `dist/context/create-context.mjs` (1.6.17) :
    // `skipOriginCheck: options.advanced?.disableOriginCheck !== undefined
    // ? options.advanced.disableOriginCheck : isTest() ? true : false`.
    // Autrement dit, tant que l'option est absente, better-auth désactive
    // TOUT le contrôle d'origine dès que `NODE_ENV` vaut `test`. Un
    // déploiement Convex ne vaut jamais `test`, donc cette ligne ne change
    // rien en production — mais sous vitest elle changeait tout : aucune
    // suite ne pouvait observer un 403 `INVALID_ORIGIN`, et un test du
    // verrouillage de domaine aurait été vert avant comme après sa
    // correction. Poser `false` rend le contrôle observable là où il est
    // vérifié, et cesse d'hériter d'une valeur qui peut changer au
    // prochain `pnpm update`.
    advanced: { disableOriginCheck: false },
    database: authComponent.adapter(ctx), // requis — omis, rien ne persiste
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,

      // Faux par défaut chez Better Auth (vérifié dans
      // `api/routes/password.mjs` de la version installée, 1.6.17 :
      // `if (options.emailAndPassword?.revokeSessionsOnPasswordReset)
      // await internalAdapter.deleteUserSessions(userId)` — sans l'option,
      // rien), et c'est un défaut dangereux : la raison la plus fréquente
      // de réinitialiser est le soupçon d'un vol, et ne pas révoquer
      // laisse précisément le voleur connecté.
      revokeSessionsOnPasswordReset: true,

      // Écrite plutôt qu'héritée. Better Auth retombe sur `3600 * 1`
      // secondes quand l'option est absente (même fichier, ligne
      // `getDate(...resetPasswordTokenExpiresIn || 3600 * 1, "sec")`).
      // Trois raisons de la poser explicitement, aucune cosmétique :
      // c'est un jeton qui donne l'accès à l'administration ;
      // `/confidentialite` publie cette durée comme celle de conservation
      // de la table `verification` ; et une valeur héritée pourrait
      // changer au prochain `pnpm update` sans que la page publiée ne
      // bouge. Une heure est court, et c'est voulu — un lien reçu par
      // email doit rester utilisable le temps qu'il arrive, pas la
      // journée.
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TOKEN_TTL_SECONDS,

      // Pas d'`await` sur l'ENVOI : la documentation Better Auth l'écrit
      // noir sur blanc (« Avoid awaiting the email sending to prevent
      // timing attacks »), et la raison est temporelle — attendre l'envoi
      // allonge la réponse quand le compte existe, ce qui la transforme en
      // oracle mesurable au chronomètre, quelle que soit la prudence du
      // corps de réponse.
      //
      // Ce que ce `await` attend n'est donc PAS l'envoi : c'est
      // l'inscription du job dans `_scheduled_functions`, une écriture
      // constante qui est justement le mécanisme qui sort l'envoi du
      // chemin de la requête. L'omettre (`void ctx.scheduler.runAfter(…)`)
      // rendrait la planification elle-même incertaine — une promesse non
      // attendue dans une action Convex n'a aucune garantie de survivre au
      // retour du handler, et le job pourrait n'être jamais créé : l'email
      // ne partirait pas du tout, en silence, sur le seul chemin de
      // récupération du dépôt. C'est le mode d'échec le plus grave
      // possible ici, et il coûterait bien plus que le delta d'une
      // insertion de ligne — delta déjà noyé, sur les DEUX branches, par
      // le `findVerificationValue` que la route exécute (et qui, par
      // défaut, balaie au passage les lignes expirées).
      sendResetPassword: async ({ user, token }) => {
        // Même trou de typage que `guardSignInRateLimit` ci-dessus :
        // `GenericCtx<DataModel>` est une union query/mutation/action, et
        // seules les deux dernières portent `scheduler`. Cette route n'est
        // atteignable que par l'action HTTP de `http.ts`, qui l'a toujours.
        //
        // Mais ici on ne LÈVE pas, contrairement à là-bas, et c'est la
        // différence qui compte : `/request-password-reset` n'appelle
        // cette fonction que lorsque le compte EXISTE (la route répond 200
        // sans nous appeler quand il n'existe pas), donc toute erreur
        // remontée d'ici deviendrait un 500 réservé aux adresses qui ont
        // un compte — l'oracle exact que tout le reste de ce chemin évite.
        // Le journal du déploiement est le seul endroit où cette panne
        // peut se dire.
        if (!("scheduler" in convexCtx)) {
          console.error(
            "PASSWORD_RESET_UNAVAILABLE: contexte sans planificateur, l'email de réinitialisation n'est pas parti",
          )
          return
        }
        // L'origine suit le domaine déclaré depuis `/settings/domaine`
        // quand il est posé, et retombe sur `SITE_URL` sinon
        // (`lib/origines.ts`). Ce lien-ci est le SEUL chemin de
        // récupération du dépôt : pointé vers l'ancien domaine, il fait
        // exactement ce qu'un lien de réinitialisation ne doit jamais
        // faire — arriver, et ne mener nulle part.
        //
        // La lecture est enveloppée : `sendResetPassword` ne lève jamais
        // (voir juste au-dessus — toute erreur remontée d'ici deviendrait
        // un 500 réservé aux adresses qui ONT un compte, l'oracle exact
        // que tout ce chemin évite). Une base injoignable retombe donc sur
        // l'environnement plutôt que de faire échouer l'envoi.
        let declare: string | null = null
        if ("runQuery" in convexCtx) {
          try {
            declare = await convexCtx.runQuery(internal.settings.domaineDeclare, {})
          } catch (err) {
            console.error("PASSWORD_RESET_DOMAIN_UNREAD:", err)
          }
        }
        const { admin: siteUrl } = deriverOrigines(declare)
        if (!siteUrl) {
          console.error(
            "PASSWORD_RESET_UNAVAILABLE: SITE_URL absent, l'email de réinitialisation n'est pas parti",
          )
          return
        }

        // Le lien de ce dépôt, pas celui de Better Auth. Better Auth
        // propose `url` = `<baseURL>/reset-password/<jeton>?callbackURL=…`,
        // une route de REDIRECTION qui renvoie ensuite vers la vraie page
        // avec `?token=`. On vise la page directement, exactement comme
        // `sendInvitationEmail` vise `/accept-invite?token=` : un saut de
        // moins, et surtout une seule origine à faire figurer dans un
        // email — celle de l'administration, qui est ce que `SITE_URL`
        // désigne, et non l'origine `*.convex.site` qui sert l'API.
        const lien = `${siteUrl}/reset-password?token=${encodeURIComponent(token)}`
        await convexCtx.scheduler.runAfter(0, internal.passwordReset.envoyer, {
          email: user.email,
          lien,
        })
      },

      // Le journal dit QUE le mot de passe a changé, jamais lequel ni par
      // quel jeton. C'est le seul événement d'authentification que rien
      // d'autre ne reconstituerait a posteriori : aucune session n'a
      // demandé ce changement, donc aucune trace n'en existe ailleurs.
      //
      // Ne lève JAMAIS, et ce n'est pas de la prudence décorative :
      // `api/routes/password.mjs` appelle `onPasswordReset` AVANT
      // `deleteUserSessions`. Une exception ici sauterait donc la
      // révocation des sessions — c'est-à-dire précisément le défaut que
      // `revokeSessionsOnPasswordReset` ci-dessus vient de fermer — tout
      // en rendant un 500 sur un mot de passe déjà changé et un jeton déjà
      // consommé. Entre « il manque une ligne au journal » et « le voleur
      // est resté connecté », le second est le pire des deux.
      onPasswordReset: async ({ user }) => {
        if (!("runMutation" in convexCtx)) {
          console.error("PASSWORD_RESET_UNLOGGED: contexte sans runMutation")
          return
        }
        try {
          await convexCtx.runMutation(internal.passwordReset.journaliserReinitialisation, {
            authUserId: user.id,
            email: user.email,
          })
        } catch (err) {
          console.error("PASSWORD_RESET_UNLOGGED:", err)
        }
      },
    },
    // `plain` par défaut (vérifié dans `db/verification-token-storage.mjs`
    // de la version installée : sans `storeIdentifier`, `getStorageOption`
    // rend `undefined` et `processIdentifier` renvoie l'identifiant tel
    // quel). La table `verification` porterait alors
    // `reset-password:<jeton>` EN CLAIR — un accès administrateur
    // utilisable, lisible par quiconque exporte la base ou ouvre le
    // tableau de bord Convex. `invitations` ne stocke déjà que
    // `tokenHash` ; il n'y a aucune raison que ce jeton-ci soit moins bien
    // traité.
    //
    // Transparent pour les appelants : `findVerificationValue` et
    // `consumeVerificationValue` appliquent la même transformation à
    // l'identifiant qu'on leur passe, et essaient en plus la forme en
    // clair en repli — une ligne écrite avant ce changement reste donc
    // consommable.
    verification: { storeIdentifier: "hashed" },
    // Minor (Lot 1 final review): explicit rather than assumed. Better
    // Auth's own in-memory rate limiter (`storage: "memory"`, `enabled:
    // isProduction` by default) is inert in this runtime regardless of
    // this flag — see `signInRateLimiter`'s own header comment above for
    // why (in-memory state can't persist or be shared across Convex
    // HTTP-action isolates) — so this changes no behavior either way.
    // Setting it to `false` explicitly is what makes that intentional: the
    // real gate is `@convex-dev/rate-limiter`, wired in by hand in
    // `hooks.before` below, not this option.
    rateLimit: { enabled: false },
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

            // I2 (Lot 1 final review): a write carrying `data.role` whose
            // resolved target is the acting session's own user is refused
            // outright, unless that session is already `owner`. Today the
            // only thing stopping `/update-user` from accepting
            // `{"role":"admin"}` is `input: false` on the admin plugin's
            // own `role` field (verified live: it currently answers 400
            // `FIELD_NOT_ALLOWED`, *before* this hook ever runs) — a
            // library default nothing in this codebase configures or
            // tests. This check is deliberately independent of it: even if
            // that flag were ever silently dropped, changed by a
            // better-auth upgrade, or bypassed by a write path that skips
            // endpoint-level schema validation, this hook still refuses
            // the write. Checked against `targetId` as already resolved
            // above (not a second, differently-scoped lookup) so this
            // stays a single, consistent notion of "who this write targets"
            // — the same reasoning `assertOwnerInvariant`'s own "computed
            // unconditionally, not gated on a local pre-check" comment
            // gives for not maintaining two classifications that could
            // drift apart.
            if (
              rawNextRole !== undefined &&
              targetId !== undefined &&
              targetId === ctx?.context?.session?.user?.id &&
              parseRole(ctx?.context?.session?.user?.role) !== "owner"
            ) {
              throw new OwnerInvariantError(
                "SELF_ROLE_ESCALATION: seul un owner peut modifier son propre rôle",
              )
            }

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
        // Checked first, unconditionally, independent of everything below:
        // a different concern (brute-force sign-in guessing, not the
        // single-owner invariant), a different path set
        // (`SIGN_IN_PATHS`, not `OWNER_PROTECTED_PATHS`), no shared state.
        // Throws (via `guardSignInRateLimit`) rather than returning early
        // when exceeded, same control-flow shape as every refusal below.
        if (SIGN_IN_PATHS.has(ctx.path)) {
          await guardSignInRateLimit(convexCtx, ctx)
        }

        // Les deux portes de la récupération de mot de passe, vérifiées
        // ici pour la même raison que la connexion juste au-dessus : ce
        // sont des routes de Better Auth, servies par `http.ts`, qu'aucune
        // mutation de ce dépôt n'enveloppe — `hooks.before` est le seul
        // endroit du code applicatif qui les voie passer.
        //
        // Elles retournent tôt (rien à faire) ou lèvent, jamais autre
        // chose : aucune ne modifie le contexte, donc aucune n'interfère
        // avec les gardes de l'invariant owner plus bas.
        if (REQUEST_PASSWORD_RESET_PATHS.has(ctx.path)) {
          await guardPasswordResetRateLimit(convexCtx, ctx)
        }
        if (RESET_PASSWORD_PATHS.has(ctx.path)) {
          await guardPasswordReset(convexCtx, ctx)
        }

        const isRevokeSingle = ctx.path === "/admin/revoke-user-session"
        // I1 (Lot 1 final review, re-review): `needsRoleBoundaryGuard`
        // shares the same target resolution below with the owner guard
        // (`needsOwnerGuard`), rather than re-fetching the target a
        // second time or duplicating the userId/sessionToken branching —
        // see `guardAdminRoleBoundary` further down for why the check
        // itself still needs its own, separate function rather than being
        // folded into the owner guard's own logic.
        const needsOwnerGuard = OWNER_PROTECTED_PATHS.has(ctx.path) || isRevokeSingle
        const needsRoleBoundaryGuard = ADMIN_ROLE_BOUNDARY_PATHS.has(ctx.path) || isRevokeSingle
        if (!needsOwnerGuard && !needsRoleBoundaryGuard) return

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
        // I1 (Lot 1 final review, re-review): the role-table boundary —
        // an admin actor may act only on a target that is currently
        // `editor` (and, for `/admin/set-role`, may only ever grant
        // `editor`). Runs against the *same* resolved `targetRole` the
        // owner guard below also uses, for every path either guard cares
        // about (`needsRoleBoundaryGuard` is `false` for a path only the
        // owner guard protects, so this is a no-op there). Must run
        // *before* the owner guard's own early `return` on a non-owner
        // target: that `return` is correct for the owner invariant
        // specifically (nothing to guard once the target isn't the
        // owner), but this guard's entire reason to exist is exactly that
        // "nothing to guard" case — an admin acting on another admin,
        // never the owner. Originally placed in `users.ts`/
        // `invitations.ts` (application layer) — moved here on review,
        // because `/admin/set-role`/`/admin/ban-user`/etc. are public
        // endpoints those mutations don't wrap; `adminRole` grants the
        // underlying permission with no target-role rule of its own, and
        // `assertOwnerInvariant` only ever fires for an *owner* target.
        // Measured against the real fixture before this fix: an admin
        // could demote or promote another admin, ban another admin, and
        // remove another admin, all with a plain `200`, straight through
        // `/admin/*`.
        if (needsRoleBoundaryGuard) {
          await guardAdminRoleBoundary(ctx, internalAdapter, targetRole, body)
        }

        if (!needsOwnerGuard) return
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
  } satisfies BetterAuthOptions
}


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

// I1 (Lot 1 final review, re-review): paths where `guardAdminRoleBoundary`
// enforces spec §5's role table ("admin" may invite/edit "editor", never
// another "admin"; everything else is "owner"-only). Deliberately its own
// `Set`, parallel to (not merged into) `OWNER_PROTECTED_PATHS` — same
// reasoning as `SIGN_IN_PATHS` above: a different concern (the RBAC role
// table, not the single-owner invariant), covering a different, only
// partially-overlapping set of paths, with its own lifecycle. Exact path
// names verified against the installed `better-auth@1.6.17`'s
// `plugins/admin/routes.mjs` (`createAuthEndpoint("/admin/...", ...)`
// calls), not written from memory.
//
// `/admin/revoke-user-session` (singular) isn't in this set for the same
// reason it isn't in `OWNER_PROTECTED_PATHS`: it names a session token,
// not a `userId`, and is handled by the `isRevokeSingle` branch instead.
const ADMIN_ROLE_BOUNDARY_PATHS = new Set([
  "/admin/set-role",
  "/admin/ban-user",
  "/admin/unban-user",
  "/admin/remove-user",
  "/admin/update-user",
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

// I1 (Lot 1 final review, re-review): resolves the acting session's role
// for `guardAdminRoleBoundary` below, tolerating both the cookie case
// `getSessionFromCtx` handles natively and the bearer case it cannot —
// see the big comment on `hooks.before`'s round-4 fix above for why:
// `getSessionFromCtx` falls through to a fresh cookie-only lookup whenever
// `ctx.context.session` isn't already populated, and that population is
// exactly what the bearer plugin's own before-hook does — which has not
// run yet when *our* `hooks.before` runs, since ours is registered ahead
// of every plugin's own before-hooks. Verified against the installed
// `better-auth@1.6.17`'s `api/routes/session.mjs`: `getSessionFromCtx`
// starts with `if (ctx.context.session) return ctx.context.session`, and
// only falls back to a request read (cookie-based) when that's unset.
//
// This matters here in a way it didn't for the owner guard's narrow
// self-action carve-out (which can afford to fail closed on an
// unresolvable session — it's a rare, owner-only edge case): `users
// .setRole`/`users.remove` — this app's own, everyday path for exactly
// the actions this guard protects — call `auth.api.setRole`/`auth.api
// .removeUser` with the caller's session forwarded as *precisely* such a
// bearer header. Verified against the installed `@convex-dev/better
// -auth@0.12.5`'s `client/create-client.js`: `getHeaders` builds
// `{ authorization: `Bearer ${session.token}` }` from the caller's own
// session document. Failing closed on an unresolvable session the way the
// owner guard's carve-out does would refuse *every* legitimate call
// through that path, owner and admin-on-editor alike — not a narrow,
// accepted regression, but this guard's entire purpose defeated for its
// main caller.
//
// Resolved via `internalAdapter.findSession`, the exact same primitive
// `isRevokeSingle` above already uses for a session token carried in the
// request *body* — not a second implementation of the bearer plugin's own
// HMAC-signing/verification (verified against the installed `better
// -auth@1.6.17`'s `plugins/bearer/index.mjs`: the token this app's own
// `getHeaders` puts in the `Authorization` header is the *raw, unsigned*
// `session.token` value — the plugin signs it itself, on the caller's
// behalf, only *after* receiving it, so there is no cryptographic
// decision to duplicate here, only the same raw lookup-by-token-value
// `findSession` already performs elsewhere in this file). A wrong answer
// from this resolution is not a new security hole either way: this guard
// only ever *refuses*, never grants — a role resolved from a stale or
// no-longer-valid token, leading to a wrongly-permissive decision here,
// still has to pass `adminMiddleware`'s own real authentication
// afterward, exactly as if this guard did not exist at all.
async function resolveActingRole(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  internalAdapter: NonNullable<NonNullable<OwnerHookEndpointContext["context"]>["internalAdapter"]>,
): Promise<Role | null> {
  const cookieSession = await getSessionFromCtx(ctx).catch(() => null)
  if (cookieSession?.user) return parseRole(cookieSession.user.role)

  const requestLike = ctx.request ?? ctx.headers
  if (!requestLike) return null
  // Same dual-shape handling as better-auth's own `getIp` (verified
  // against `utils/get-request-ip.mjs`): `ctx.request` is a real
  // `Request` (`.headers` is a `Headers` instance); `ctx.headers` alone
  // can be a `Headers` instance or a plain header record, hence the `"get"
  // in headers` branch rather than assuming `.get` always exists.
  const headers = "headers" in requestLike ? requestLike.headers : requestLike
  const authHeader =
    "get" in headers ? headers.get("authorization") : (headers as Record<string, string>).authorization
  if (typeof authHeader !== "string" || authHeader.slice(0, 7).toLowerCase() !== "bearer ") {
    return null
  }
  const token = authHeader.slice(7).trim()
  if (!token) return null

  const found = await internalAdapter.findSession(token)
  return found ? parseRole(found.user.role) : null
}

// I1 (Lot 1 final review, re-review): the role-table check itself. `owner`
// is unrestricted; every other actor — a positively-classified `admin`
// (the case this guard exists for), a positively-classified `editor`
// (already refused by RBAC before this ever runs — `editorRole` grants no
// `user`/`session` permissions at all, see `auth.ts`'s role definitions —
// restricted here too anyway, for the same "don't rely on a second place
// to get this right" reasoning `ownerGuard.ts` gives for computing things
// unconditionally rather than gating on a local pre-check), and an
// unclassifiable or entirely unresolvable actor — is held to the same
// floor: act only on a target that is currently `editor`.
//
// `body` is read raw here, exactly like the owner guard above and for the
// identical reason (round 2's C3): `hooks.before` runs *ahead of* the
// endpoint's own zod body validation, so `/admin/set-role`'s `role` field
// could in principle arrive as something other than a plain string (its
// own schema is `z.union([z.string(), z.array(z.string())])`) before that
// validation ever normalizes it. `parseRole` already refuses anything
// that isn't *exactly* one known role string — an array or a multi-role
// value parses to `null`, which is never `"editor"`, so it's refused by
// the same comparison without a separate array check.
async function guardAdminRoleBoundary(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  internalAdapter: NonNullable<NonNullable<OwnerHookEndpointContext["context"]>["internalAdapter"]>,
  targetRole: Role,
  body: Record<string, unknown> | undefined,
): Promise<void> {
  // A target who *is* the owner is exhaustively somebody else's job
  // already: the owner guard right after this call (for the paths in
  // `OWNER_PROTECTED_PATHS`), or `databaseHooks.user.update.before`'s own
  // `assertOwnerInvariant` (for `/admin/set-role`/`/admin/unban-user`,
  // which route through `internalAdapter.updateUser` and so trigger it,
  // but aren't in `OWNER_PROTECTED_PATHS` — that set is only paths where
  // better-auth can act *before* `databaseHooks` gets a chance to run).
  // Returning here — before even resolving the actor — is what keeps this
  // guard's refusal from shadowing that more specific `OWNER_INVARIANT`
  // one with a less specific `ADMIN_ROLE_BOUNDARY`, not a weaker check:
  // every path this guard covers refuses a non-owner actor targeting the
  // owner through one of those two mechanisms regardless.
  if (targetRole === "owner") return

  const actorRole = await resolveActingRole(ctx, internalAdapter)
  if (actorRole === "owner") return // owner is unrestricted by this guard

  if (targetRole !== "editor") {
    throw APIError.from("FORBIDDEN", {
      code: "ADMIN_ROLE_BOUNDARY",
      message: "ADMIN_ROLE_BOUNDARY: un admin ne peut agir que sur un compte editor",
    })
  }

  if (ctx.path === "/admin/set-role") {
    const requestedRole = parseRole(body?.role)
    if (requestedRole !== "editor") {
      throw APIError.from("FORBIDDEN", {
        code: "ADMIN_ROLE_BOUNDARY",
        message: "ADMIN_ROLE_BOUNDARY: un admin ne peut accorder que le rôle editor",
      })
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
