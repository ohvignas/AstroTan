import { convexTest, type TestConvex } from "convex-test"
import schema from "../convex/schema"
import betterAuthSchema from "../convex/betterAuth/schema"
import { createAuth } from "../convex/auth"
import { components } from "../convex/_generated/api"
import resendTest from "@convex-dev/resend/test"
import rateLimiterTest from "@convex-dev/rate-limiter/test"
import agentTest from "@convex-dev/agent/test"

// Fixture partagée entre `lib/authz.test.ts` (la matrice de permissions du
// registre), `profiles.test.ts` (les triggers Better Auth) et
// `auth.ownerInvariant.test.ts` (l'invariant single-owner) : les trois
// dépendent du même composant `betterAuth` enregistré et de la même façon
// de construire une identité Convex qui correspond à une *vraie* session
// plutôt qu'à une identité nue. Dupliquer cette logique dans chaque
// fichier de test est la même forme d'erreur que celle que le fix de
// `_registry.test.ts` a corrigée : des copies qui peuvent diverger
// silencieusement sans qu'aucun test ne le remarque.
//
// Vit délibérément HORS de `convex/` (round 2 du fix — round 1 l'avait
// placé sous `convex/testing/`, ce qui était une erreur) : `convex/` est
// balayé et bundlé tel quel par le vrai déploiement Convex, et le
// bundler analyse chaque fichier avec son propre runtime, qui n'a pas
// `import.meta` — `import.meta.glob` (ci-dessous) y échoue avec
// `Uncaught TypeError: import.meta unsupported`, mesuré avec un vrai
// `convex dev --once`, pas seulement supposé. `tsc --noEmit` et `vitest`
// ne voient pas cette différence (Vite/Vitest supportent `import.meta`),
// donc rien côté typecheck/tests ne l'aurait révélé — round 1 avait déjà
// vérifié que ce fichier ne porte aucun import *runtime* de test-only
// package pour rester "safe to deploy" s'il finissait bundlé quand même,
// mais "safe to deploy" est une propriété qu'il aurait fallu ré-établir à
// chaque édition future, par le raisonnement seul, sans rien pour
// prévenir une régression. En dehors de `convex/`, la question ne se
// pose plus : ce fichier n'est jamais un point d'entrée candidat pour le
// bundler Convex, donc `import.meta.glob` (et n'importe quel import
// runtime de `convex-test`) est sans risque ici.
// I9 (Lot 1 final review): the admin app actually serves on :3001 (port
// 3000 belongs to a different app in this project) — a fixture hardcoding
// the wrong port made the test suite self-consistently wrong about what
// origin a real deployment would use.
export const ORIGIN = "http://localhost:3001"

// Chemins relatifs à CE fichier (`packages/backend/testing/`), donc
// remontent d'un niveau puis entrent dans `convex/`.
export const modules = import.meta.glob("../convex/**/*.ts")
export const betterAuthModules = import.meta.glob("../convex/betterAuth/**/*.ts")

export function makeTestConvex(): TestConvex<typeof schema> {
  const t = convexTest(schema, modules)
  t.registerComponent("betterAuth", betterAuthSchema, betterAuthModules)
  // `@convex-dev/resend` ships its own convex-test registration helper
  // (`@convex-dev/resend/test`'s `register`) rather than a Local Install
  // vendored into this repo the way `betterAuth` is — it's a genuine
  // third-party component, used as published, so its own official helper
  // is the right way to wire it into the mock backend rather than
  // hand-rolling a second registration mechanism here. Registers under the
  // name `"resend"`, matching `app.use(resend)` in `convex/convex.config.ts`
  // (the default name both the helper and `defineComponent("resend")`
  // agree on).
  resendTest.register(t)
  // `auth.ts`'s `hooks.before` calls the rate limiter on every
  // `/sign-in/email` request (see `lib/signInRateLimit.ts`), including the
  // ones this fixture's own `signIn()` helper makes — so every test that
  // signs in at all, not just the rate-limit tests themselves, now goes
  // through this component. Same registration pattern as `resendTest`
  // above: the component's own `/test` helper, not a hand-rolled one.
  rateLimiterTest.register(t)
  // Same pattern as resend and the rate limiter: the component's own
  // `/test` helper, registered under `"agent"` (the default of
  // `register(t)`), matching `app.use(agent)` → `components.agent`.
  agentTest.register(t)
  return t
}

// Seeding server-side (pas de `headers`/`request`) : l'échappatoire de
// bootstrap documentée du plugin admin (`if (!session && (ctx.request ||
// ctx.headers)) throw UNAUTHORIZED` est sautée quand les deux sont
// absents), pas un contournement de ce fixture — écrit en premier dans
// `auth.ownerInvariant.test.ts` (Task 6), repris ici tel quel.
export async function seedUser(
  t: TestConvex<typeof schema>,
  user: { email: string; password: string; name: string; role: "owner" | "admin" | "editor" },
) {
  const result = await t.run(async (ctx) => {
    const auth = createAuth(ctx)
    return auth.api.createUser({ body: user })
  })
  return (result as { user: { id: string; role: string } }).user
}

export async function signIn(t: TestConvex<typeof schema>, email: string, password: string) {
  const res = await t.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) {
    throw new Error(`sign-in failed for ${email}: HTTP ${res.status}`)
  }
  const setCookies: string[] = res.headers.getSetCookie()
  const sessionCookie = setCookies
    .map((c) => c.split(";")[0] ?? "")
    .find((c) => c.startsWith("better-auth.session_token="))
  if (!sessionCookie) throw new Error("sign-in did not set a session cookie")
  return sessionCookie
}

// Construit une identité Convex de test qui correspond à une *vraie*
// session Better Auth : `authComponent.safeGetAuthUser` (donc
// `requireRole`, donc tout ce qui en dépend) lit `identity.subject` comme
// l'id utilisateur Better Auth et `identity.sessionId` comme l'`_id`
// Convex du document `session` du composant — vérifié dans
// `@convex-dev/better-auth@0.12.5`'s `src/client/create-client.ts`
// (`safeGetAuthUser`) et `src/plugins/convex/index.ts` (`definePayload`
// pose `sessionId: session.id`, où `session.id` est l'`_id` Convex de la
// session, mappé par l'adaptateur). Une identité Convex "nue"
// (`t.withIdentity({subject: ...})`, sans session réelle derrière) ne peut
// pas exercer ce chemin — d'où cette construction plutôt que de fabriquer
// ces deux champs à la main. Suppose qu'une session existe déjà pour cet
// utilisateur (appeler `signIn` d'abord).
export async function identityFor(t: TestConvex<typeof schema>, userId: string) {
  const sessionDoc = await t.run(async (ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "session",
      where: [{ field: "userId", operator: "eq", value: userId }],
    }),
  )
  const sessionId = (sessionDoc as { _id?: string } | null)?._id
  if (!sessionId) throw new Error("no session found for user " + userId)
  const userDoc = await t.run(async (ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: userId }],
    }),
  )
  const user = userDoc as {
    role?: string | null
    email?: string
    banned?: boolean | null
    banExpires?: number | null
  } | null
  // Les claims du jeton de production (`definePayload` = user hors id/image).
  // `requireRoleFromIdentity` les lit ; `requireRole` n'en a pas besoin.
  return t.withIdentity({
    subject: userId,
    sessionId,
    role: user?.role ?? undefined,
    email: user?.email,
    banned: user?.banned ?? undefined,
    banExpires: user?.banExpires ?? undefined,
  })
}
