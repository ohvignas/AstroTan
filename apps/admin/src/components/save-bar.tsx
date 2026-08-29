import { useCallback, useEffect, useRef, useState } from "react"
import {
  CheckIcon,
  CircleDashedIcon,
  LoaderIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------
// La barre d'enregistrement partagée par les trois écrans d'édition
// (pages, articles, réglages).
//
// Pourquoi une sauvegarde automatique *partielle* et non totale — c'est la
// décision qui structure tout ce fichier :
//
//   `pages.update` et `posts.update` frappent une redirection 301 dès que
//   le slug change (`convex/redirects.ts`, `mintRenameRedirect`). Une
//   sauvegarde qui suit la frappe créerait une redirection par valeur
//   intermédiaire — `/tar`, `/tari`, `/tarif` — et remplirait la table de
//   lignes mortes que personne ne relierait jamais à leur cause. Pire :
//   ces lignes occupent ensuite les chemins correspondants et refusent la
//   création d'une page qui les porterait (`assertPathAvailable`).
//
// D'où la séparation en deux photos : `auto`, les champs qu'on peut
// réécrire cent fois sans conséquence hors de leur propre ligne, et
// `manual`, ceux dont l'écriture a un effet de bord durable. La sauvegarde
// automatique n'envoie **que** `auto` ; `manual` attend le clic. Les
// mutations acceptent des arguments optionnels, si bien qu'omettre le slug
// le laisse littéralement intact côté serveur.
// ---------------------------------------------------------------------

/**
 * Le silence à observer après la dernière frappe avant d'envoyer.
 *
 * Assez long pour qu'une phrase tapée d'un trait ne produise qu'un appel,
 * assez court pour qu'une pause de lecture suffise à mettre le travail à
 * l'abri.
 */
export const AUTO_SAVE_DELAY_MS = 1_500

export type SaveStatus = "saved" | "pending" | "saving" | "error"

/**
 * Les deux photos ont-elles divergé ?
 *
 * `JSON.stringify` plutôt qu'une égalité profonde écrite à la main : les
 * deux objets sont construits par le même littéral, au même endroit du
 * code, donc l'ordre des clés est identique par construction. Comparer les
 * chaînes est alors exact — et c'est ce qui empêche d'écrire une ligne
 * qu'on n'a fait qu'ouvrir, ce qui la ferait remonter en tête des listes
 * triées par date de modification.
 */
export function snapshotChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

/**
 * « Dernière sauvegarde le 29 août 2026 à 14:07 ».
 *
 * `null` tant que rien n'a été enregistré depuis l'ouverture : les tables
 * `pages`/`posts` ne portent pas de `updatedAt` (seulement `updatedBy`),
 * il n'existe donc aucune date de dernière modification à afficher au
 * chargement. Inventer `_creationTime` à sa place mentirait.
 */
export function formatLastSaved(at: number | null): string {
  if (at === null) return "Aucun enregistrement depuis l'ouverture de cet écran"
  const when = new Date(at)
  const date = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(when)
  const time = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(when)
  return `Dernière sauvegarde le ${date} à ${time}`
}

// ---------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------

export function SaveBar({
  status,
  lastSavedAt,
  error,
  canSave,
  onSave,
  className = "-mx-4 -mb-4",
}: {
  status: SaveStatus
  lastSavedAt: number | null
  error: string | null
  canSave: boolean
  onSave: () => void
  /**
   * Les débordements de la barre, et rien d'autre.
   *
   * Le défaut `-mx-4 -mb-4` vaut pour un écran dont le formulaire occupe
   * toute la largeur du contenu — les éditeurs de pages et d'articles.
   * Les réglages ont depuis une colonne de menu à gauche : y appliquer le
   * même débordement ferait commencer le filet du haut au milieu de la
   * gouttière. Ils passent `-mr-4 -mb-4` : à ras de la colonne à gauche,
   * à ras du bord de la page à droite.
   */
  className?: string
}) {
  return (
    // Collante en bas, et volontairement débordante des marges de
    // `AppShell` (`-mx-4`) pour occuper toute la largeur du contenu, avec
    // un fond opaque : une barre translucide laisserait lire le texte qui
    // défile dessous, ce qui rend les deux illisibles.
    //
    // `-mb-4` la fait reposer au ras du bas du conteneur : arrivé en bas de
    // page elle se décolle et reprend sa place dans le flux, si bien que le
    // dernier champ du formulaire n'est jamais masqué au repos. `mt-4`
    // garde l'écart avec la dernière carte.
    <div
      className={cn(
        "sticky bottom-0 z-20 mt-4 border-t bg-background px-4 py-3",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p
          role="status"
          aria-live="polite"
          className="mr-auto flex items-center gap-2 text-sm"
        >
          <SaveStatusIcon status={status} />
          <span
            className={
              status === "error" ? "text-destructive" : "text-muted-foreground"
            }
          >
            {describeStatus(status, lastSavedAt, error)}
          </span>
        </p>
        <Button type="button" disabled={!canSave} onClick={onSave}>
          {status === "saving" ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </div>
  )
}

function SaveStatusIcon({ status }: { status: SaveStatus }) {
  // `aria-hidden` partout : la phrase à côté dit déjà tout, et le lecteur
  // d'écran l'annonce via le `role="status"` du parent.
  if (status === "saving") {
    return (
      <LoaderIcon
        aria-hidden
        data-testid="save-icon-saving"
        className="size-4 shrink-0 animate-spin text-muted-foreground"
      />
    )
  }
  if (status === "error") {
    return (
      <TriangleAlertIcon
        aria-hidden
        data-testid="save-icon-error"
        className="size-4 shrink-0 text-destructive"
      />
    )
  }
  if (status === "pending") {
    // Pas un `CheckIcon` grisé : une coche, même pâle, se lit « c'est
    // bon ». Le cercle en pointillés dit « en cours, pas encore acquis ».
    return (
      <CircleDashedIcon
        aria-hidden
        data-testid="save-icon-pending"
        className="size-4 shrink-0 text-muted-foreground"
      />
    )
  }
  return (
    <CheckIcon
      aria-hidden
      data-testid="save-icon-saved"
      className="size-4 shrink-0 text-muted-foreground"
    />
  )
}

/**
 * Ce que la barre dit, dans chacun des quatre états.
 *
 * L'état d'échec nomme la cause **et** rappelle que rien n'est perdu : une
 * sauvegarde automatique qui échoue en silence est pire que pas de
 * sauvegarde du tout, puisque l'opérateur croit son travail à l'abri.
 */
export function describeStatus(
  status: SaveStatus,
  lastSavedAt: number | null,
  error: string | null
): string {
  if (status === "saving") return "Enregistrement…"
  if (status === "error") {
    return `${error ?? "L'enregistrement a échoué."} Vos modifications sont toujours à l'écran.`
  }
  if (status === "pending") {
    return `${formatLastSaved(lastSavedAt)} — modifications non enregistrées`
  }
  return formatLastSaved(lastSavedAt)
}

// ---------------------------------------------------------------------
// Comportement
// ---------------------------------------------------------------------

export type AutoSave = {
  status: SaveStatus
  lastSavedAt: number | null
  error: string | null
  canSave: boolean
  /** Enregistre tout de suite, `manual` compris. Le bouton, et rien d'autre. */
  saveNow: () => void
}

export function useAutoSave<TAuto, TManual>({
  enabled,
  auto,
  manual,
  saveAuto,
  saveAll,
  describeError,
  validate,
  delayMs = AUTO_SAVE_DELAY_MS,
}: {
  /** Faux quand l'écran est en lecture seule : ni barre, ni appel. */
  enabled: boolean
  /** Les champs réécrits automatiquement. */
  auto: TAuto
  /** Les champs à effet de bord — le slug — qui attendent le clic. */
  manual: TManual
  /** N'envoie que les champs sûrs. Doit lever en cas de refus. */
  saveAuto: (auto: TAuto) => Promise<void>
  /** Envoie tout. Doit lever en cas de refus. */
  saveAll: (fields: { auto: TAuto; manual: TManual }) => Promise<void>
  /** Traduit un refus serveur en une phrase pour l'opérateur. */
  describeError: (error: unknown) => string
  /**
   * Refus connus d'avance (titre vide, trop d'entités…). Rend un message
   * pour ne rien envoyer du tout — le serveur borne déjà ces champs
   * (`convex/content.ts`), et une saisie hors limites ferait échouer la
   * sauvegarde automatique en boucle.
   */
  validate?: (fields: { auto: TAuto; manual: TManual }) => string | null
  delayMs?: number
}): AutoSave {
  // Ce que le serveur a réellement accepté en dernier — jamais ce qui a
  // été tapé. Semé une seule fois au premier rendu : les documents
  // arrivent par un abonnement Convex vivant, et re-semer à chaque
  // notification effacerait ce qui est en train d'être saisi.
  const [baseline, setBaseline] = useState<{ auto: TAuto; manual: TManual }>(() => ({
    auto,
    manual,
  }))
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Les fermetures changent à chaque rendu ; l'effet de débounce ne doit
  // pas se replanifier pour autant, sinon la temporisation ne s'écoule
  // jamais. Il lit toujours la dernière version ici.
  const latest = useRef({ auto, manual, saveAuto, saveAll, describeError, validate })
  latest.current = { auto, manual, saveAuto, saveAll, describeError, validate }

  const inFlight = useRef(false)
  // La photo exacte que le serveur (ou `validate`) vient de refuser.
  // Sans elle, la fin d'un appel en échec relance l'effet, qui retrouve les
  // mêmes valeurs encore « sales » et réessaie — indéfiniment, toutes les
  // 1,5 s, sur une saisie que le serveur refusera toujours. On signale, et
  // on attend soit une modification, soit un clic explicite.
  const refusedKey = useRef<string | null>(null)

  const autoKey = JSON.stringify(auto)
  const autoDirty = snapshotChanged(auto, baseline.auto)
  const manualDirty = snapshotChanged(manual, baseline.manual)
  const dirty = autoDirty || manualDirty

  const run = useCallback(async (mode: "auto" | "manual") => {
    const current = latest.current
    // Un seul appel à la fois : deux `update` concurrents sur la même
    // ligne se marchent dessus, et le dernier arrivé n'est pas
    // nécessairement le dernier tapé.
    if (inFlight.current) return

    const snapshot = { auto: current.auto, manual: current.manual }
    const key = JSON.stringify(snapshot.auto)

    const problem = current.validate?.(snapshot) ?? null
    if (problem !== null) {
      refusedKey.current = key
      setError(problem)
      return
    }

    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      if (mode === "auto") await current.saveAuto(snapshot.auto)
      else await current.saveAll(snapshot)
      refusedKey.current = null
      // L'horodatage est pris ici, à l'acquittement du serveur — pas au
      // clic ni au déclenchement du minuteur. Si l'appel échoue, ce
      // `setLastSavedAt` n'est jamais atteint et la date affichée ne
      // bouge pas d'un pouce, ce qui est exactement ce qu'elle doit dire.
      setLastSavedAt(Date.now())
      // En mode `auto`, le slug n'a pas été envoyé : sa référence reste
      // celle d'avant, pour que le bouton continue d'annoncer qu'il y a
      // quelque chose à enregistrer.
      setBaseline((previous) =>
        mode === "auto"
          ? { auto: snapshot.auto, manual: previous.manual }
          : snapshot
      )
    } catch (err) {
      refusedKey.current = key
      setError(current.describeError(err))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    // Rien n'a bougé parmi les champs sûrs : ne rien écrire. Un slug seul
    // modifié laisse cette condition fausse — c'est tout l'objet du
    // découpage.
    if (!autoDirty) return
    if (saving) return
    if (refusedKey.current === autoKey) return
    const timer = setTimeout(() => {
      void run("auto")
    }, delayMs)
    return () => clearTimeout(timer)
  }, [enabled, autoDirty, autoKey, saving, delayMs, run])

  const saveNow = useCallback(() => {
    void run("manual")
  }, [run])

  // Ordre volontaire : une fois la photo revenue à l'identique de ce que
  // le serveur détient, il n'y a plus rien à signaler, pas même une erreur
  // passée.
  const status: SaveStatus = saving
    ? "saving"
    : !dirty
      ? "saved"
      : error !== null
        ? "error"
        : "pending"

  return {
    status,
    lastSavedAt,
    error,
    canSave: enabled && !saving && dirty,
    saveNow,
  }
}
