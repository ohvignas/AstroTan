import type { TestConvex } from "convex-test"
import type schema from "../schema"
import { createAuth } from "../auth"
import { components } from "../_generated/api"

// Fixture partagée entre `lib/authz.test.ts` (la matrice de permissions du
// registre) et `profiles.test.ts` (les triggers Better Auth) : les deux
// dépendent du même composant `betterAuth` enregistré et de la même façon
// de construire une identité Convex qui correspond à une *vraie* session
// plutôt qu'à une identité nue. Dupliquer cette logique dans chaque
// fichier de test serait la même forme d'erreur que celle que le fix de
// `_registry.test.ts` vient de corriger : deux copies qui peuvent
// diverger silencieusement sans qu'aucun test ne le remarque.
//
// `convex/` est balayé et bundlé tel quel par le vrai déploiement Convex —
// vérifié dans `node_modules/convex/dist/cli.bundle.cjs`, la fonction
// `entryPoints()` du CLI : tout fichier `.ts` dont le nom de base ne
// contient qu'UN seul point est un point d'entrée candidat (avec
// `_generated/`, les dotfiles et `schema.ts` comme seules autres
// exceptions nommées) ; seul un nom à deux points ou plus — comme
// `*.test.ts` — en est exclu. `betterAuthFixture.ts` n'a qu'un seul point,
// donc CE fichier serait balayé et bundlé pour de vrai. Il reste donc
// volontairement sans aucun import *runtime* de `convex-test`/`vitest` :
// `TestConvex` n'est importé qu'en `import type` (effacé à la
// compilation, aucune trace dans le bundle), et rien ici n'appelle
// `expect(...)` — les échecs sont des `throw new Error(...)` ordinaires.
// `convexTest(...)` lui-même (qui a besoin de la *valeur* du paquet, pas
// seulement de son type) reste donc en dehors de ce fichier, redéfini à
// l'identique dans chaque `.test.ts` appelant (ces fichiers-là ont deux
// points dans leur nom, donc sont déjà exclus du bundle par la même règle).
export const ORIGIN = "http://localhost:3000"

// Simples macros Vite compilées en données statiques à la construction —
// aucune dépendance runtime à `convex-test` ici non plus, donc sûres à
// exporter depuis un fichier bundlé pour de vrai.
export const modules = import.meta.glob("../**/*.ts")
export const betterAuthModules = import.meta.glob("../betterAuth/**/*.ts")

// Seeding server-side (pas de `headers`/`request`) : l'échappatoire de
// bootstrap documentée du plugin admin (`if (!session && (ctx.request ||
// ctx.headers)) throw UNAUTHORIZED` est sautée quand les deux sont
// absents), pas un contournement de ce fixture — voir
// `auth.ownerInvariant.test.ts` pour la même construction, écrite en
// premier là-bas.
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
  return t.withIdentity({ subject: userId, sessionId })
}
