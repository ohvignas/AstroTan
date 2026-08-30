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
  ActionsDuChamp,
  CleMaitresseBandeau,
  ConfirmationRetrait,
  MASQUE,
  SecretField,
  SecretHorsPortee,
  SecretsReserves,
  gesteDuChamp,
  sansMasque,
} from "./settings-secrets"
import type { Geste, SecretEtat } from "./settings-secrets"

/** Un jeton plausible, qui ne doit jamais ressortir d'un rendu. */
const JETON = "re_UN_VRAI_JETON_QUI_NE_DOIT_JAMAIS_SORTIR_1234"

function etat(patch: Partial<SecretEtat> = {}): SecretEtat {
  return {
    nom: "OPENROUTER_API_KEY",
    environnement: false,
    base: false,
    illisible: false,
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
    const html = champ({ base: true, source: "base" })
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

  test("la ligne ne porte plus ni pastille « saisi ici », ni fragment, ni date", () => {
    // Les points disent qu'un jeton est posé — la pastille le redisait.
    // Le fragment était quatre caractères du secret, et la date répondait
    // à une question que personne ne se pose devant ce champ. L'état est
    // à nouveau pollué : si l'un des trois revenait, ce test rougirait.
    const pollue = {
      ...etat({ base: true, source: "base" }),
      quatreDerniers: "9876",
      majAt: 1_788_000_000_000,
    } as unknown as SecretEtat
    const html = renderToStaticMarkup(
      <SecretField
        etat={pollue}
        disabled={false}
        onSave={async () => {}}
        onClear={async () => {}}
      />
    )
    expect(html).not.toContain("Saisi ici")
    expect(html).not.toContain("9876")
    expect(html).not.toMatch(/saisi le/)
  })

  test("les pastilles qui restent disent ce que les points ne disent pas", () => {
    // « Saisi ici, chiffré » doublait les points. Les trois autres, non :
    // aucun point ne s'affiche pour une variable d'environnement (elle
    // n'est pas en base), ni pour un jeton absent, et « Illisible » est
    // un état d'erreur que rien d'autre ne porte.
    expect(champ({ environnement: true, source: "environnement" })).toContain(
      "Environnement"
    )
    expect(champ()).toContain("Absent")
    expect(champ({ base: true, illisible: true, source: "aucune" })).toContain(
      "Illisible"
    )
  })

  test("l'état d'un jeton ne porte aucune chaîne, hormis son nom", () => {
    // Ce que la query rend est un ÉTAT, pas une valeur ni un morceau de
    // valeur. `quatreDerniers` en était un morceau : quatre caractères du
    // secret, qui traversaient le réseau pour être affichés. `source` est
    // une énumération de trois littéraux, pas une donnée. Ce test rougit
    // si une chaîne de plus entre dans `SecretEtat`.
    const chaines = Object.entries(etat({ base: true, source: "base" }))
      .filter(([, valeur]) => typeof valeur === "string")
      .map(([nomDuChamp]) => nomDuChamp)
    expect(chaines).toEqual(["nom", "source"])
  })

  test("il n'y a plus de bouton « Retirer de la base »", () => {
    // Il était toujours visible à côté d'« Enregistrer » : le geste le
    // plus destructeur de l'écran tenait en un clic, sans confirmation.
    expect(champ({ base: true, source: "base" })).not.toContain("Retirer")
    expect(champ({ environnement: true, source: "environnement" })).not.toContain(
      "Retirer"
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

  test("champ vidé sur un jeton posé : supprimer", () => {
    // Le troisième état, et celui qui n'existait pas : « vidé » n'est pas
    // « intact ». Les confondre, c'est soit perdre une clé sans le
    // vouloir, soit ne plus pouvoir la retirer du tout.
    expect(gesteDuChamp("", true)).toBe("supprimer")
    expect(gesteDuChamp("   ", true)).toBe("supprimer")
  })
})

describe("ActionsDuChamp", () => {
  function actions(geste: Geste): string {
    return renderToStaticMarkup(
      <ActionsDuChamp
        geste={geste}
        enCours={false}
        fait={null}
        onEnregistrer={() => {}}
        onSupprimer={() => {}}
      />
    )
  }

  test("le bouton dit lequel des deux gestes il fait", () => {
    // Un bouton « Enregistrer » qui supprime serait le pire des deux
    // mondes : le mot dit une chose, le clic en fait une autre.
    expect(actions("enregistrer")).toContain("Enregistrer")
    expect(actions("supprimer")).toContain("Supprimer")
    expect(actions("supprimer")).not.toContain("Enregistrer")
  })

  test("aucun bouton de retrait ne double le bouton principal", () => {
    for (const geste of ["aucun", "enregistrer", "supprimer"] as const) {
      expect(actions(geste)).not.toContain("Retirer de la base")
    }
  })

  test("rien à faire : le bouton est inerte ; un retrait demandé : il ne l'est pas", () => {
    expect(boutonInerte(actions("aucun"), "Enregistrer")).toBe(true)
    expect(boutonInerte(actions("supprimer"), "Supprimer")).toBe(false)
    expect(boutonInerte(actions("enregistrer"), "Enregistrer")).toBe(false)
  })
})

describe("ConfirmationRetrait", () => {
  function confirmation(environnement: boolean): string {
    return renderToStaticMarkup(
      <ConfirmationRetrait
        nom="RESEND_API_KEY"
        environnement={environnement}
        consequence="Les envois du site s'arrêtent, invitations comprises."
        enCours={false}
        onConfirmer={() => {}}
        onAnnuler={() => {}}
      />
    )
  }

  test("elle nomme le jeton, dit ce que le retrait coûte, et laisse revenir", () => {
    const html = confirmation(false)
    expect(html).toContain("RESEND_API_KEY")
    expect(html).toMatch(/invitations comprises/)
    expect(html).toContain("Annuler")
  })

  test("quand la variable d'environnement existe, elle dit que rien ne changera", () => {
    // La précédence : l'environnement l'emporte, donc retirer la ligne de
    // base ne coupe rien. Annoncer la conséquence ici serait un mensonge
    // qui ferait renoncer à un ménage sans risque.
    const html = confirmation(true)
    expect(html).toMatch(/continuera de servir/)
    expect(html).not.toMatch(/invitations comprises/)
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
