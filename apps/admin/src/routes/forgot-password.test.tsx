// La promesse de cet écran tient dans une phrase, et c'est cette phrase
// qui est testée ici : après un envoi, la page dit la même chose pour une
// adresse qui a un compte et pour une adresse qui n'en a pas.
//
// Ce que ce fichier ne teste PAS, et pourquoi : la page elle-même. Elle
// contient un `<Link>`, qui exige un `RouterProvider` monté ;
// `vitest.config.ts` est en `environment: "node"` et rend avec
// `renderToStaticMarkup` (voir l'en-tête de `settings-nav.test.tsx`, même
// arbitrage). Les composants qui portent le texte sont donc exportés et
// rendus seuls.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { ConfirmationDemande } from "./forgot-password"

const sourceDe = (chemin: string) =>
  readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), "utf8")

describe("ConfirmationDemande", () => {
  test("après envoi, la page dit la même chose quelle que soit l'adresse", () => {
    // La phrase est délibérément au conditionnel : « si un compte
    // existe ». Une confirmation affirmative — « email envoyé » — dirait à
    // qui la provoque que l'adresse a un compte, et annulerait tout ce que
    // le serveur fait pour taire cette information.
    const html = renderToStaticMarkup(
      <ConfirmationDemande email="inconnu@exemple.fr" />
    )
    expect(html).toMatch(/si un compte existe/i)
    expect(html).not.toMatch(/nous avons envoyé/i)
  })

  test("aucune formulation affirmative ne s'y glisse", () => {
    // Le test ci-dessus fige la bonne phrase ; celui-ci ferme les
    // formulations qui la remplaceraient sans la contredire
    // littéralement. « un email a été envoyé », « vérifiez votre boîte »
    // affirment toutes deux qu'il s'est passé quelque chose pour cette
    // adresse-là.
    const html = renderToStaticMarkup(
      <ConfirmationDemande email="inconnu@exemple.fr" />
    )
    for (const affirmation of [
      /a été envoyé/i,
      /vient d'être envoyé/i,
      /vérifiez votre (boîte|messagerie)/i,
      /consultez votre (boîte|messagerie)/i,
    ]) {
      expect(html, affirmation.source).not.toMatch(affirmation)
    }
  })

  test("l'adresse connue et l'adresse inconnue rendent le même texte", () => {
    // La seule différence admise entre les deux rendus est l'adresse
    // qu'on vient de retaper à l'écran — jamais un mot de plus, jamais un
    // mot de moins.
    const inconnue = renderToStaticMarkup(
      <ConfirmationDemande email="inconnu@exemple.fr" />
    )
    const connue = renderToStaticMarkup(
      <ConfirmationDemande email="proprietaire@exemple.fr" />
    )
    expect(connue.replace("proprietaire@exemple.fr", "inconnu@exemple.fr")).toBe(
      inconnue
    )
  })
})

describe("la page de connexion mène à la récupération", () => {
  // Sans ce lien, les deux écrans existent et personne ne les trouve :
  // rien d'autre dans l'application ne pointe vers `/forgot-password`, et
  // quelqu'un enfermé dehors ne peut pas le chercher depuis l'intérieur.
  //
  // Lu dans la SOURCE plutôt que rendu : `LoginForm` appelle `useNavigate`
  // et rend un `<Link>`, tous deux inertes hors d'un routeur monté. Le
  // test lit donc ce qu'il peut réellement garantir — que la destination
  // est écrite dans l'écran de connexion, et qu'elle correspond à un
  // fichier de route existant.
  test("le formulaire de connexion pointe vers /forgot-password", () => {
    expect(sourceDe("../components/login-form.tsx")).toContain(
      'to="/forgot-password"'
    )
  })

  test("cette destination est une route qui existe", () => {
    expect(() => sourceDe("./forgot-password.tsx")).not.toThrow()
  })
})
