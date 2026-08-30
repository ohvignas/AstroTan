// Constat 4b (relecture finale, mineur) : `accept-invite.tsx` et
// `password-strength-meter.tsx` recopiaient `8` et `128` en dur, là où
// `reset-password.tsx` et `_authed/compte.tsx` importent
// `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH` (`passwordStrength.ts`).
// Trois sources pour la même valeur : le jour où une borne bouge, deux
// écrans affichent l'ancienne en face du refus du serveur.
//
// SOURCE, pas rendu : un test qui se contente de vérifier que le HTML rendu
// contient « 8 caractères » ne discrimine RIEN ici, puisque
// `MIN_PASSWORD_LENGTH` vaut aujourd'hui... 8 — un texte recopié en dur et
// un texte qui importe la constante produisent le même rendu par pure
// coïncidence de valeur. Les deux tests ci-dessous lisent donc la SOURCE,
// comme `passe.test.ts` le fait déjà pour une propriété d'absence (« il ne
// fait rien d'autre ») : ils vérifient QUE la valeur vient de l'import, pas
// seulement qu'elle est actuellement correcte.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

function sourceDe(cheminRelatif: string): string {
  return readFileSync(fileURLToPath(new URL(cheminRelatif, import.meta.url)), "utf8")
}

describe("password-strength-meter.tsx — les messages citent passwordStrength.ts, pas des nombres recopiés", () => {
  const source = sourceDe("./password-strength-meter.tsx")

  test("importe MIN_PASSWORD_LENGTH et MAX_PASSWORD_LENGTH depuis passwordStrength.ts", () => {
    expect(source).toMatch(/MIN_PASSWORD_LENGTH/)
    expect(source).toMatch(/MAX_PASSWORD_LENGTH/)
  })

  test("les messages TOO_SHORT/TOO_LONG interpolent les constantes, pas « 8 »/« 128 » en dur", () => {
    expect(source).toMatch(/TOO_SHORT:\s*`[^`]*\$\{MIN_PASSWORD_LENGTH\}[^`]*`/)
    expect(source).toMatch(/TOO_LONG:\s*`[^`]*\$\{MAX_PASSWORD_LENGTH\}[^`]*`/)
    expect(source).not.toMatch(/TOO_SHORT:\s*"[^"]*\b8\b/)
    expect(source).not.toMatch(/TOO_LONG:\s*"[^"]*\b128\b/)
  })
})

describe("accept-invite.tsx — l'indice affiché avant saisie cite les mêmes bornes", () => {
  // `AcceptInviteCard` dépend de `convex/react` (useQuery/useMutation) et du
  // routeur — la rendre demanderait un `ConvexProvider` et un contexte de
  // route pour une seule phrase statique. Même lecture de SOURCE que
  // ci-dessus, pour la même raison.
  const source = sourceDe("../routes/accept-invite.tsx")

  test("importe MIN_PASSWORD_LENGTH et MAX_PASSWORD_LENGTH depuis passwordStrength.ts", () => {
    expect(source).toMatch(/MIN_PASSWORD_LENGTH/)
    expect(source).toMatch(/MAX_PASSWORD_LENGTH/)
  })

  test("n'affiche plus « 8 » ni « 128 » recopiés en dur", () => {
    expect(source).not.toMatch(/Entre\s+8\s+et\s+128/)
  })
})
