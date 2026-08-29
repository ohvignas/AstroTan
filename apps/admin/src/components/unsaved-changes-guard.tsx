import { useCallback, useRef } from "react"
import { useBlocker } from "@tanstack/react-router"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// ---------------------------------------------------------------------
// Quitter une page de réglages avec des modifications non enregistrées.
//
// Le découpage en une route par section a créé ce trou, et il faut le
// nommer : avec un seul écran, on ne « quittait » jamais une section. Avec
// sept, un clic dans le menu peut emporter ce qui vient d'être tapé —
// deux façons, l'une et l'autre silencieuses :
//
//   • la sauvegarde automatique attend 1,5 s après la dernière frappe.
//     Cliquer dans la seconde qui suit une saisie ne perd pas grand-chose,
//     mais le perd sans le dire ;
//   • l'URL du webhook n'est JAMAIS sauvegardée automatiquement, par
//     construction (`contentGuards.ts`, `save-bar.tsx`). Sur cette
//     page-là, quitter perd toujours tout, et toujours en silence.
//
// DEUX RÉPONSES POSSIBLES, ET LE CHOIX EST FAIT ICI : on PRÉVIENT, on
// n'enregistre pas.
//
// Enregistrer avant de naviguer aurait été plus doux et aurait cassé
// l'invariant le plus cher de cet écran. `https://exemple.co` est une
// adresse parfaitement valide en route vers `https://exemple.com` :
// écrite ne serait-ce qu'une seconde, tout lead reçu pendant cette
// seconde part chez l'hôte de passage. Un enregistrement déclenché par un
// clic ailleurs dans le menu est exactement ce que ce champ refuse. La
// règle « on n'écrit jamais sans un clic sur Enregistrer, sauf ces
// champs-là » aurait deux moitiés à retenir ; « on ne quitte jamais en
// silence » n'en a qu'une.
//
// Couvre aussi la fermeture d'onglet et le rechargement
// (`enableBeforeUnload`), où le navigateur pose sa propre question.
// ---------------------------------------------------------------------

export function useUnsavedChangesGuard({
  dirty,
  /** Ce qui se perdrait, en une phrase — « l'adresse du webhook », « le nom du site ». */
  what,
}: {
  dirty: boolean
  what: string
}) {
  // `useBlocker` réenregistre son effet dès que `shouldBlockFn` change
  // d'identité (vérifié dans ses dépendances). Une fermeture recréée à
  // chaque frappe ferait donc poser et retirer le blocage à chaque
  // caractère tapé ; la référence sert à garder la fonction stable, et
  // c'est `disabled` — une valeur, pas une fermeture — qui porte la
  // réactivité.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const shouldBlockFn = useCallback(() => dirtyRef.current, [])

  const blocker = useBlocker({
    shouldBlockFn,
    disabled: !dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  })

  // Rétréci en une fois : dans la branche `"blocked"` de l'union,
  // `proceed`/`reset` sont des fonctions, pas des `undefined` possibles.
  // Sans ce rétrécissement il faudrait un `?.` à chaque appel, qui dirait
  // « ça pourrait manquer » là où ça ne peut pas.
  const resolver = blocker.status === "blocked" ? blocker : null

  const dialog = (
    <AlertDialog
      open={resolver !== null}
      onOpenChange={(open) => {
        // Fermer autrement que par un bouton — Échap, un clic dehors —
        // veut dire « je n'avais pas fini » : on reste. Le défaut penche
        // du côté qui ne perd rien.
        if (!open) resolver?.reset()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Modifications non enregistrées</AlertDialogTitle>
          <AlertDialogDescription>
            {what} n'a pas été enregistré. Quitter cette page maintenant
            perdrait cette modification — rien n'est envoyé au serveur tant
            que « Enregistrer » n'a pas été cliqué.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolver?.reset()}>
            Rester sur la page
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => resolver?.proceed()}
          >
            Quitter sans enregistrer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return dialog
}
