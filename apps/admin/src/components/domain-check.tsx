import { Fragment } from "react"
import type { ReactNode } from "react"
import type { Enregistrement, EtatVerdict, Verdict } from "@astrotan/backend/convex/dns"
import { valeurLocalePour } from "@/lib/domaineLocal"
import {
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  type LucideIcon,
} from "lucide-react"
import { CopyButton } from "@/components/copy-button"
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
// LE TABLEAU S'AFFICHE DEPUIS LE PLAN, PAS DEPUIS LA VÉRIFICATION. Cet
// écran cachait tout le tableau derrière un bouton « Vérifier » : rien à
// voir tant que personne n'avait cliqué, alors que `dns.plan` (une query,
// sans appel réseau) sait déjà, dès qu'un domaine est déclaré, ce qu'il
// faut créer. `fusionnerVerdicts` ci-dessous prend le plan et un verdict
// ENCORE ABSENT (`null`) — avant la première vérification, ou après un
// échec réseau — et rend quand même une ligne par enregistrement, avec un
// état « attente » : la colonne existe toujours, elle se remplit quand la
// vérification répond.
//
// TROIS SIGNES, POUR CINQ ÉTATS PLUS UN. `convex/dns.ts` rend cinq états
// et tient `manquant` et `indisponible` séparés exprès : « le résolveur
// n'a pas répondu » n'est pas « c'est absent ». L'un se réessaie, l'autre
// se crée, et les confondre en rouge fait créer chez l'hébergeur un
// doublon qui se diagnostique des semaines plus tard. `manquant` et
// `different`, eux, appellent le même geste — aller chez l'hébergeur — et
// partagent donc le rouge. L'état local « attente » (pas encore vérifié)
// emprunte le signe d'« indisponible » : les deux disent la même chose à
// l'œil, « on ne sait pas encore ». `forme` emprunte celui d'`ok` pour la
// raison inverse — la ligne est bien là, c'est le serveur de référence
// qui manque, et ça ne se dit pas d'une ligne. Ces deux paires-là ne se
// distinguent que dans `data-etat`, pour les tests ; ce qui les sépare à
// l'écran est l'étiquette au-dessus du tableau.
//
// TYPE, NOM, VALEUR, TTL : QUATRE COLONNES NUES, PLUS L'ÉTAT. `convex/dns.ts`
// porte maintenant `type` et `nom` comme champs à part entière — ce
// composant les affiche tels quels, sans les recomposer depuis une phrase
// (l'ancienne version le faisait depuis un champ `instruction`, retiré du
// serveur). `libelle` (« SPF — qui a le droit d'envoyer en votre nom »)
// n'apparaît plus dans le flux : il passe en infobulle (`title`), pour
// qui veut savoir à quoi sert la ligne sans que ça coûte un mot à l'écran.
//
// TTL 300 s : c'est la valeur que la recette de mise en service demande
// de poser chez le registrar (`docs/superpowers/plans/2026-08-30-deploiement-et-recette-ovh.md`
// §3.2). Ni Traefik ni `docker/README.md` n'en imposent une autre.

/** TTL recommandé chez le registrar — recette OVH §3.2. */
export const TTL_DNS_RECOMMANDE = 300

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function estIpv4(valeur: string): boolean {
  const octets = IPV4.exec(valeur)
  if (!octets) return false
  return octets.slice(1).every((octet) => Number(octet) <= 255)
}

/**
 * Ce qui va dans la colonne Valeur : l'attendu de CET environnement.
 *
 * Jamais le lookup recyclé en vérité — c'est lui qui affichait 198.x
 * sur un Mac en localhost. Le DNS public juge la colonne État
 * (Connecté / Local / Non connecté) ; il n'a pas de seconde ligne
 * sous la valeur.
 */
export function valeurAffichee(
  ligne: LigneDns,
  opts: { local?: boolean } = {},
): string {
  if (opts.local && ligne.type === "A") {
    if (/^(localhost|127\.0\.0\.1):\d+$/.test(ligne.attendu)) return ligne.attendu
    return valeurLocalePour(ligne.cle)
  }
  return ligne.attendu
}
// ---------------------------------------------------------------------

export type Signe = "ok" | "ko" | "inconnu"

const SIGNES: Record<Signe, { Icone: LucideIcon; texte: string; classe: string }> =
  {
    // `emerald` de la palette Tailwind, et non un `text-success` : le
    // jeton `--color-success` existe dans `packages/tokens/theme.css`, que
    // le dashboard N'IMPORTE PAS — il a son propre `@theme inline` dans
    // `src/styles.css`. `text-success` s'y compile en rien du tout, et la
    // coche sortait en noir. `password-strength-meter.tsx` prend déjà
    // `bg-emerald-500` pour la même raison.
    ok: {
      Icone: CircleCheckIcon,
      texte: "Connecté",
      classe: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    },
    ko: {
      Icone: CircleXIcon,
      texte: "Non connecté",
      classe: "bg-destructive/15 text-destructive",
    },
    inconnu: {
      Icone: CircleHelpIcon,
      texte: "Non connecté",
      classe: "bg-muted text-muted-foreground",
    },
  }

/**
 * Le signe, et rien d'autre.
 *
 * Le mot (« Connecté », « Non connecté ») vit dans `aria-label` quand
 * le glyphe est seul. Sur une ligne DNS, `VerdictConnexion` écrit le
 * mot à l'œil : le Signal n'y va plus.
 *
 * `muet` retire ce `aria-label` — et lui seul. Il sert aux endroits où le
 * mot est DÉJÀ écrit à côté (voir `Etiquette`) : l'annoncer deux fois
 * ferait lire « Connecté, Connecté » à un lecteur d'écran.
 */
export function Signal({ signe, muet = false }: { signe: Signe; muet?: boolean }) {
  const { Icone, texte, classe } = SIGNES[signe]
  return (
    <span
      {...(muet ? { "aria-hidden": true } : { role: "img", "aria-label": texte })}
      data-signe={signe}
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full ${classe}`}
    >
      <Icone aria-hidden className="size-3.5" />
    </span>
  )
}

/**
 * Un signe et son mot — la forme des états qui ne tiennent pas dans une
 * ligne de tableau.
 *
 * Le tableau se contente du signe parce que la ligne dit déjà de quoi il
 * parle. Ailleurs — à côté du bouton, à côté d'un titre de tableau — un
 * rond de couleur seul ne désigne rien : le mot est ce qui le rattache à
 * quelque chose. Il reste un ÉTAT, jamais une consigne : « Non connecté »,
 * pas « créez un enregistrement A chez votre hébergeur ».
 */

/**
 * Le verdict durable d'une ligne — icône + mot.
 *
 * Après le check : V vert si ça matche, croix rouge si ça manque ou
 * diverge. Avant (attente) et si le résolveur n'a pas répondu : le
 * point d'interrogation. En local, jamais le V — « Local » n'est pas
 * Connecté.
 */
export function estConnecte(
  etat: EtatVerdict | "attente",
  opts: { local?: boolean } = {},
): boolean {
  if (opts.local) return false
  return etat === "ok"
}

export function signeDuVerdict(
  etat: EtatVerdict | "attente",
  opts: { local?: boolean } = {},
): Signe {
  if (estConnecte(etat, opts)) return "ok"
  if (etat === "manquant" || etat === "different") return "ko"
  return "inconnu"
}

export function VerdictConnexion({
  etat,
  local = false,
}: {
  etat: EtatVerdict | "attente"
  local?: boolean
}) {
  const connecte = estConnecte(etat, { local })
  const vu = etat === "ok" || etat === "forme" || etat === "different"
  const texte = local ? (vu ? "Local" : "Non connecté") : connecte ? "Connecté" : "Non connecté"
  const signe = signeDuVerdict(etat, { local })
  return (
    <span
      data-connexion={connecte ? "connecte" : "non_connecte"}
      className={`inline-flex items-center gap-1.5 text-xs ${
        connecte
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground"
      }`}
    >
      <Signal signe={signe} muet />
      {texte}
    </span>
  )
}

export function Etiquette({ signe, texte }: { signe: Signe; texte: string }) {
  return (
    <span
      data-testid="etiquette"
      className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Signal signe={signe} muet />
      <span className="min-w-0 wrap-anywhere">{texte}</span>
    </span>
  )
}

/**
 * À côté du bouton Vérifier — le même couple icône + mot que la ligne.
 *
 * V vert / croix rouge / « ? » : ce n'est pas le mot seul. Le libellé
 * (Connecté, Non connecté, Local) dit ce que le signe désigne.
 */
export function EtatVerification({
  signe,
  texte,
}: {
  signe: Signe
  texte: string
}) {
  return (
    <span
      data-testid="etiquette"
      className={`inline-flex min-w-0 items-center gap-1.5 text-xs ${
        signe === "ok"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground"
      }`}
    >
      <Signal signe={signe} muet />
      <span className="min-w-0 wrap-anywhere">{texte}</span>
    </span>
  )
}

// ---------------------------------------------------------------------
// La fusion : ce qu'il faut créer, enrichi de ce qui est là — quand on le
// sait.
// ---------------------------------------------------------------------

/** Un enregistrement du plan, avec ce que le résolveur en dit — ou pas encore. */
export type LigneDns = Enregistrement & {
  /** Ce que le résolveur a rendu — vide si absent, indisponible, ou pas encore lu. */
  trouve: string[]
  etat: EtatVerdict | "attente"
}

/**
 * Chaque ligne du plan, enrichie de son verdict s'il est arrivé.
 *
 * Fusion PAR `cle`, jamais par position : `plan` et `verdicts` partagent
 * les mêmes clés (`controlesSite`/`controlesEmail`, côté serveur, les
 * composent toutes deux), mais rien ne garantit qu'ils gardent le même
 * ordre si l'un des deux évolue sans l'autre.
 *
 * `verdicts === null` — la vérification n'est pas encore arrivée, ou a
 * échoué — laisse chaque ligne à `"attente"` plutôt que de faire
 * disparaître le tableau : c'est tout l'objet de cette fonction.
 */
export function fusionnerVerdicts(
  plan: Enregistrement[],
  verdicts: Verdict[] | null
): LigneDns[] {
  return plan.map((enregistrement) => {
    const verdict = verdicts?.find((v) => v.cle === enregistrement.cle) ?? null
    return verdict === null
      ? { ...enregistrement, trouve: [], etat: "attente" as const }
      : { ...enregistrement, trouve: verdict.trouve, etat: verdict.etat }
  })
}

// ---------------------------------------------------------------------
// Les enregistrements que Resend demande — DANS LE MÊME TABLEAU.
//
// `resendDomain.declarer` rend ses lignes dans le type `Enregistrement` de
// `convex/dns.ts`, exprès pour qu'elles n'aient besoin d'aucune traduction
// ici. Elles décrivent la même chose que SPF, DKIM et DMARC — ce qu'il faut
// créer chez l'hébergeur pour que les emails partent — et prennent donc des
// lignes du tableau « Les emails », pas un second tableau : deux tableaux de
// la même nature obligeraient à choisir lequel regarder pour une seule
// question.
// ---------------------------------------------------------------------

/**
 * Le plan des emails, complété par ce que Resend demande vraiment.
 *
 * Deux lignes se recouvrent presque toujours — le DKIM du plan
 * (`resend._domainkey.exemple.fr`, TXT) et celui de Resend, qui porte la
 * VRAIE clé publique là où le plan n'a qu'une description. Les afficher
 * toutes les deux donnerait deux lignes pour un seul enregistrement, dont
 * une qu'on ne peut pas copier.
 *
 * D'où la fusion par `nom` + `type` — ce qu'un formulaire de zone DNS
 * identifie, et la seule chose que les deux sources nomment pareil. La
 * valeur de Resend l'emporte ; `cle` et `libelle` restent ceux du plan, et
 * ce n'est pas cosmétique : `fusionnerVerdicts` recolle les verdicts de
 * `dns.checkEmail` PAR `cle`. Prendre la clé de Resend ferait perdre à cette
 * ligne son état, définitivement.
 *
 * Les lignes de Resend qui ne recouvrent rien (le MX et le TXT de
 * `send.<domaine>`) s'ajoutent à la suite. Aucune vérification ne les lit —
 * `dns.checkEmail` n'interroge que les trois du plan —, elles restent donc à
 * « Non lu », ce qui est exactement vrai : personne n'a regardé.
 */
export function fusionnerResend(
  plan: Enregistrement[],
  resend: Enregistrement[]
): Enregistrement[] {
  const repris = new Set<string>()
  const fusionnees = plan.map((ligne) => {
    const jumelle = resend.find((candidat) => memeEnregistrement(candidat, ligne))
    if (jumelle === undefined) return ligne
    repris.add(jumelle.cle)
    return { ...ligne, attendu: jumelle.attendu }
  })
  return [...fusionnees, ...resend.filter((ligne) => !repris.has(ligne.cle))]
}

/** Le même enregistrement de zone : même nom, même type. */
function memeEnregistrement(a: Enregistrement, b: Enregistrement): boolean {
  return a.type === b.type && a.nom.toLowerCase() === b.nom.toLowerCase()
}

// ---------------------------------------------------------------------
// Le tableau des enregistrements.
// ---------------------------------------------------------------------

export function TableauDns({
  titre,
  lignes,
  etat = null,
  note = null,
  local = false,
}: {
  titre: string
  lignes: LigneDns[]
  /** L'état du groupe entier — celui de Resend, sur « Les emails ». */
  etat?: ReactNode
  /** Une phrase sous le titre — pourquoi ces lignes existent. */
  note?: string | null
  /** Dashboard servi en local : jamais Connecté, jamais une IPv4 publique. */
  local?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* `flex-wrap` : à 390 px le titre et l'étiquette ne tiennent pas
          côte à côte dès que l'état de Resend est un peu long. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="font-heading text-sm font-medium">{titre}</h3>
        {etat}
      </div>
      {note !== null ? (
        <p className="text-xs text-muted-foreground">{note}</p>
      ) : null}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 px-2 whitespace-normal">Type</TableHead>
            <TableHead className="w-[28%] px-2 whitespace-normal">
              Nom
            </TableHead>
            <TableHead className="px-2 whitespace-normal">Valeur</TableHead>
            <TableHead className="w-14 px-2 whitespace-normal">TTL</TableHead>
            <TableHead className="w-[7.5rem] px-2 whitespace-normal">
              État
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lignes.map((ligne) => (
            <LigneEnregistrement key={ligne.cle} ligne={ligne} local={local} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function LigneEnregistrement({
  ligne,
  local,
}: {
  ligne: LigneDns
  local: boolean
}) {
  const valeur = valeurAffichee(ligne, { local })
  return (
    <TableRow data-testid={`verdict-${ligne.cle}`} data-etat={ligne.etat}>
      <TableCell
        className="px-2 align-top text-xs font-medium whitespace-normal"
        title={ligne.libelle}
      >
        {ligne.type}
      </TableCell>
      <TableCell
        className="px-2 align-top text-xs whitespace-normal wrap-anywhere"
        title={ligne.libelle}
      >
        <NomDns nom={ligne.nom} />
      </TableCell>
      <TableCell className="px-2 align-top whitespace-normal">
        <div className="inline-flex max-w-full items-start gap-0.5">
          <code className="min-w-0 text-xs wrap-anywhere">{valeur}</code>
          {estCopiable(valeur) ? (
            <CopyButton
              value={valeur}
              label="Copier la valeur"
              className="shrink-0"
              iconClassName="size-3.5"
              size="icon-xs"
            />
          ) : null}
        </div>
      </TableCell>
      <TableCell className="px-2 align-top text-xs tabular-nums">
        {TTL_DNS_RECOMMANDE}
      </TableCell>
      <TableCell className="px-2 align-top">
        <VerdictConnexion etat={ligne.etat} local={local} />
      </TableCell>
    </TableRow>
  )
}

/**
 * Le nom de l'enregistrement, cassable AUX POINTS.
 *
 * À 390 px la colonne « Nom » fait une centaine de pixels, et
 * `wrap-anywhere` seul y brisait `resend._domainkey.exemple.fr` en
 * `resend._dom` / `ainkey.exemple.f` / `r` — trois morceaux dont aucun
 * n'est une étiquette DNS, sur la valeur qu'on recopie chez l'hébergeur.
 * Les noms du plan (`_dmarc.exemple.fr`) tenaient encore ; ceux de Resend,
 * plus longs d'un cran, ne tenaient plus.
 *
 * Un `<wbr>` après les points de tête — jamais après celui du domaine
 * enregistrable, qu'on garde d'un bloc — donne au navigateur des coupures
 * qui tombent là où l'œil recompose : `resend.` / `_domainkey.` /
 * `exemple.fr`. `wrap-anywhere` reste sur la cellule, en dernier recours,
 * pour l'étiquette qui serait à elle seule plus large que la colonne.
 *
 * `<wbr>` est un élément SANS largeur : il ne met pas d'espace, ni à l'œil
 * ni au copier-coller. Le helper `texte()` des tests le retire à vide pour
 * la même raison.
 */
function NomDns({ nom }: { nom: string }) {
  const etiquettes = nom.split(".")
  // Les deux dernières étiquettes sont le domaine enregistrable
  // (`exemple.fr`) : aucune coupure entre elles.
  const coupures = Math.max(etiquettes.length - 2, 0)
  return (
    <>
      {/* `Fragment` et non un `<span>` : un élément par étiquette
          existerait dans le DOM, donc dans le texte que les tests lisent —
          et un nom DNS ne se lit pas `_dmarc. exemple. fr`. */}
      {etiquettes.map((etiquette, index) => (
        <Fragment key={index}>
          {etiquette}
          {index === etiquettes.length - 1 ? "" : "."}
          {index < coupures ? <wbr /> : null}
        </Fragment>
      ))}
    </>
  )
}

/**
 * Cette valeur se colle-t-elle telle quelle chez l'hébergeur ?
 *
 * Une description (« la clé publique fournie par Resend ») ne se copie
 * pas : coller cette phrase chez l'hébergeur serait pire que pas de
 * bouton. Une valeur réelle, si : couple `jeton=` (SPF, DMARC, DKIM),
 * IPv4, ou `localhost:port` en local.
 */
export function estCopiable(attendu: string): boolean {
  const valeur = attendu.trim()
  if (/^[a-z][a-z0-9_-]*=/i.test(valeur)) return true
  if (estIpv4(valeur)) return true
  return /^(localhost|127\.0\.0\.1):\d+$/.test(valeur)
}

