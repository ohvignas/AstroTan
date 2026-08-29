import { useState } from "react"
import type { Verdict } from "@astrotan/backend/convex/dns"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------
// Ce que le résolveur a répondu, ligne par ligne.
//
// Ce composant N'ÉCRIT AUCUNE INSTRUCTION. Le type, le nom et la valeur de
// l'enregistrement à créer sont composés dans `convex/dns.ts`
// (`instruction()`), où un test les exige ; les recomposer ici en JSX
// donnerait une seconde phrase, non testée, qui divergerait de la première
// à la première correction — et une instruction DNS fausse se paie en
// enregistrements créés pour rien chez l'hébergeur de l'adoptant.
//
// Il décide en revanche QUAND une instruction s'affiche, et c'est tout son
// rôle :
//
//   - `ok` : rien. Une instruction posée à côté d'une coche fait douter de
//     la coche, et fait recréer un enregistrement déjà en place.
//   - `indisponible` : rien non plus, et surtout pas l'instruction — le
//     résolveur n'a pas répondu, on ne sait donc RIEN de ce qui existe.
//     `convex/dns.ts` tient déjà `manquant` et `indisponible` séparés pour
//     cette raison exacte ; les confondre ici annulerait la distinction.
// ---------------------------------------------------------------------

const ETATS: Record<Verdict["etat"], { texte: string; classe: string }> = {
  ok: { texte: "En place", classe: "bg-muted text-muted-foreground" },
  manquant: { texte: "À poser", classe: "bg-destructive/10 text-destructive" },
  different: { texte: "À corriger", classe: "bg-destructive/10 text-destructive" },
  indisponible: { texte: "Non lu", classe: "bg-muted text-muted-foreground" },
}

export function ResultatsDns({ verdicts }: { verdicts: Verdict[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {verdicts.map((verdict) => (
        <LigneVerdict key={verdict.cle} verdict={verdict} />
      ))}
    </ul>
  )
}

function LigneVerdict({ verdict }: { verdict: Verdict }) {
  const etat = ETATS[verdict.etat]
  return (
    <li
      data-testid={`verdict-${verdict.cle}`}
      data-etat={verdict.etat}
      className="flex flex-col gap-1.5 border-l-2 border-border pl-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex h-5 shrink-0 items-center rounded-4xl px-2 text-xs font-medium ${etat.classe}`}
        >
          {etat.texte}
        </span>
        <span className="text-sm font-medium">{verdict.libelle}</span>
      </div>

      {verdict.etat === "ok" ? (
        <ValeursTrouvees valeurs={verdict.trouve} />
      ) : verdict.etat === "indisponible" ? (
        <p className="text-sm text-muted-foreground">
          Le résolveur DNS n&apos;a pas répondu. Réessayez dans un instant :
          tant que la lecture n&apos;aboutit pas, on ignore ce que ce nom
          porte déjà, et un enregistrement posé à l&apos;aveugle se
          diagnostique des semaines plus tard.
        </p>
      ) : (
        <>
          <p className="text-sm">{verdict.instruction}</p>
          {/* On copie l'INSTRUCTION, pas `attendu`. Deux des cinq lignes
              ont pour valeur attendue une description et non une valeur —
              « l'adresse IPv4 publique de votre serveur », « la clé
              publique fournie par Resend » : un bouton qui collerait ça
              dans le champ « valeur » de l'hébergeur serait un piège.
              L'instruction, elle, porte toujours les trois éléments et
              reste vraie mot pour mot. */}
          <BoutonCopier texte={verdict.instruction} />
          {verdict.etat === "different" ? (
            <ValeursTrouvees valeurs={verdict.trouve} />
          ) : null}
        </>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------
// L'origine que porte SITE_URL — celle des liens envoyés par email.
//
// Un état, pas une explication : le raisonnement complet (pourquoi cette
// valeur ne se règle pas depuis un champ, ce qu'elle compose) vit en
// commentaire dans `email-templates.tsx` et `settings-environment.tsx`
// (bloc « Domaine & emails — RETIRÉE »), pas ici. Le seul cas qui vaille un
// signal est celui qu'`AvertissementDivergence` (`domaine.tsx`) porte déjà
// pour `WEB_SITE_URL` : aligné sur la même forme plutôt que d'en inventer
// une seconde.
// ---------------------------------------------------------------------

export function OrigineDesLiens({
  adminUrl,
  hote,
  correspond,
  declare,
}: {
  adminUrl: string | null
  /** L'hôte de `adminUrl`, déjà résolu par l'appelant — voir `hoteDe` dans `domaine.tsx`. */
  hote: string | null
  correspond: boolean
  declare: string | null
}) {
  if (correspond) {
    return (
      <p className="text-sm text-muted-foreground">
        Origine des liens des emails :{" "}
        {adminUrl === null ? (
          "non réglée"
        ) : (
          <code className="text-xs">{adminUrl}</code>
        )}
      </p>
    )
  }
  return (
    <p className="text-sm">
      <strong>
        Ces liens partent de{" "}
        {hote === null ? (
          "aucune origine réglée"
        ) : (
          <code className="text-xs">{hote}</code>
        )}
      </strong>
      , pas de <code className="text-xs">{declare}</code> : ils ne mènent
      nulle part.
    </p>
  )
}

/** Ce que le résolveur a rendu — la moitié de l'écart, quand il y en a un. */
function ValeursTrouvees({ valeurs }: { valeurs: string[] }) {
  if (valeurs.length === 0) return null
  return (
    <p className="text-xs break-all text-muted-foreground">
      Trouvé : <code>{valeurs.join(" · ")}</code>
    </p>
  )
}

function BoutonCopier({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-fit"
      onClick={() => {
        void navigator.clipboard.writeText(texte)
        setCopie(true)
        window.setTimeout(() => setCopie(false), 2_000)
      }}
    >
      {copie ? "Copié" : "Copier"}
    </Button>
  )
}
