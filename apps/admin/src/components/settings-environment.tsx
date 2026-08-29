import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { SettingsSection } from "@/components/settings-nav"

// ---------------------------------------------------------------------
// Les quatre sections des réglages qui DÉCRIVENT l'environnement au lieu
// de le modifier.
//
// Elles n'ont aucun champ, et c'est le sujet du fichier plutôt qu'une
// simplification. Trois familles de valeurs échappent à la base, chacune
// pour une raison différente et chacune payée une fois ailleurs :
//
//   • une clé d'API (OpenRouter, Resend, le mot de passe Umami) n'entre
//     pas dans la table `settings`, qui a une projection publique — le
//     secret de signature du webhook y est entré une fois et est devenu
//     lisible par tout Internet ;
//   • un identifiant de pixel (`PUBLIC_META_PIXEL_ID`,
//     `PUBLIC_GOOGLE_TAG_ID`) est figé AU BUILD de l'image du site par
//     Astro, exactement comme `PUBLIC_CONVEX_URL`. Un champ en base qui
//     prétendrait le régler n'aurait aucun effet, en silence ;
//   • un domaine se règle chez le registrar, dans le DNS et dans Traefik.
//
// Un formulaire est une promesse. Ces sections n'en font aucune : elles
// disent l'état réel, nomment la variable, et donnent la commande.
// `settings-environment.test.ts` échoue si un `<input>` réapparaît.
// ---------------------------------------------------------------------

type VarState = "configured" | "missing" | "unknown"

const STATE_LABEL: Record<VarState, string> = {
  configured: "Configurée",
  missing: "Absente",
  // Les variables `PUBLIC_*` d'`apps/web` : Convex ne les voit pas, et
  // afficher « absente » serait une affirmation que rien ne soutient.
  unknown: "Hors de portée du dashboard",
}

/**
 * Une variable d'environnement, telle que l'écran a le droit d'en parler :
 * son nom, son état, et — seulement si ce n'en est pas un secret — sa
 * valeur.
 *
 * Il n'existe volontairement aucune prop qui porterait la valeur d'un
 * secret : la seule façon d'en afficher un serait d'en inventer une, ce
 * qui se voit en revue.
 */
function EnvVar({
  name,
  state,
  label,
  value,
  children,
}: {
  name: string
  state: VarState
  /**
   * Remplace « Configurée / Absente » quand la variable est un
   * interrupteur plutôt qu'une clé : `RESEND_TEST_MODE` absente signifie
   * « mode d'essai », et écrire « Absente » sur cette ligne dirait le
   * contraire de ce qui se passe.
   */
  label?: string
  /** Uniquement pour ce qui figure déjà dans la barre d'adresse d'un visiteur. */
  value?: string | null
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-xs font-medium">{name}</code>
        <Badge
          variant={
            state === "configured"
              ? "secondary"
              : state === "missing"
                ? "destructive"
                : "outline"
          }
        >
          {label ?? STATE_LABEL[state]}
        </Badge>
        {value ? (
          <code className="truncate text-xs text-muted-foreground">{value}</code>
        ) : null}
      </div>
      {children ? (
        <p className="text-sm text-muted-foreground">{children}</p>
      ) : null}
    </div>
  )
}

/** La commande à recopier dans un terminal, puisque l'écran ne peut pas la lancer. */
function Command({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
      <code>{children}</code>
    </pre>
  )
}

// ---------------------------------------------------------------------

export function AiSection({ configured }: { configured: boolean }) {
  return (
    <SettingsSection id="ia">
      <EnvVar
        name="OPENROUTER_API_KEY"
        state={configured ? "configured" : "missing"}
      >
        Posée sur le déploiement Convex, jamais en base : la table des
        réglages a une projection publique, et une clé qui y entrerait
        serait lisible par quiconque connaît l'URL Convex — celle-ci est
        dans le bundle du site.
      </EnvVar>
      <Command>
        cd packages/backend && npx convex env set OPENROUTER_API_KEY sk-or-…
      </Command>
      <p className="text-sm text-muted-foreground">
        {/* Dire ce qui n'existe pas encore : une pastille verte sur une
            fonctionnalité absente est un mensonge que personne ne
            corrigera, parce que rien ne casse. */}
        Aucune fonction de ce dépôt ne lit encore cette clé. La poser
        prépare le terrain ; elle ne déclenche rien aujourd'hui.
      </p>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------

export function EmailsSection({
  resend,
  adminUrl,
}: {
  resend: { configured: boolean; testMode: boolean }
  adminUrl: string | null
}) {
  return (
    <SettingsSection id="emails">
      <EnvVar
        name="RESEND_API_KEY"
        state={resend.configured ? "configured" : "missing"}
      >
        Sans elle, une invitation est bien créée mais son email ne part
        pas, et une notification de lead non plus. Le lead, lui, est
        enregistré quoi qu'il arrive.
      </EnvVar>
      <EnvVar
        name="RESEND_TEST_MODE"
        state={resend.testMode ? "missing" : "configured"}
        label={resend.testMode ? "Mode d'essai" : "Envois réels"}
      >
        {resend.testMode
          ? "Mode d'essai : Resend accepte les envois et ne les délivre pas. C'est la valeur par défaut, et la panne la plus silencieuse de ce déploiement — un email « envoyé » que personne ne reçoit. Passer en envois réels demande `RESEND_TEST_MODE=false` et un domaine d'expédition vérifié chez Resend."
          : "Envois réels : chaque invitation et chaque notification part vraiment. Le domaine d'expédition doit être vérifié chez Resend, sinon Resend refuse."}
      </EnvVar>
      <Command>
        cd packages/backend && npx convex env set RESEND_TEST_MODE false
      </Command>

      <div className="flex flex-col gap-1 border-l-2 border-border pl-3">
        <p className="text-sm font-medium">Adresse d'expédition</p>
        <p className="text-sm text-muted-foreground">
          {/* Écrite en dur dans `convex/leads.ts` et `convex/invitations.ts`.
              La montrer plutôt que d'ouvrir un champ qui n'existe pas :
              c'est le bac à sable de Resend, et un opérateur ne le
              découvre autrement que par ses destinataires. */}
          <code className="text-xs">AstroTan &lt;onboarding@resend.dev&gt;</code>{" "}
          — l'adresse de bac à sable de Resend, écrite dans le code
          (<code className="text-xs">convex/leads.ts</code> et{" "}
          <code className="text-xs">convex/invitations.ts</code>). Elle
          fonctionne sans domaine vérifié et ne doit pas rester en
          production.
        </p>
      </div>

      <div className="flex flex-col gap-1 border-l-2 border-border pl-3">
        <p className="text-sm font-medium">Destinataires des notifications</p>
        <p className="text-sm text-muted-foreground">
          {/* Pas un champ, et c'en aurait été un mauvais : une liste
              d'adresses saisie à la main survit aux départs, aux
              suspensions et aux changements de rôle — l'inverse de ce
              qu'on veut d'une alerte interne. */}
          Chaque message reçu par le formulaire de contact est notifié aux
          comptes <strong>propriétaire</strong> et{" "}
          <strong>administrateur</strong> non suspendus, un email par
          personne. Ce n'est pas une liste à saisir : elle se règle depuis
          l'écran Utilisateurs, en donnant ou en retirant un rôle.
        </p>
      </div>

      <EnvVar name="SITE_URL" state={adminUrl ? "configured" : "missing"} value={adminUrl}>
        L'origine des liens que ces emails contiennent. Absente, l'envoi
        échoue franchement plutôt que d'expédier un lien mort.
      </EnvVar>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------

export function DomainSection({
  adminUrl,
  webUrl,
}: {
  adminUrl: string | null
  webUrl: string | null
}) {
  return (
    <SettingsSection id="domaine">
      <EnvVar name="SITE_URL" state={adminUrl ? "configured" : "missing"} value={adminUrl}>
        L'origine du <strong>dashboard</strong> : elle sert de{" "}
        <code className="text-xs">baseURL</code> à Better Auth et compose
        les liens d'invitation.
      </EnvVar>
      <EnvVar name="WEB_SITE_URL" state={webUrl ? "configured" : "missing"} value={webUrl}>
        L'origine du <strong>site public</strong> : c'est elle qu'on
        appelle pour invalider le cache à la publication. Fausse, le site
        continue de servir l'ancienne version sans que rien ne le signale
        ailleurs que dans la file d'invalidation.
      </EnvVar>
      <Command>
        cd packages/backend && npx convex env set WEB_SITE_URL https://exemple.fr
      </Command>
      <p className="text-sm text-muted-foreground">
        Changer de nom de domaine se fait en trois endroits, et aucun n'est
        cet écran : les enregistrements DNS chez le registrar,{" "}
        <code className="text-xs">WEB_DOMAIN</code> /{" "}
        <code className="text-xs">ADMIN_DOMAIN</code> dans le{" "}
        <code className="text-xs">docker/.env</code> du VPS — d'où Traefik
        tire les certificats Let's Encrypt — puis ces deux variables ici.
        Les trois doivent concorder, sinon les certificats sont émis pour
        un domaine que personne ne visite.
      </p>
    </SettingsSection>
  )
}

// ---------------------------------------------------------------------

export function MeasurementSection({
  umamiApi,
}: {
  umamiApi: { configured: boolean; url: string | null; shared: boolean }
}) {
  return (
    <SettingsSection id="mesure">
      <p className="text-sm text-muted-foreground">
        Rien de ce qui suit ne se règle depuis cet écran, et ce n'est pas
        un oubli. Les variables <code className="text-xs">PUBLIC_*</code>{" "}
        sont lues par Astro <strong>au build</strong> de l'image du site
        public, comme <code className="text-xs">PUBLIC_CONVEX_URL</code> :
        elles sont des secrets GitHub / build-args, le dashboard{" "}
        <strong>ne peut pas savoir</strong> ce qu'elles valent, et les
        changer demande de <strong>reconstruire</strong> puis redéployer
        l'image du site.
      </p>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Le script qui compte</p>
        <EnvVar name="PUBLIC_UMAMI_URL" state="unknown">
          L'origine de votre Umami auto-hébergé. Avec l'identifiant
          ci-dessous, elle charge <code className="text-xs">script.js</code>{" "}
          sur chaque page.
        </EnvVar>
        <EnvVar name="PUBLIC_UMAMI_WEBSITE_ID" state="unknown">
          Le site mesuré, tel qu'Umami l'a créé.
        </EnvVar>
        <EnvVar name="PUBLIC_UMAMI_RECORDER" state="unknown">
          <code className="text-xs">recorder.js</code> — Replays et
          Heatmaps. Celui-là rejoue ce qu'une personne a fait sur la page,
          saisies comprises : il attend le consentement, là où le simple
          comptage en est exempté (aucun cookie, aucune IP conservée,
          aucun suivi d'un site à l'autre).
        </EnvVar>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Les pixels publicitaires</p>
        <EnvVar name="PUBLIC_META_PIXEL_ID" state="unknown">
          Pixel Meta. Catégorie « Publicité » du bandeau.
        </EnvVar>
        <EnvVar name="PUBLIC_GOOGLE_TAG_ID" state="unknown">
          Balise Google (<code className="text-xs">gtag.js</code>). Classée
          « Publicité » même quand elle sert à mesurer : le même script
          alimente Analytics et Ads, et l'identifiant seul ne dit pas
          lequel.
        </EnvVar>
        <p className="text-sm text-muted-foreground">
          <strong>Leur absence est l'interrupteur.</strong> Sans elles, la
          catégorie « Publicité » disparaît du bandeau — et si plus aucun
          traceur ne demande d'accord, le bandeau ne s'affiche pas du tout.
          Demander l'autorisation de faire une chose qu'on ne fait pas est
          une nuisance, et une description fausse du site. Ajouter un
          traceur suppose aussi d'incrémenter{" "}
          <code className="text-xs">consentVersion</code> dans{" "}
          <code className="text-xs">apps/web/src/config/consent.ts</code> :
          sans cela, des gens auront « accepté » un tiers qui n'existait
          pas quand ils ont cliqué.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">
          Les identifiants qui LISENT les chiffres
        </p>
        <p className="text-sm text-muted-foreground">
          Umami auto-hébergé n'a pas de clé d'API : on s'authentifie avec un
          compte Umami. Ces quatre variables vivent sur le déploiement
          Convex — jamais sur le VPS, jamais dans le navigateur — et ce sont
          les seules de cette section que le dashboard peut vérifier.
        </p>
        <EnvVar
          name="UMAMI_API_URL"
          state={umamiApi.configured ? "configured" : "missing"}
          value={umamiApi.url}
        >
          Les quatre ensemble ou rien :{" "}
          <code className="text-xs">UMAMI_API_URL</code>,{" "}
          <code className="text-xs">UMAMI_API_WEBSITE_ID</code>,{" "}
          <code className="text-xs">UMAMI_API_USERNAME</code>,{" "}
          <code className="text-xs">UMAMI_API_PASSWORD</code>. Une
          intégration à moitié posée échouerait au moment de l'appel, là où
          « non configurée » est une réponse nette.
        </EnvVar>
        <EnvVar
          name="UMAMI_API_SHARE_ID"
          state={umamiApi.shared ? "configured" : "missing"}
        >
          Facultative, et elle doit le rester : un lien de partage Umami est
          un secret porteur — qui le détient voit les chiffres, sans compte.
        </EnvVar>
        <Command>
          cd packages/backend && npx convex env set UMAMI_API_PASSWORD …
        </Command>
      </div>
    </SettingsSection>
  )
}
