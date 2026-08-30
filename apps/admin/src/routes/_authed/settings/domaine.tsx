import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Enregistrement, Verdict } from "@astrotan/backend/convex/dns"
import { describeSettingsError } from "@/lib/settingsErrors"
import { TableauDns, fusionnerVerdicts } from "@/components/domain-check"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSettingsAccess,
} from "@/components/settings-page"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export const Route = createFileRoute("/_authed/settings/domaine")({
  component: DomaineRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>

function DomaineRoute() {
  const { loading, canWrite } = useSettingsAccess()
  const settings = useQuery(api.settings.getPrivate)
  if (loading || settings === undefined) {
    return <SettingsLoading />
  }
  return <DomaineForm settings={settings} canWrite={canWrite} />
}

// ---------------------------------------------------------------------
// Un champ, un bouton, et ce que l'hébergeur attend qu'on crée.
//
// CE QUE CE CHAMP NE FAIT PAS
//
// Il ne change pas le domaine du déploiement, et il ne le peut pas :
// `WEB_DOMAIN` est figée AU BUILD de l'image du site
// (`apps/web/astro.config.ts`), Traefik pose l'hôte depuis `docker/.env`,
// et aucune valeur de base n'est lue nulle part pour en décider. Ce qu'il
// fait, c'est donner une entrée à la vérification ci-dessous.
//
// POURQUOI RIEN NE PART TOUT SEUL À LA SAISIE
//
// Même raison que `settings/webhook.tsx`, appliquée à un autre effet de
// bord : une valeur intermédiaire est nuisible. `exemple.f` est une saisie
// en route vers `exemple.fr`, et enregistrée ne serait-ce qu'une seconde
// elle deviendrait le domaine que la vérification interroge — cinq
// requêtes sortantes vers un nom qui n'est pas le sien. D'où
// `auto: {}` : `snapshotChanged({}, {})` est toujours faux, la
// temporisation n'est jamais armée. La vérification, elle, part bien
// toute seule — mais du domaine ENREGISTRÉ, jamais de ce qui est dans le
// champ (voir `VerificationDns`).
// ---------------------------------------------------------------------

function DomaineForm({
  settings,
  canWrite,
}: {
  settings: Settings
  canWrite: boolean
}) {
  const updateSettings = useMutation(api.settings.update)
  const [domaine, setDomaine] = useState(settings?.declaredDomain ?? "")

  // La vérification porte sur le domaine ENREGISTRÉ, jamais sur ce qui est
  // dans le champ : c'est ce qui garantit qu'aucune frappe intermédiaire
  // n'atteint le résolveur. Le libellé du bouton le nomme, pour qu'on ne
  // puisse pas croire qu'il vérifie autre chose.
  const domaineEnregistre = settings?.declaredDomain ?? null

  // Chaîne vide = « effacer » : `null` retire le réglage côté serveur, là
  // où `undefined` le laisserait tel quel (sémantique à trois états de
  // `settings.update`).
  const manualFields = {
    declaredDomain: domaine.trim() === "" ? null : domaine.trim(),
  }

  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: {},
    manual: manualFields,
    saveAuto: async () => {
      // Inatteignable par construction (`auto: {}` ci-dessus). Lever
      // plutôt que ne rien faire : si un changement futur de `useAutoSave`
      // arme quand même la temporisation, l'erreur s'affiche dans la barre
      // au lieu d'enregistrer un domaine à moitié tapé en douce.
      throw new Error(
        "Le domaine n'a aucun champ à sauvegarde automatique : cet appel ne devrait pas exister."
      )
    },
    saveAll: async ({ manual }) => {
      await updateSettings(manual)
    },
    // Le serveur refuse déjà les formes invalides (`normaliserHote`,
    // `INVALID_DOMAIN`) ; ce contrôle-ci existe pour que le refus nomme la
    // faute au lieu de la faire deviner.
    validate: ({ manual }) =>
      manual.declaredDomain === null || ressembleAUnHote(manual.declaredDomain)
        ? null
        : "Un nom de domaine s'écrit « exemple.fr » : sans https://, sans barre oblique, sans port.",
    describeError: describeSettingsError,
  })

  return (
    <SettingsFormShell
      to="/settings/domaine"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="Le nom de domaine déclaré"
    >
      <SettingsGroup>
        <Field>
          <FieldLabel htmlFor="domaine">Votre nom de domaine</FieldLabel>
          <Input
            id="domaine"
            type="text"
            placeholder="exemple.fr"
            value={domaine}
            disabled={!canWrite}
            onChange={(event) => setDomaine(event.target.value)}
          />
          <FieldDescription>
            Sans <code className="text-xs">https://</code>, sans{" "}
            <code className="text-xs">www</code>.
          </FieldDescription>
        </Field>

        {canWrite ? <VerificationDns domaine={domaineEnregistre} /> : null}
      </SettingsGroup>
    </SettingsFormShell>
  )
}

/**
 * Assez pour distinguer une faute de frappe d'un domaine — pas une
 * seconde copie de `HOTE_NU`.
 *
 * La règle exacte vit côté serveur (`convex/lib/hoteNu.ts`) et y reste :
 * la recopier ici en ferait deux, qui divergeraient. Celle-ci attrape ce
 * qu'un opérateur tape réellement de travers — une URL collée entière, un
 * chemin, un port — et laisse le serveur trancher le reste.
 */
function ressembleAUnHote(valeur: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(valeur)
}

// ---------------------------------------------------------------------
// Le tableau, et la vérification qui le tient à jour.
// ---------------------------------------------------------------------

type Plan = { site: Enregistrement[]; email: Enregistrement[] }
type Resultat = { site: Verdict[]; email: Verdict[] }

/**
 * Les deux tableaux, du plan seul ou du plan enrichi de son verdict.
 *
 * PUR ET EXPORTÉ, SANS HOOK — c'est ici que se joue le défaut corrigé.
 * `resultat` encore `null` (avant la première vérification, ou après un
 * échec réseau) ne fait plus disparaître le tableau : `fusionnerVerdicts`
 * laisse chaque ligne à `"attente"`, et le tableau se rend quand même.
 * Aucun hook ici, donc aucun `ConvexProvider` requis pour le tester —
 * `plan` et `resultat` sont de simples valeurs, dans la même veine que
 * `FormulaireReinitialisation` (`routes/reset-password.tsx`).
 */
export function TableauxDns({
  plan,
  resultat,
}: {
  plan: Plan
  resultat: Resultat | null
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Deux tableaux plutôt qu'un seul : « Le site » et « Les emails »
          se corrigent chez le même hébergeur mais pour deux pannes qui
          n'ont rien à voir — le site injoignable d'un côté, les emails
          refusés de l'autre. */}
      <TableauDns
        titre="Le site"
        lignes={fusionnerVerdicts(plan.site, resultat?.site ?? null)}
      />
      <TableauDns
        titre="Les emails"
        lignes={fusionnerVerdicts(plan.email, resultat?.email ?? null)}
      />
    </div>
  )
}

function VerificationDns({ domaine }: { domaine: string | null }) {
  // `"skip"` sans domaine déclaré : `dns.plan` exige un argument et
  // refuserait une chaîne vide (`INVALID_DOMAIN`) — même convention que
  // `webhookSecret` dans `settings/webhook.tsx`.
  const plan = useQuery(api.dns.plan, domaine === null ? "skip" : { domaine })
  const checkSite = useAction(api.dns.checkSite)
  const checkEmail = useAction(api.dns.checkEmail)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [resultat, setResultat] = useState<Resultat | null>(null)

  async function verifier(hote: string) {
    setEnCours(true)
    setErreur(null)
    try {
      // Les deux ensemble : elles sont indépendantes, et les enchaîner
      // ferait attendre deux fois le délai d'attente du résolveur.
      const [site, email] = await Promise.all([
        checkSite({ domaine: hote }),
        checkEmail({ domaine: hote }),
      ])
      setResultat({ site, email })
    } catch (err) {
      setErreur(describeSettingsError(err))
    } finally {
      setEnCours(false)
    }
  }

  // Une fois au montage, et à chaque changement du domaine ENREGISTRÉ —
  // jamais à chaque rendu. C'est ce qui remplit la colonne d'état « tout
  // le temps », comme demandé, sans réémettre les cinq requêtes sortantes
  // à chaque frappe dans le champ ou à chaque re-rendu du formulaire :
  // `domaine` ne change que quand `settings.update` a effectivement
  // enregistré une nouvelle valeur.
  useEffect(() => {
    if (domaine !== null) void verifier(domaine)
    // `verifier` ferme sur `checkSite`/`checkEmail`, stables d'un rendu à
    // l'autre (`useAction` les mémoïse) : les lister ici ne changerait
    // rien à quand l'effet se relance, et les omettre est le point — seul
    // `domaine` doit déclencher une nouvelle vérification.
  }, [domaine])

  return (
    <div className="flex flex-col gap-4">
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={domaine === null || enCours}
        onClick={() => {
          if (domaine !== null) void verifier(domaine)
        }}
      >
        {enCours
          ? "Lecture du DNS…"
          : domaine === null
            ? "Vérifier"
            : resultat === null
              ? `Vérifier ${domaine}`
              : `Revérifier ${domaine}`}
      </Button>

      {erreur !== null ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : null}

      {/* Le tableau tient du plan seul, dès qu'il est chargé — pas besoin
          d'attendre `resultat` : c'est le défaut de fond que cet écran
          corrige. */}
      {plan !== undefined ? (
        <TableauxDns plan={plan} resultat={resultat} />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// LES CINQ ENDROITS OÙ UN DOMAINE SE CHANGE — RETIRÉS DE L'ÉCRAN.
//
// Cet écran portait une liste ordonnée de cinq étapes, sous le titre
// « Changer de domaine se fait en cinq endroits, et aucun n'est cet
// écran ». Elle est supprimée sur consigne, sans rien pour la remplacer :
// une procédure manuelle affichée dans une interface n'est pas de la
// documentation, c'est l'aveu que l'écran ne fait pas son travail. Sur un
// template installé par des tiers, chaque adoptant la referait et
// plusieurs la rateraient. Le correctif — faire suivre automatiquement ce
// qui peut l'être — est une refonte d'architecture, pas cet écran-ci.
//
// Le contenu, pour qu'il ne se perde pas d'ici là (les trois premiers
// points vivent aussi dans `docker/README.md`) :
//
//   1. Les enregistrements DNS chez l'hébergeur — ceux que le tableau
//      ci-dessus lit.
//   2. `WEB_DOMAIN` et `ADMIN_DOMAIN` dans le `docker/.env` du VPS :
//      Traefik y prend ses règles de routage et ses certificats
//      Let's Encrypt.
//   3. Reconstruire LES DEUX images avec leurs build-args — `WEB_DOMAIN`
//      pour le site, qu'`astro.config.ts` fige dans
//      `security.allowedDomains` AU BUILD (un `docker/.env` corrigé sans
//      reconstruction ne change donc rien), et `VITE_WEB_SITE_URL` pour le
//      dashboard, d'où partent les liens d'aperçu.
//   4. `npx convex env set SITE_URL https://admin.exemple.fr` et
//      `npx convex env set WEB_SITE_URL https://exemple.fr`.
//   5. Le domaine d'expédition, vérifié chez Resend — sinon Resend refuse
//      les envois.
//
// Puis redéployer. Un seul oublié et la panne ne dit pas son nom :
// certificat émis pour un domaine que personne ne visite, aperçus qui
// pointent ailleurs, ou conteneur du site qui refuse de démarrer.
//
// LES DEUX LIGNES D'ÉTAT (« Liens des emails », « Site construit pour »)
// qui rendaient visibles les deux premières de ces pannes ont été
// retirées sur consigne explicite, répétée deux fois. Rien ne les
// remplace ailleurs sur cet écran.
// ---------------------------------------------------------------------
