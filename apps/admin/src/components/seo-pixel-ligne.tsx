import type { ReactNode } from "react"
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChampSecret, type SecretsBloc } from "@/components/settings-environment"
import { CleMaitresseBandeau } from "@/components/settings-secrets"
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

type LigneBase = { ouvert: boolean; canWrite: boolean; onToggle: () => void }

function LigneAccordeon({
  id,
  titre,
  etat,
  etatVariant,
  ouvert,
  canWrite,
  onToggle,
  children,
}: LigneBase & {
  id: string
  titre: string
  etat: string
  etatVariant: "secondary" | "destructive"
  children?: ReactNode
}) {
  const panneauId = `seo-pixel-${id}`
  return (
    <li>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
        <button
          type="button"
          aria-expanded={ouvert}
          aria-controls={panneauId}
          disabled={!canWrite}
          onClick={onToggle}
          className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default sm:w-auto sm:flex-1"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ${ouvert ? "rotate-90" : ""}`}
          />
          <span className="font-heading text-sm leading-snug font-medium">{titre}</span>
        </button>
        <div className="flex w-full items-center pl-6 sm:w-auto sm:pl-0">
          <Badge variant={etatVariant}>{etat}</Badge>
        </div>
      </div>
      <div id={panneauId} hidden={!ouvert} className="pb-3">
        {ouvert ? children : null}
      </div>
    </li>
  )
}

export function LigneDataForSeo({
  secrets,
  configure,
  ouvert,
  canWrite,
  onToggle,
  onModifie,
  onDemanderRetrait,
  retraitEnCours,
}: LigneBase & {
  secrets: SecretsBloc
  configure: boolean
  onModifie: () => void
  onDemanderRetrait: () => void
  retraitEnCours: boolean
}) {
  const reserve = secrets.cleMaitresse === null
  const etat = reserve ? "Réservé" : configure ? "configuré" : "absent"
  return (
    <LigneAccordeon
      id="dataforseo"
      titre="DataForSEO"
      etat={etat}
      etatVariant={reserve || !configure ? "destructive" : "secondary"}
      ouvert={ouvert}
      canWrite={canWrite}
      onToggle={onToggle}
    >
      {secrets.cleMaitresse === "posee" ? (
        <div className="ml-6 flex flex-col gap-4 rounded-lg bg-muted/40 p-4" onChange={onModifie}>
          <ChampSecret bloc={secrets} nom="DATAFORSEO_LOGIN" sansRetrait />
          <ChampSecret bloc={secrets} nom="DATAFORSEO_PASSWORD" sansRetrait />
          <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm underline">
            app.dataforseo.com/api-access
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
          </a>
          {configure || [secrets.etats.DATAFORSEO_LOGIN?.source, secrets.etats.DATAFORSEO_PASSWORD?.source].some((s) => s !== undefined && s !== "aucune") ? (
            <Button type="button" variant="ghost" size="sm" className="w-fit cursor-pointer" disabled={retraitEnCours} onClick={onDemanderRetrait}>
              Retirer
            </Button>
          ) : null}
        </div>
      ) : secrets.cleMaitresse === null ? null : (
        <div className="ml-6 rounded-lg bg-muted/40 p-4">
          <CleMaitresseBandeau etat={secrets.cleMaitresse} />
        </div>
      )}
    </LigneAccordeon>
  )
}

export function LignePixel({
  id,
  titre,
  valeur,
  brouillon,
  onBrouillon,
  placeholder,
  erreur,
  ouvert,
  canWrite,
  onToggle,
  onEnregistrer,
  onRetirer,
  enregistrement,
}: LigneBase & {
  id: string
  titre: string
  valeur: string | null
  brouillon: string
  onBrouillon: (valeur: string) => void
  placeholder: string
  erreur: string | null
  onEnregistrer: () => void
  onRetirer: () => void
  enregistrement: boolean
}) {
  const pose = valeur !== null && valeur !== ""
  const inerte = !canWrite || enregistrement || brouillon.trim() === "" || brouillon.trim() === (valeur ?? "")
  return (
    <LigneAccordeon
      id={id}
      titre={titre}
      etat={pose ? valeur : "absent"}
      etatVariant={pose ? "secondary" : "destructive"}
      ouvert={ouvert}
      canWrite={canWrite}
      onToggle={onToggle}
    >
      <div className="ml-6 flex flex-col gap-3 rounded-lg bg-muted/40 p-4">
        <Input id={`pixel-${id}`} type="text" value={brouillon} placeholder={placeholder} disabled={!canWrite || enregistrement} onChange={(event) => onBrouillon(event.target.value)} />
        {erreur === null ? null : <p role="alert" className="text-sm text-destructive">{erreur}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="cursor-pointer" disabled={inerte} onClick={onEnregistrer}>
            {enregistrement ? "Enregistrement…" : "Enregistrer"}
          </Button>
          {pose ? (
            <Button type="button" variant="ghost" size="sm" className="cursor-pointer" disabled={!canWrite || enregistrement} onClick={onRetirer}>
              Retirer
            </Button>
          ) : null}
        </div>
      </div>
    </LigneAccordeon>
  )
}

export function DialogueConfirmation(p: {
  open: boolean
  title: string
  body: string
  cancel: string
  confirm: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={p.open} onOpenChange={(o) => { if (!o) p.onCancel() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{p.title}</AlertDialogTitle>
          <AlertDialogDescription>{p.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={p.onCancel}>{p.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={p.busy} onClick={p.onConfirm}>
            {p.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
