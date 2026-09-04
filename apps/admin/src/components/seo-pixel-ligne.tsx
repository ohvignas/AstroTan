import { SettingsGroup } from "@/components/settings-nav"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { SecretsBloc } from "@/components/settings-environment"
import { DataForSeoForm } from "@/components/dataforseo-form"
import { CleMaitresseBandeau } from "@/components/settings-secrets"
import type { DataForSeoIssue } from "@astrotan/backend/convex/lib/dataforseo"

// ---------------------------------------------------------------------
// Les deux morceaux de SEO & Pixel qui ne sont ni le formulaire
// DataForSEO ni le sélecteur de lieu : le groupe des identifiants, et le
// champ d'un pixel.
//
// CE QUI A ÉTÉ RETIRÉ, et qui explique la forme actuelle : les deux
// composants rendaient des `<li>` d'un `<ul className="divide-y">`,
// chacun en `gap-6`, à l'intérieur d'UN SEUL `SettingsGroup`. Trois
// défauts, tous visibles au même endroit :
//
//   1. **le rythme était inversé.** 24 px séparaient deux champs d'une
//      même section, là où 16 px (`gap-4`, `routes/_authed/settings.tsx`)
//      séparent deux GROUPES entiers sur Identité, Webhook ou IA. L'écran
//      respirait donc plus à l'intérieur d'une section qu'entre deux ;
//   2. **les filets de `divide-y` tombaient sans marge.** Un `<li>` sans
//      `py` colle son titre au trait qui le précède et laisse 24 px de
//      vide en dessous : la même frontière serrée d'un côté, lâche de
//      l'autre ;
//   3. **c'était un `SettingsGroup` réimplémenté dans un
//      `SettingsGroup`** — quatre `h2` dans une carte unique, quand le
//      gabarit des réglages dit une carte par groupe.
//
// Il n'y a plus qu'un rythme, et c'est celui des autres pages : 8 px
// dans un champ (`Field`), 16 px entre les enfants d'un groupe, et la
// frontière d'un groupe portée par la carte elle-même (`SettingsGroup` :
// `rounded-xl p-4 ring-1`) plutôt que par un gap plus large.
// ---------------------------------------------------------------------

export function GroupeDataForSeo({
  secrets,
  configure,
  canWrite,
  identifiants,
  onEnregistrer,
  onEffacer,
}: {
  secrets: SecretsBloc
  configure: boolean
  canWrite: boolean
  /**
   * Le login relu en clair et la présence d'un mot de passe
   * (`dataforseo.identifiants`). `undefined` tant que la query n'a pas
   * répondu, ou quand l'appelant n'a pas le droit de la lire.
   */
  identifiants: { login: string | null; passwordPose: boolean } | undefined
  onEnregistrer: (login: string, password: string) => Promise<{ verdict: DataForSeoIssue }>
  onEffacer: () => Promise<void>
}) {
  return (
    <SettingsGroup
      title="DataForSEO"
      description="Le compte d'API qui relève la position du site dans les résultats de recherche."
    >
      {secrets.cleMaitresse === null ? (
        // Un editor, et rien d'autre : `useSecretsAccess` ne rend `null`
        // que lorsque l'appelant n'a pas le droit de lire l'état des
        // jetons. Une phrase, comme sur IA — la pastille rouge
        // « Réservé » annonçait une panne là où il ne manque qu'un droit,
        // et la couleur portait seule cette nuance.
        <p className="text-sm text-muted-foreground">
          Réservé au propriétaire et aux administrateurs.
        </p>
      ) : secrets.cleMaitresse === "posee" ? (
        /* Le formulaire se monte AVEC le login déjà relu — la route
           attend la query (`settings/mesure.tsx`). Son état initial
           vient donc des props une bonne fois, et un rafraîchissement
           ultérieur ne vient plus écraser une saisie en cours. */
        <DataForSeoForm
          canWrite={canWrite}
          login={identifiants?.login ?? null}
          passwordPose={identifiants?.passwordPose ?? false}
          branche={configure}
          onEnregistrer={onEnregistrer}
          onEffacer={onEffacer}
        />
      ) : (
        <CleMaitresseBandeau etat={secrets.cleMaitresse} />
      )}
    </SettingsGroup>
  )
}

/**
 * Un pixel : son identifiant, et de quoi le poser ou le retirer.
 *
 * Un `Field`, exactement comme « Nom du site » sur Identité — label,
 * contrôle, aide, puis la rangée d'action. Le titre était un `h2` sans
 * `<label>` du tout : l'`<input>` n'avait donc aucune étiquette
 * programmatique, et un lecteur d'écran annonçait un champ sans nom.
 */
export function ChampPixel({
  id,
  titre,
  aide,
  valeur,
  brouillon,
  onBrouillon,
  placeholder,
  erreur,
  canWrite,
  onEnregistrer,
  onRetirer,
  enregistrement,
}: {
  id: string
  titre: string
  /** Où trouver cet identifiant. Une phrase, persistante sous le champ. */
  aide: string
  valeur: string | null
  brouillon: string
  onBrouillon: (valeur: string) => void
  placeholder: string
  erreur: string | null
  canWrite: boolean
  onEnregistrer: () => void
  onRetirer: () => void
  enregistrement: boolean
}) {
  const pose = valeur !== null && valeur !== ""
  const inerte =
    !canWrite ||
    enregistrement ||
    brouillon.trim() === "" ||
    brouillon.trim() === (valeur ?? "")

  return (
    <Field>
      <FieldLabel htmlFor={`pixel-${id}`}>{titre}</FieldLabel>
      <Input
        id={`pixel-${id}`}
        type="text"
        // Le navigateur n'a rien à proposer sur un identifiant de régie.
        autoComplete="off"
        value={brouillon}
        placeholder={placeholder}
        disabled={!canWrite || enregistrement}
        onChange={(event) => onBrouillon(event.target.value)}
      />
      {erreur === null ? (
        <FieldDescription>{aide}</FieldDescription>
      ) : (
        <FieldError>{erreur}</FieldError>
      )}
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="cursor-pointer"
            disabled={inerte}
            onClick={onEnregistrer}
          >
            {enregistrement ? "Enregistrement…" : "Enregistrer"}
          </Button>
          {pose ? (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">
              Connecté
            </span>
          ) : null}
          {pose ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              disabled={enregistrement}
              onClick={onRetirer}
            >
              Retirer
            </Button>
          ) : null}
        </div>
      ) : null}
    </Field>
  )
}
