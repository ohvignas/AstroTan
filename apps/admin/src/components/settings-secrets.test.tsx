// La saisie d'un jeton, ligne par ligne.
//
// Ce fichier tient les trois règles qui font la différence entre « un
// secret rangé » et « un secret affiché » :
//
//   1. `type="password"`, et jamais pré-rempli AVEC LE JETON — un champ
//      posé porte un MASQUE, une suite de points de longueur fixe qui ne
//      dit ni la valeur ni sa longueur ;
//   2. le composant ne reçoit aucune prop qui porterait une valeur, donc
//      il n'existe aucun chemin par lequel il pourrait en afficher une ;
//   3. « vide » veut dire « ne change rien », et retirer est un geste
//      distinct, avec son propre bouton.
//
// Le rendu est statique (`renderToStaticMarkup`, `environment: "node"`) :
// ce qui dépend d'un clic — l'état « Enregistré », le bouton qui s'active
// à la première frappe — n'est pas testé ici. Les décisions qui en
// dépendent sont donc extraites en fonctions pures (`gesteDuChamp`,
// `sansMasque`) et testées comme telles, à la manière de `save-bar.tsx`.
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import {
  CleMaitresseBandeau,
  MASQUE,
  SecretField,
  SecretHorsPortee,
  SecretsReserves,
  gesteDuChamp,
  sansMasque,
} from "./settings-secrets"
import type { SecretEtat } from "./settings-secrets"

/** Un jeton plausible, qui ne doit jamais ressortir d'un rendu. */
const JETON = "re_UN_VRAI_JETON_QUI_NE_DOIT_JAMAIS_SORTIR_1234"

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

/**
 * `toContain("disabled")` serait toujours vrai — les classes utilitaires
 * du bouton contiennent `disabled:opacity-50`. Seul l'attribut compte, et
 * seul celui du bouton visé (même raison que `save-bar.test.tsx`).
 */
function boutonInerte(html: string, libelle: string): boolean {
  const trouve = html.match(new RegExp(`<button([^>]*)>${libelle}</button>`))
  if (trouve === null) throw new Error(`Aucun bouton « ${libelle} » dans ce rendu`)
  return /\sdisabled(?=[\s=>])/.test(trouve[1] ?? "")
}

describe("SecretField", () => {
  test("un jeton posé remplit le champ de points, jamais d'une valeur", () => {
    const html = champ({ base: true, quatreDerniers: "9876", source: "base" })
    expect(html).toContain('type="password"')
    expect(html).toContain(`value="${MASQUE}"`)
    // Le masque, et aucune autre valeur : la seule façon d'afficher un
    // secret serait de le passer en prop, et aucune prop ne le porte.
    expect(html).not.toMatch(/value="(?!•+")[^"]+"/)
  })

  test("sans jeton posé, le champ est vide — il n'y a rien à masquer", () => {
    const html = champ()
    expect(html).toContain('value=""')
    expect(html).toContain("Coller la valeur")
  })

  test("le masque ne dit rien du jeton, pas même sa longueur", () => {
    // Un masque calé sur la vraie longueur serait déjà une fuite : il
    // dirait quel format de clé est posé, et rétrécirait d'autant ce
    // qu'il reste à deviner. Douze points, quelle que soit la clé.
    expect(MASQUE).toMatch(/^•+$/)
    const court = champ({ base: true, source: "base" })
    const long = champ({ nom: "RESEND_API_KEY", base: true, source: "base" })
    for (const html of [court, long]) {
      expect(html).toContain(`value="${MASQUE}"`)
    }
  })

  test("la vraie valeur du jeton n'apparaît nulle part côté client", () => {
    // L'état est DÉLIBÉRÉMENT pollué : une valeur en clair dans un champ
    // que `SecretEtat` ne déclare pas. Le composant ne doit jamais rendre
    // ce qu'il reçoit sans l'avoir choisi — un `{...etat}` étalé dans le
    // JSX, un attribut `data-`, un `JSON.stringify` de mise au point
    // feraient rougir ce test.
    const pollue = {
      ...etat({ base: true, source: "base" }),
      valeur: JETON,
    } as unknown as SecretEtat
    const html = renderToStaticMarkup(
      <SecretField
        etat={pollue}
        disabled={false}
        onSave={async () => {}}
        onClear={async () => {}}
      />
    )
    expect(html).not.toContain(JETON)
    expect(html).not.toContain("re_")
    // Ce que le champ porte à la place, et c'est tout ce qu'il peut porter.
    expect(html).toContain(`value="${MASQUE}"`)
  })

  test("tant que rien n'a été tapé, le bouton est inerte", () => {
    // Masque intact : il n'y a aucun geste à faire, et un bouton actif
    // laisserait croire le contraire.
    expect(boutonInerte(champ({ base: true, source: "base" }), "Enregistrer")).toBe(
      true
    )
    expect(boutonInerte(champ(), "Enregistrer")).toBe(true)
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

  test("l'invite ne s'affiche que là où le champ arrive vide", () => {
    // « Laisser vide pour ne rien changer » ne décrit plus rien : le champ
    // d'un jeton posé n'arrive plus vide, il arrive masqué.
    expect(champ({ base: true, source: "base" })).not.toContain("Laisser vide")
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

describe("sansMasque", () => {
  test("le masque est atomique : le premier geste de frappe l'emporte entier", () => {
    // Douze points ne sont pas douze caractères qu'on éditerait un à un.
    // Taper à la suite du masque donne la valeur seule…
    expect(sansMasque(`${MASQUE}re_abc`)).toBe("re_abc")
    // …et en effacer un seul vide le champ, ce qui se VOIT : le champ
    // devient vide à l'écran, et c'est ce qui rend le retrait délibéré.
    expect(sansMasque(MASQUE.slice(1))).toBe("")
  })

  test("une valeur ordinaire traverse sans être touchée", () => {
    // Aucune clé d'API ne contient de puce ; le point médian n'est retiré
    // que parce qu'il n'a pu venir que du masque.
    expect(sansMasque(JETON)).toBe(JETON)
  })
})

describe("gesteDuChamp", () => {
  test("masque intact : aucun geste", () => {
    expect(gesteDuChamp(MASQUE, true)).toBe("aucun")
  })

  test("une valeur tapée s'enregistre, jeton posé ou non", () => {
    expect(gesteDuChamp("re_abc", true)).toBe("enregistrer")
    expect(gesteDuChamp("re_abc", false)).toBe("enregistrer")
  })

  test("champ vide sans jeton posé : rien à faire", () => {
    expect(gesteDuChamp("", false)).toBe("aucun")
    expect(gesteDuChamp("   ", false)).toBe("aucun")
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
