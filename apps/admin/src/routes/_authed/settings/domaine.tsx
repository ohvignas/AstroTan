import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Verdict } from "@astrotan/backend/convex/dns"
import { describeSettingsError } from "@/lib/settingsErrors"
import type { LigneEtat } from "@/components/domain-check"
import { TableauDns, TableauEtats } from "@/components/domain-check"
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
type Environment = FunctionReturnType<typeof api.settings.environment>

function DomaineRoute() {
  const { loading, canWrite } = useSettingsAccess()
  const settings = useQuery(api.settings.getPrivate)
  // Des booléens et deux origines publiques, jamais la valeur d'une clé —
  // `settings.environment.test.ts` échoue si un secret sort d'ici.
  const environment = useQuery(api.settings.environment)
  if (loading || settings === undefined || environment === undefined) {
    return <SettingsLoading />
  }
  return (
    <DomaineForm
      settings={settings}
      environment={environment}
      canWrite={canWrite}
    />
  )
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
// fait, c'est donner une entrée à la vérification ci-dessous, et rendre
// visible l'écart entre le domaine que l'opérateur croit avoir déployé et
// celui pour lequel l'image a été construite — écart qui, autrement, ne
// produit aucun symptôme lisible (voir `AvertissementDivergence`).
//
// POURQUOI RIEN NE PART TOUT SEUL
//
// Même raison que `settings/webhook.tsx`, appliquée à un autre effet de
// bord : une valeur intermédiaire est nuisible. `exemple.f` est une saisie
// en route vers `exemple.fr`, et enregistrée ne serait-ce qu'une seconde
// elle deviendrait le domaine que le bouton « Vérifier » interroge — cinq
// requêtes sortantes vers un nom qui n'est pas le sien. D'où
// `auto: {}` : `snapshotChanged({}, {})` est toujours faux, la
// temporisation n'est jamais armée.
// ---------------------------------------------------------------------

function DomaineForm({
  settings,
  environment,
  canWrite,
}: {
  settings: Settings
  environment: Environment
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

        {canWrite ? (
          <VerificationDns domaine={domaineEnregistre} />
        ) : null}
      </SettingsGroup>

      <SettingsGroup>
        <TableauEtats
          lignes={lignesEtat(
            domaineEnregistre,
            environment.adminUrl,
            environment.webUrl
          )}
        />
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
// Le bouton, et ce qu'il rapporte.
// ---------------------------------------------------------------------

function VerificationDns({ domaine }: { domaine: string | null }) {
  const checkSite = useAction(api.dns.checkSite)
  const checkEmail = useAction(api.dns.checkEmail)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [resultat, setResultat] = useState<{
    site: Verdict[]
    email: Verdict[]
  } | null>(null)

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
      setResultat(null)
    } finally {
      setEnCours(false)
    }
  }

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
            : `Vérifier ${domaine}`}
      </Button>

      {erreur !== null ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : null}

      {resultat !== null ? (
        <div className="flex flex-col gap-5">
          {/* Deux tableaux plutôt qu'un seul : « Le site » et « Les
              emails » se corrigent chez le même hébergeur mais pour deux
              pannes qui n'ont rien à voir — le site injoignable d'un côté,
              les emails refusés de l'autre. Deux titres suivis de prose ne
              disaient pas cette frontière ; deux tableaux la montrent. */}
          <TableauDns titre="Le site" verdicts={resultat.site} />
          <TableauDns titre="Les emails" verdicts={resultat.email} />
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// L'écart entre ce qu'on déclare et ce que le déploiement porte.
//
// Deux lignes d'état, dans la langue du tableau des DNS : une étiquette,
// les valeurs qui divergent, un signe. Elles remplacent deux paragraphes
// retirés sur consigne. Ce qu'ils annonçaient — liens d'emails morts,
// limiteurs de débit à un seul seau pour tout Internet — est écrit en
// commentaire en tête de `domain-check.tsx`, à côté des lignes qui le
// signalent. Le fait reste à l'écran, la conséquence descend dans le code.
// ---------------------------------------------------------------------

/**
 * Les deux lignes, calculées ensemble.
 *
 * Ensemble et non chacune dans son composant : elles se rendent dans le
 * même tableau, et deux fonctions rendraient deux formes de « rien à
 * comparer » là où il n'en faut qu'une.
 */
export function lignesEtat(
  declare: string | null,
  adminUrl: string | null,
  webUrl: string | null
): LigneEtat[] {
  const lignes: LigneEtat[] = []

  // `declare === null` rend `correspondAuDomaine` vrai : sans domaine
  // déclaré il n'y a rien à comparer, donc rien à afficher en rouge. La
  // branche divergente a donc toujours un `declare` — d'où le `?? ""`, qui
  // n'est qu'un garde-fou de type.
  const hoteAdmin = hoteDe(adminUrl)
  const liensOk = correspondAuDomaine(hoteAdmin, declare)
  lignes.push({
    cle: "liens",
    etiquette: "Liens des emails",
    valeurs: liensOk
      ? [adminUrl ?? "non réglée"]
      : [hoteAdmin ?? "non réglée", declare ?? ""],
    ok: liensOk,
  })

  // Origine inconnue : rien à comparer, donc pas de ligne. Un « ok »
  // affiché sans avoir rien pu lire serait un mensonge, et un « ko » une
  // panne inventée.
  const construitPour = hoteDe(webUrl)
  if (construitPour !== null) {
    if (declare === null || construitPour === declare) {
      lignes.push({
        cle: "build",
        etiquette: "Site construit pour",
        valeurs: [construitPour],
        ok: true,
      })
    } else {
      lignes.push({
        cle: "build",
        etiquette: "Site construit pour",
        valeurs: [construitPour, declare],
        ok: false,
      })
    }
  }

  return lignes
}

/**
 * Le domaine pour lequel ce déploiement a été construit — ou `null`.
 *
 * Convex ne peut PAS lire le `WEB_DOMAIN` figé dans l'image du site : c'est
 * une variable de build d'`apps/web`, elle ne traverse pas la frontière.
 * `WEB_SITE_URL` est l'origine que ce déploiement tient pour celle du site,
 * et le conteneur `web` refuse de démarrer si son `WEB_DOMAIN` de runtime
 * diverge de celui du build (`apps/web/verifier-domaine.mjs`) : l'hôte de
 * cette origine est donc la lecture la plus proche du build qui soit
 * disponible d'ici.
 */
function hoteDe(origine: string | null): string | null {
  if (origine === null) return null
  try {
    return new URL(origine).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * L'hôte de `SITE_URL` correspond-il au domaine déclaré ?
 *
 * Pas une égalité stricte, contrairement à la ligne « Site construit pour » :
 * `ADMIN_DOMAIN` est conventionnellement un SOUS-domaine du site
 * (`admin.exemple.fr` pour `exemple.fr` — `docker/.env.example`), jamais le
 * même hôte. `declare === null` rend `true` : sans domaine déclaré, il n'y
 * a rien à comparer, pas une divergence à affirmer.
 */
function correspondAuDomaine(hote: string | null, declare: string | null): boolean {
  if (declare === null) return true
  if (hote === null) return false
  return hote === declare || hote.endsWith(`.${declare}`)
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
//   1. Les enregistrements DNS chez l'hébergeur — ceux que le bouton
//      « Vérifier » de cet écran lit.
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
// pointent ailleurs, ou conteneur du site qui refuse de démarrer. Les deux
// premières de ces pannes sont exactement ce que `lignesEtat` ci-dessus
// rend visible d'un coup d'œil, sans une phrase.
// ---------------------------------------------------------------------
