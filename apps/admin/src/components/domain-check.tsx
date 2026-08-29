import { useState } from "react"
import type { Verdict } from "@astrotan/backend/convex/dns"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// ---------------------------------------------------------------------
// Les enregistrements DNS à poser, et lesquels sont là.
//
// UN TABLEAU, PAS DES PARAGRAPHES. Cet écran rendait un bloc de prose par
// vérification : le verdict en toutes lettres, l'instruction en toutes
// lettres, et les valeurs trouvées concaténées dans une phrase — huit
// enregistrements TXT à la file pour un domaine réel. Personne ne lisait
// ça. Une ligne par enregistrement, et à droite un signe.
//
// TROIS SIGNES, PAS DEUX. `convex/dns.ts` rend quatre états et tient
// `manquant` et `indisponible` séparés exprès : « le résolveur n'a pas
// répondu » n'est pas « c'est absent ». L'un se réessaie, l'autre se crée,
// et les confondre en rouge fait créer chez l'hébergeur un doublon qui se
// diagnostique des semaines plus tard. `manquant` et `different`, eux,
// appellent le même geste — aller chez l'hébergeur — et partagent donc le
// rouge ; `data-etat` porte encore les quatre pour les tests.
//
// CE COMPOSANT N'ÉCRIT AUCUNE INSTRUCTION. Le type, le nom et la valeur de
// l'enregistrement à créer sont composés dans `convex/dns.ts`
// (`instruction()`), où un test les exige ; les recomposer ici en JSX
// donnerait une seconde phrase, non testée, qui divergerait de la première
// à la première correction. Il décide en revanche OÙ elle s'affiche : dans
// le repli, jamais dans le flux.
//
// POURQUOI LE NOM DNS EST DANS LE REPLI ET NON DANS UNE COLONNE. `Verdict`
// ne porte ni `nom` ni `type` comme champs : ils n'existent que fondus dans
// la phrase `instruction`. Les rejouer ici depuis `cle` et le domaine
// (`resend._domainkey.<hôte>`, `_dmarc.<hôte>`) serait une seconde copie
// des tables `controlesSite` / `controlesEmail`, qui divergerait en silence
// le jour où Resend change de sélecteur ; les extraire de la phrase par
// expression régulière serait pire, puisque `instruction()` n'est pas
// exporté et qu'aucun test ne pourrait tenir les deux ensemble. Une colonne
// « nom » demande deux champs de plus côté serveur — hors périmètre ici.
// ---------------------------------------------------------------------

type Signe = "ok" | "ko" | "inconnu"

const SIGNES: Record<Signe, { glyphe: string; texte: string; classe: string }> =
  {
    // `emerald` de la palette Tailwind, et non un `text-success` : le
    // jeton `--color-success` existe dans `packages/tokens/theme.css`, que
    // le dashboard N'IMPORTE PAS — il a son propre `@theme inline` dans
    // `src/styles.css`. `text-success` s'y compile en rien du tout, et la
    // coche sortait en noir. `password-strength-meter.tsx` prend déjà
    // `bg-emerald-500` pour la même raison.
    ok: {
      glyphe: "✓",
      texte: "En place",
      classe: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    },
    ko: {
      glyphe: "✕",
      texte: "À poser",
      classe: "bg-destructive/15 text-destructive",
    },
    inconnu: {
      glyphe: "?",
      texte: "Non lu",
      classe: "bg-muted text-muted-foreground",
    },
  }

const SIGNE_DE: Record<Verdict["etat"], Signe> = {
  ok: "ok",
  manquant: "ko",
  different: "ko",
  indisponible: "inconnu",
}

/**
 * Le signe, et rien d'autre.
 *
 * Le mot (« En place », « À poser », « Non lu ») vit dans `aria-label` :
 * un lecteur d'écran l'annonce, l'œil ne le lit pas. Une pastille de texte
 * remettrait à l'écran ce que la couleur dit déjà.
 */
export function Signal({ signe }: { signe: Signe }) {
  const { glyphe, texte, classe } = SIGNES[signe]
  return (
    <span
      role="img"
      aria-label={texte}
      data-signe={signe}
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] leading-none font-bold ${classe}`}
    >
      {glyphe}
    </span>
  )
}

// ---------------------------------------------------------------------
// Le tableau des enregistrements.
// ---------------------------------------------------------------------

export function TableauDns({
  titre,
  verdicts,
}: {
  titre: string
  verdicts: Verdict[]
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-heading text-sm font-medium">{titre}</h3>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[34%] px-2 whitespace-normal">
              Enregistrement
            </TableHead>
            <TableHead className="px-2 whitespace-normal">Valeur</TableHead>
            <TableHead className="w-9 px-0" aria-label="État" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {verdicts.map((verdict) => (
            <LigneVerdict key={verdict.cle} verdict={verdict} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function LigneVerdict({ verdict }: { verdict: Verdict }) {
  const [nom, glose] = nomEtGlose(verdict.libelle)
  return (
    <TableRow data-testid={`verdict-${verdict.cle}`} data-etat={verdict.etat}>
      <TableCell className="px-2 align-top whitespace-normal">
        {/* La glose part en infobulle : « SPF — qui a le droit d'envoyer en
            votre nom » redevient « SPF ». L'attribut `title` n'ajoute aucun
            mot à l'écran, là où une apposition en ajoutait huit par ligne. */}
        <span
          title={glose ?? undefined}
          className={
            glose === null
              ? "text-sm font-medium"
              : "text-sm font-medium underline decoration-dotted underline-offset-4"
          }
        >
          {nom}
        </span>
      </TableCell>
      <TableCell className="px-2 align-top whitespace-normal">
        <div className="flex flex-col items-start gap-1.5">
          {/* `flex-wrap` + `basis-32` : à 390 px la colonne ne tient pas la
              valeur ET le bouton, et les garder sur une ligne cassait
              « include:amazonses.com » en trois morceaux. Le bouton passe
              dessous. `wrap-anywhere` plutôt que `break-all` : une valeur
              longue casse encore au milieu si elle n'a pas d'espace, mais
              « l'adresse IPv4 publique de votre serveur » casse à ses
              espaces, comme une phrase. */}
          <div className="flex w-full min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
            <code className="min-w-0 grow basis-32 text-xs wrap-anywhere">
              {verdict.attendu}
            </code>
            {estCopiable(verdict.attendu) ? (
              <BoutonCopier texte={verdict.attendu} />
            ) : null}
          </div>
          <Repli verdict={verdict} />
        </div>
      </TableCell>
      <TableCell className="px-0 text-right align-top">
        <Signal signe={SIGNE_DE[verdict.etat]} />
      </TableCell>
    </TableRow>
  )
}

/**
 * « SPF — qui a le droit d'envoyer en votre nom » → `["SPF", "qui a…"]`.
 *
 * Les libellés du site (« Le site public », « Le tableau de bord ») n'ont
 * pas de glose et ressortent entiers.
 */
export function nomEtGlose(libelle: string): [string, string | null] {
  const coupure = libelle.indexOf(" — ")
  if (coupure === -1) return [libelle, null]
  return [libelle.slice(0, coupure), libelle.slice(coupure + 3)]
}

/**
 * Cette valeur se colle-t-elle telle quelle chez l'hébergeur ?
 *
 * Trois des cinq lignes ont pour `attendu` une DESCRIPTION et non une
 * valeur — « l'adresse IPv4 publique de votre serveur » (deux fois), « la
 * clé publique fournie par Resend ». Un bouton qui collerait cette phrase
 * dans le champ « valeur » de l'hébergeur serait pire que pas de bouton.
 *
 * La règle porte sur la forme, pas sur une liste de `cle` : une valeur DNS
 * réelle s'ouvre par un couple `jeton=` (`v=spf1…`, `v=DMARC1;…`, et
 * `p=MIGf…` le jour où Resend fournirait la clé). Une description française
 * n'en a pas. Écrite ainsi, elle suit `convex/dns.ts` sans le recopier : si
 * DKIM y gagne une valeur littérale, le bouton apparaît tout seul.
 */
export function estCopiable(attendu: string): boolean {
  return /^[a-z][a-z0-9_-]*=/i.test(attendu.trim())
}

/**
 * Ce qui ne s'étale pas : la phrase du serveur, et ce que le résolveur a
 * rendu.
 *
 * `<details>` natif plutôt qu'un `Collapsible` : ces lignes se rendent en
 * `renderToStaticMarkup` dans les tests, et un repli qui dépend de l'état
 * React n'y serait jamais fermé. Fermé, il coûte un mot.
 */
function Repli({ verdict }: { verdict: Verdict }) {
  const trouve = verdict.trouve.length > 0 ? verdict.trouve.join(" · ") : null
  return (
    <details className="w-full min-w-0">
      <summary className="w-fit cursor-pointer text-xs text-muted-foreground underline decoration-dotted underline-offset-4 marker:content-none">
        Détail
      </summary>
      <div className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{verdict.instruction}</p>
        {trouve === null ? null : (
          <p>
            <code className="wrap-anywhere">{trouve}</code>
          </p>
        )}
      </div>
    </details>
  )
}

function BoutonCopier({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="Copier la valeur"
      className="h-6 shrink-0 px-2 text-xs"
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

// ---------------------------------------------------------------------
// Deux états que le DNS ne couvre pas.
//
// Ils remplacent deux paragraphes retirés sur consigne — « ces liens
// partent de localhost… ils ne mènent nulle part », et « cette image a été
// construite pour localhost… cinq messages de contact par heure pour tout
// Internet ». Ce sont deux pannes RÉELLES et INVISIBLES : effacées, elles
// deviennent indétectables depuis l'interface. Elles restent donc, mais
// dans la langue du tableau ci-dessus : une étiquette, les valeurs qui
// divergent, un signe. La conséquence, elle, descend en commentaire.
//
// 1. LES LIENS DES EMAILS. `SITE_URL` compose les liens contenus dans les
//    emails (invitation, réinitialisation). Si son hôte n'est pas celui du
//    domaine déclaré, les emails partent et leurs liens ne mènent nulle
//    part — un défaut qui ne se voit qu'en cliquant, donc chez quelqu'un
//    d'autre.
//
// 2. LE DOMAINE DU BUILD. `WEB_DOMAIN` est figée AU BUILD de l'image du
//    site (`apps/web/astro.config.ts`) et Astro la fige dans
//    `security.allowedDomains`. Si elle diverge du domaine déclaré, la
//    liste est vide, Astro ignore `x-forwarded-for`, et `clientAddress`
//    retombe sur l'adresse de Traefik — la même pour tout Internet. Les
//    deux limiteurs de débit (`/api/contact`, `/api/consent`) n'ont alors
//    qu'un seul seau : cinq messages de contact par heure pour la Terre
//    entière. Voir `apps/web/src/lib/allowedDomains.ts`.
// ---------------------------------------------------------------------

export type LigneEtat = {
  cle: string
  etiquette: string
  /** Une valeur quand tout va bien ; les deux qui divergent sinon. */
  valeurs: string[]
  ok: boolean
}

export function TableauEtats({ lignes }: { lignes: LigneEtat[] }) {
  return (
    <Table className="table-fixed">
      <TableBody>
        {lignes.map((ligne) => (
          <TableRow
            key={ligne.cle}
            data-testid={`etat-${ligne.cle}`}
            data-ok={ligne.ok}
          >
            <TableCell className="w-[34%] px-2 align-top text-sm whitespace-normal">
              {ligne.etiquette}
            </TableCell>
            <TableCell className="px-2 align-top whitespace-normal">
              <code className="text-xs wrap-anywhere">
                {ligne.valeurs.join(" ≠ ")}
              </code>
            </TableCell>
            <TableCell className="w-9 px-0 text-right align-top">
              <Signal signe={ligne.ok ? "ok" : "ko"} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
