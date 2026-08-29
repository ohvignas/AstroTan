import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Verdict } from "@astrotan/backend/convex/dns"
import { describeSettingsError } from "@/lib/settingsErrors"
import { OrigineDesLiens, ResultatsDns } from "@/components/domain-check"
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
        <OrigineDesLiens
          adminUrl={environment.adminUrl}
          hote={hoteDe(environment.adminUrl)}
          correspond={correspondAuDomaine(hoteDe(environment.adminUrl), domaineEnregistre)}
          declare={domaineEnregistre}
        />
      </SettingsGroup>

      <AvertissementDivergence
        declare={domaineEnregistre}
        webUrl={environment.webUrl}
      />

      <ProcedureDeChangement />
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
          <GroupeVerdicts titre="Le site" verdicts={resultat.site} />
          <GroupeVerdicts titre="Les emails" verdicts={resultat.email} />
        </div>
      ) : null}
    </div>
  )
}

function GroupeVerdicts({
  titre,
  verdicts,
}: {
  titre: string
  verdicts: Verdict[]
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-heading text-sm font-medium">{titre}</h3>
      <ResultatsDns verdicts={verdicts} />
    </div>
  )
}

// ---------------------------------------------------------------------
// L'écart entre ce qu'on déclare et ce que l'image porte.
// ---------------------------------------------------------------------

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
 * Pas une égalité stricte, contrairement à `AvertissementDivergence` :
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

function AvertissementDivergence({
  declare,
  webUrl,
}: {
  declare: string | null
  webUrl: string | null
}) {
  const construitPour = hoteDe(webUrl)
  if (declare === null || construitPour === null) return null
  if (construitPour === declare) return null
  return (
    <SettingsGroup>
      <p className="text-sm">
        {/* La conséquence est mesurée, pas pronostiquée : sans hôte
            reconnu, `security.allowedDomains` est vide, Astro ignore
            `x-forwarded-for` et `clientAddress` retombe sur l'adresse de
            Traefik — la même pour tout Internet. Les deux limiteurs
            (`/api/contact`, `/api/consent`) n'ont alors qu'un seul seau.
            Voir `apps/web/src/lib/allowedDomains.ts`. */}
        <strong>
          Cette image a été construite pour{" "}
          <code className="text-xs">{construitPour}</code>
        </strong>
        , et vous avez déclaré{" "}
        <code className="text-xs">{declare}</code>. Tant que les deux
        diffèrent, le site ne reconnaît plus ses propres requêtes : tous les
        visiteurs comptent pour un seul aux yeux de ses deux limiteurs de
        débit — cinq messages de contact par heure pour tout Internet, puis
        plus rien.
      </p>
    </SettingsGroup>
  )
}

// ---------------------------------------------------------------------
// Les cinq endroits.
// ---------------------------------------------------------------------

/**
 * La seule procédure de ce dépôt qui dise OÙ un domaine se change.
 *
 * Elle annonçait trois endroits ; il y en a cinq. Manquaient le build-arg
 * `WEB_DOMAIN` de l'image du site — `astro.config.ts` le fige dans
 * `security.allowedDomains`, un `docker/.env` corrigé sans reconstruction
 * ne change donc rien — et `VITE_WEB_SITE_URL` de l'image du dashboard,
 * dont les liens d'aperçu sortent.
 *
 * Elle reste sur cet écran, et pas dans le seul `docker/README.md` :
 * l'opérateur qui change de domaine commence ici, puisque c'est ici qu'il
 * le déclare.
 */
function ProcedureDeChangement() {
  return (
    <SettingsGroup title="Changer de domaine se fait en cinq endroits, et aucun n'est cet écran">
      <ol className="ml-4 flex list-decimal flex-col gap-2 text-sm text-muted-foreground">
        <li>
          Les <strong>enregistrements DNS</strong> chez votre hébergeur — ceux
          que le bouton ci-dessus vérifie.
        </li>
        <li>
          <code className="text-xs">WEB_DOMAIN</code> et{" "}
          <code className="text-xs">ADMIN_DOMAIN</code> dans le{" "}
          <code className="text-xs">docker/.env</code> du VPS : Traefik y prend
          ses règles de routage et ses certificats Let&apos;s Encrypt.
        </li>
        <li>
          <strong>Reconstruire les deux images</strong> avec leurs build-args
          — <code className="text-xs">WEB_DOMAIN</code> pour le site (Astro le
          fige dans <code className="text-xs">security.allowedDomains</code> au
          build) et <code className="text-xs">VITE_WEB_SITE_URL</code> pour le
          dashboard, d&apos;où partent les liens d&apos;aperçu.
        </li>
        <li>
          <code className="text-xs">
            npx convex env set SITE_URL https://admin.exemple.fr
          </code>{" "}
          et{" "}
          <code className="text-xs">
            npx convex env set WEB_SITE_URL https://exemple.fr
          </code>
          .
        </li>
        <li>
          Le <strong>domaine d&apos;expédition</strong>, vérifié chez Resend —
          sinon Resend refuse les envois.
        </li>
      </ol>
      <p className="text-sm text-muted-foreground">
        Puis redéployer. Un seul oublié et la panne ne dit pas son nom :
        certificat émis pour un domaine que personne ne visite, aperçus qui
        pointent ailleurs, ou conteneur du site qui refuse de démarrer.
      </p>
    </SettingsGroup>
  )
}
