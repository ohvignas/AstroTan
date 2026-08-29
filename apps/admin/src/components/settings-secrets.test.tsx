// La saisie d'un jeton, ligne par ligne.
//
// Ce fichier tient les trois règles qui font la différence entre « un
// secret rangé » et « un secret affiché » :
//
//   1. `type="password"`, et JAMAIS pré-rempli — une valeur pré-remplie
//      part dans le HTML de la page ;
//   2. le composant ne reçoit aucune prop qui porterait une valeur, donc
//      il n'existe aucun chemin par lequel il pourrait en afficher une ;
//   3. « vide » veut dire « ne change rien », et retirer est un geste
//      distinct, avec son propre bouton.
//
// Le rendu est statique (`renderToStaticMarkup`, `environment: "node"`) :
// ce qui dépend d'un clic — l'état « Enregistré », le bouton qui s'active
// à la première frappe — n'est pas testé ici, et le dire vaut mieux que de
// monter un DOM complet pour deux assertions.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import {
  CleMaitresseBandeau,
  SecretField,
  SecretHorsPortee,
  SecretsReserves,
} from "./settings-secrets"
import type { SecretEtat } from "./settings-secrets"

function etat(patch: Partial<SecretEtat> = {}): SecretEtat {
  return {
    nom: "OPENROUTER_API_KEY",
    environnement: false,
    base: false,
    illisible: false,
    quatreDerniers: null,
    majAt: null,
    source: "aucune",
    ...patch,
  }
}

function champ(patch: Partial<SecretEtat> = {}, disabled = false): string {
  return renderToStaticMarkup(
    <SecretField
      etat={etat(patch)}
      disabled={disabled}
      onSave={async () => {}}
      onClear={async () => {}}
    />
  )
}

describe("SecretField", () => {
  test("le champ est en type=password et vide", () => {
    const html = champ({ base: true, quatreDerniers: "9876", source: "base" })
    expect(html).toContain('type="password"')
    expect(html).toContain('value=""')
    // Aucune autre valeur que la chaîne vide : la seule façon d'afficher un
    // secret serait de le passer en prop, et aucune prop ne le porte.
    expect(html).not.toMatch(/value="[^"]+"/)
  })

  test("les quatre derniers caractères, et rien de plus, identifient le jeton posé", () => {
    // La question fréquente à laquelle ce fragment répond : « celle qui est
    // posée est-elle bien celle de mon gestionnaire de mots de passe ? »
    const html = champ({ base: true, quatreDerniers: "9876", source: "base" })
    expect(html).toContain("9876")
    expect(html).toContain("Saisi ici, chiffré")
  })

  test("« Retirer de la base » n'apparaît que s'il y a quelque chose à retirer", () => {
    expect(champ({ base: true, source: "base" })).toContain("Retirer de la base")
    // Absent en base : le bouton n'aurait rien à faire, et il laisserait
    // croire qu'il enlève la variable d'environnement.
    expect(champ({ environnement: true, source: "environnement" })).not.toContain(
      "Retirer de la base"
    )
  })

  test("l'invite dit ce que « vide » signifie", () => {
    expect(champ({ base: true, source: "base" })).toContain(
      "Laisser vide pour ne rien changer"
    )
    expect(champ()).toContain("Coller la valeur")
  })

  test("désactivé, aucun champ n'est rendu du tout", () => {
    // Un `<input disabled>` invite quand même à taper. Pour un editor, ou
    // sans clé maîtresse, il n'y a rien à taper.
    const html = champ({ base: true, source: "base" }, true)
    expect(html).not.toContain("<input")
    expect(html).not.toContain("Enregistrer")
    // L'état, lui, reste lisible.
    expect(html).toContain("OPENROUTER_API_KEY")
  })

  test("le navigateur ne doit ni retenir ni compléter une clé d'API", () => {
    // Insensible à la casse : React SSR écrit l'attribut tel qu'il l'a reçu
    // (`autoComplete`), et les noms d'attributs HTML sont insensibles à la
    // casse — c'est bien `autocomplete=off` que le navigateur lit.
    expect(champ()).toMatch(/autocomplete="off"/i)
  })
})

describe("CleMaitresseBandeau", () => {
  test("posée, il écrit la règle de précédence — c'est là qu'on la lit", () => {
    const html = renderToStaticMarkup(<CleMaitresseBandeau etat="posee" />)
    expect(html).toMatch(/environnement du même nom l(&#x27;|')emporte/)
    expect(html).toContain("AES-GCM")
  })

  test("absente et illisible ne disent pas la même chose", () => {
    const absente = renderToStaticMarkup(<CleMaitresseBandeau etat="absente" />)
    const illisible = renderToStaticMarkup(
      <CleMaitresseBandeau etat="illisible" />
    )
    expect(absente).toMatch(/Aucune clé maîtresse/)
    expect(illisible).toMatch(/32 octets/)
    // Les deux donnent la commande : c'est la seule chose à faire.
    for (const html of [absente, illisible]) {
      expect(html).toContain("openssl rand -base64 32")
    }
  })

  test("aucun repli en clair n'est proposé nulle part", () => {
    // Un chiffrement à clé absente serait décoratif, et un écran qui
    // affiche « chiffré » sur du clair est pire que pas de chiffrement.
    const html = renderToStaticMarkup(<CleMaitresseBandeau etat="absente" />)
    expect(html).toMatch(/le repli en clair n(&#x27;|')existe pas/)
  })
})

describe("SecretHorsPortee", () => {
  test("dit qu'elle ne se règle pas ici, et n'offre aucun champ", () => {
    const html = renderToStaticMarkup(
      <SecretHorsPortee nom="PUBLIC_META_PIXEL_ID" raison="Figée au build." />
    )
    expect(html).toContain("PUBLIC_META_PIXEL_ID")
    expect(html).toContain("Ne se règle pas ici")
    expect(html).not.toContain("<input")
  })
})

describe("SecretsReserves", () => {
  test("un editor lit pourquoi il ne voit rien", () => {
    const html = renderToStaticMarkup(<SecretsReserves />)
    expect(html).toMatch(/réservés au\s+propriétaire/)
  })
})
