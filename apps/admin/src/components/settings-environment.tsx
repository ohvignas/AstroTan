import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { SettingsGroup } from "@/components/settings-nav"
import {
  CleMaitresseBandeau,
  Command,
  SecretField,
  SecretHorsPortee,
  SecretsReserves,
} from "@/components/settings-secrets"
import type { CleMaitresseEtat, SecretEtat } from "@/components/settings-secrets"

// ---------------------------------------------------------------------
// Les trois pages qui portent les JETONS et les variables de déploiement —
// Domaine & emails, Mesure & pixels, IA.
//
// Elles n'avaient aucun champ, et le fichier expliquait pourquoi : une clé
// d'API n'entre pas dans la table `settings`, qui a une projection publique.
// C'est toujours vrai, et c'est pour cela que les jetons ont maintenant leur
// PROPRE table, chiffrée (`convex/secrets.ts`) — pas parce que la contrainte
// a disparu, mais parce qu'on lui a donné un autre logement.
//
// Ce qui reste sans champ, et le restera :
//
//   • les variables `PUBLIC_*` d'`apps/web` (pixels, script Umami) : Astro
//     les fige AU BUILD de l'image du site, comme `PUBLIC_CONVEX_URL`. Un
//     champ en base qui prétendrait les régler n'aurait aucun effet, en
//     silence ;
//   • `SITE_URL` / `WEB_SITE_URL` : lues au chargement des modules Convex
//     (la `baseURL` de Better Auth, l'invalidation de cache), pas au moment
//     de l'usage — une valeur en base arriverait trop tard ;
//   • `RESEND_TEST_MODE` : lu dans le constructeur du client Resend, même
//     raison ;
//   • un domaine, qui se règle chez le registrar, dans le DNS et dans
//     Traefik.
//
// Un formulaire est une promesse. Ces lignes-là n'en font aucune : elles
// disent l'état, nomment la variable, et donnent la commande.
// `settings-environment.test.tsx` échoue si un champ de saisie apparaît sur
// l'une d'elles.
// ---------------------------------------------------------------------

/** Tout ce dont ces pages ont besoin pour afficher et écrire un jeton. */
export interface SecretsBloc {
  /** `null` quand l'appelant n'a pas le droit de lire l'état (editor). */
  cleMaitresse: CleMaitresseEtat | null
  etats: Record<string, SecretEtat>
  canWrite: boolean
  onSave: (nom: string, valeur: string) => Promise<void>
  onClear: (nom: string) => Promise<void>
}

/**
 * Un état par défaut plutôt qu'un rendu conditionnel à chaque appel : la
 * query et la liste des noms viennent de deux endroits, et un nom que le
 * serveur ne connaît pas doit s'afficher « absent » au lieu de faire
 * disparaître la ligne sans rien dire.
 */
function etatDe(bloc: SecretsBloc, nom: string): SecretEtat {
  return (
    bloc.etats[nom] ?? {
      nom,
      environnement: false,
      base: false,
      illisible: false,
      quatreDerniers: null,
      majAt: null,
      source: "aucune",
    }
  )
}

function Champ({
  bloc,
  nom,
  children,
}: {
  bloc: SecretsBloc
  nom: string
  children?: ReactNode
}) {
  return (
    <SecretField
      etat={etatDe(bloc, nom)}
      // Sans clé maîtresse, l'écriture est refusée côté serveur : le champ
      // est masqué plutôt que de laisser taper une clé pour rien.
      disabled={!bloc.canWrite || bloc.cleMaitresse !== "posee"}
      onSave={(valeur) => bloc.onSave(nom, valeur)}
      onClear={() => bloc.onClear(nom)}
    >
      {children}
    </SecretField>
  )
}

// ---------------------------------------------------------------------
// IA
// ---------------------------------------------------------------------

export function AiPage({ secrets }: { secrets: SecretsBloc }) {
  if (secrets.cleMaitresse === null) return <SecretsReserves />
  return (
    // Un seul groupe : pas de `h2`, il ne ferait que répéter le `h1`.
    <SettingsGroup>
      <CleMaitresseBandeau etat={secrets.cleMaitresse} />
      <Champ bloc={secrets} nom="OPENROUTER_API_KEY">
        {/* Dire ce qui n'existe pas encore : une pastille verte sur une
            fonctionnalité absente est un mensonge que personne ne
            corrigera, parce que rien ne casse. */}
        <strong>Aucune fonction de ce dépôt ne lit encore cette clé</strong>,
        ni ici ni dans l'environnement. La poser prépare le terrain ; elle ne
        déclenche rien aujourd'hui.
      </Champ>
      <p className="text-sm text-muted-foreground">
        L'autre chemin, plus sûr, et celui qui l'emporte sur la saisie
        ci-dessus :
      </p>
      <Command>
        cd packages/backend && npx convex env set OPENROUTER_API_KEY sk-or-…
      </Command>
    </SettingsGroup>
  )
}

// ---------------------------------------------------------------------
// Domaine & emails
//
// Une seule page pour les deux, et la raison est dans les données :
// `SITE_URL` est à la fois l'origine du dashboard et celle qui compose
// les liens contenus dans les emails. Séparées, les deux pages
// l'affichaient chacune de son côté — le même réglage montré deux fois,
// à deux endroits, sans que rien ne dise que c'était le même.
// ---------------------------------------------------------------------

export function DomainAndEmailsPage({
  resend,
  adminUrl,
  webUrl,
  secrets,
}: {
  resend: { configured: boolean; testMode: boolean }
  adminUrl: string | null
  webUrl: string | null
  secrets: SecretsBloc
}) {
  return (
    <>
      <SettingsGroup
        title="Les deux origines"
        description="Ce déploiement en connaît deux, et les confondre casse des choses différentes."
      >
        <SecretHorsPortee
          nom="SITE_URL"
          raison={
            <>
              L'origine du <strong>dashboard</strong> : elle sert de{" "}
              <code className="text-xs">baseURL</code> à Better Auth et compose
              les liens des emails d'invitation. Lue au chargement des modules
              Convex, pas au moment de l'usage — une valeur saisie à l'écran
              arriverait toujours trop tard.{" "}
              {adminUrl ? (
                <>
                  Actuellement <code className="text-xs">{adminUrl}</code>.
                </>
              ) : (
                <Badge variant="destructive">Absente</Badge>
              )}
            </>
          }
        />
        <SecretHorsPortee
          nom="WEB_SITE_URL"
          raison={
            <>
              L'origine du <strong>site public</strong> : c'est elle qu'on
              appelle pour invalider le cache à la publication. Fausse, le site
              continue de servir l'ancienne version sans que rien ne le signale
              ailleurs que dans la file d'invalidation.{" "}
              {webUrl ? (
                <>
                  Actuellement <code className="text-xs">{webUrl}</code>.
                </>
              ) : (
                <Badge variant="destructive">Absente</Badge>
              )}
            </>
          }
          commande="cd packages/backend && npx convex env set WEB_SITE_URL https://exemple.fr"
        />
        <p className="text-sm text-muted-foreground">
          Changer de nom de domaine se fait en trois endroits, et aucun
          n'est cet écran : les enregistrements DNS chez le registrar,{" "}
          <code className="text-xs">WEB_DOMAIN</code> /{" "}
          <code className="text-xs">ADMIN_DOMAIN</code> dans le{" "}
          <code className="text-xs">docker/.env</code> du VPS — d'où Traefik
          tire les certificats Let's Encrypt — puis ces deux variables ici.
          Les trois doivent concorder, sinon les certificats sont émis pour
          un domaine que personne ne visite.
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="Envoi des emails"
        description="Les invitations et les notifications de leads partent par Resend."
      >
        {secrets.cleMaitresse === null ? (
          <p className="text-sm text-muted-foreground">
            La clé Resend est réservée au propriétaire et aux administrateurs
            — y compris son état.
          </p>
        ) : (
          <>
            <CleMaitresseBandeau etat={secrets.cleMaitresse} />
            <Champ bloc={secrets} nom="RESEND_API_KEY">
              Sans elle, une invitation est bien créée mais son email ne part
              pas, et une notification de lead non plus. Le lead, lui, est
              enregistré quoi qu'il arrive.{" "}
              <strong>
                Aujourd'hui, seule la variable d'environnement est lue
              </strong>{" "}
              (<code className="text-xs">convex/lib/resend.ts</code> construit
              le client sur <code className="text-xs">process.env</code>) : une
              valeur saisie ici est bien chiffrée et rangée, mais elle ne
              servira qu'une fois cet appel passé par le lecteur unique{" "}
              <code className="text-xs">secrets.lireSecret</code>.
            </Champ>
            {resend.configured ? null : (
              <p className="text-sm text-muted-foreground">
                <Badge variant="destructive">Absente de l'environnement</Badge>
              </p>
            )}
          </>
        )}

        <SecretHorsPortee
          nom="RESEND_TEST_MODE"
          raison={
            resend.testMode
              ? "Mode d'essai : Resend accepte les envois et ne les délivre pas. C'est la valeur par défaut, et la panne la plus silencieuse de ce déploiement — un email « envoyé » que personne ne reçoit. Lu dans le constructeur du client Resend, donc dans l'environnement seulement. Passer en envois réels demande aussi un domaine d'expédition vérifié chez Resend."
              : "Envois réels : chaque invitation et chaque notification part vraiment. Le domaine d'expédition doit être vérifié chez Resend, sinon Resend refuse."
          }
          commande="cd packages/backend && npx convex env set RESEND_TEST_MODE false"
        />

        <div className="flex flex-col gap-1 border-l-2 border-border pl-3">
          <p className="text-sm font-medium">Adresse d'expédition</p>
          <p className="text-sm text-muted-foreground">
            {/* Écrite en dur dans `convex/leads.ts` et
                `convex/invitations.ts`. La montrer plutôt que d'ouvrir un
                champ qui n'existe pas : c'est le bac à sable de Resend, et
                un opérateur ne le découvre autrement que par ses
                destinataires. */}
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
      </SettingsGroup>
    </>
  )
}

// ---------------------------------------------------------------------
// Mesure & pixels
// ---------------------------------------------------------------------

export function MeasurementPage({
  umamiApi,
  secrets,
}: {
  umamiApi: { configured: boolean; url: string | null; shared: boolean }
  secrets: SecretsBloc
}) {
  return (
    <>
      <SettingsGroup
        title="Le script qui compte"
        description="Umami, auto-hébergé. Le comptage ne dépose aucun cookie et n'attend donc aucun accord ; le rejeu de session, si."
      >
        <p className="text-sm text-muted-foreground">
          Ces trois-là sont lues par Astro <strong>au build</strong> de
          l'image du site public, comme{" "}
          <code className="text-xs">PUBLIC_CONVEX_URL</code> : le dashboard{" "}
          <strong>ne peut pas savoir</strong> ce qu'elles valent, et les
          changer demande de <strong>reconstruire</strong> puis redéployer
          l'image du site. Un champ ici ne ferait rien du tout.
        </p>
        <SecretHorsPortee
          nom="PUBLIC_UMAMI_URL"
          raison={
            <>
              L'origine de votre Umami. Avec l'identifiant ci-dessous, elle
              charge <code className="text-xs">script.js</code> sur chaque
              page.
            </>
          }
        />
        <SecretHorsPortee
          nom="PUBLIC_UMAMI_WEBSITE_ID"
          raison="Le site mesuré, tel qu'Umami l'a créé."
        />
        <SecretHorsPortee
          nom="PUBLIC_UMAMI_RECORDER"
          raison={
            <>
              <code className="text-xs">recorder.js</code> — Replays et
              Heatmaps. Celui-là rejoue ce qu'une personne a fait sur la page,
              saisies comprises : il <strong>attend le consentement</strong>,
              là où le simple comptage en est exempté (aucun cookie, aucune IP
              conservée, aucun suivi d'un site à l'autre).
            </>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Les pixels publicitaires"
        description="Leur absence est l'interrupteur, et elle se règle au build comme les précédentes."
      >
        <SecretHorsPortee
          nom="PUBLIC_META_PIXEL_ID"
          raison="Pixel Meta. Catégorie « Publicité » du bandeau."
        />
        <SecretHorsPortee
          nom="PUBLIC_GOOGLE_TAG_ID"
          raison={
            <>
              Balise Google (<code className="text-xs">gtag.js</code>). Classée
              « Publicité » même quand elle sert à mesurer : le même script
              alimente Analytics et Ads, et l'identifiant seul ne dit pas
              lequel.
            </>
          }
        />
        <p className="text-sm text-muted-foreground">
          Sans elles, la catégorie « Publicité » disparaît du bandeau — et
          si plus aucun traceur ne demande d'accord, le bandeau ne
          s'affiche pas du tout. Demander l'autorisation de faire une chose
          qu'on ne fait pas est une nuisance, et une description fausse du
          site. Ajouter un traceur suppose aussi d'incrémenter{" "}
          <code className="text-xs">consentVersion</code> dans{" "}
          <code className="text-xs">apps/web/src/config/consent.ts</code> :
          sans cela, des gens auront « accepté » un tiers qui n'existait pas
          quand ils ont cliqué.
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="Les identifiants qui lisent les chiffres"
        description="Umami auto-hébergé n'a pas de clé d'API : on s'authentifie avec un compte Umami. Les quatre premières ensemble ou rien."
      >
        {secrets.cleMaitresse === null ? (
          <p className="text-sm text-muted-foreground">
            Ces identifiants sont réservés au propriétaire et aux
            administrateurs — y compris leur état.
          </p>
        ) : (
          <>
            <CleMaitresseBandeau etat={secrets.cleMaitresse} />
            <p className="text-sm text-muted-foreground">
              <strong>
                Aujourd'hui, seul l'environnement est lu par les statistiques
              </strong>{" "}
              (<code className="text-xs">convex/analytics.ts</code> appelle{" "}
              <code className="text-xs">readUmamiConfig(process.env)</code>) :
              une valeur saisie ici est bien chiffrée et rangée, mais elle ne
              servira qu'une fois cet appel passé par le lecteur unique{" "}
              <code className="text-xs">secrets.lireSecret</code>.{" "}
              {umamiApi.configured ? (
                <>
                  L'environnement est complet
                  {umamiApi.url ? (
                    <>
                      {" "}
                      (<code className="text-xs">{umamiApi.url}</code>)
                    </>
                  ) : null}
                  .
                </>
              ) : (
                "L'environnement est incomplet : les statistiques répondent « non configuré »."
              )}
            </p>
            <Champ bloc={secrets} nom="UMAMI_API_URL">
              L'origine de votre Umami, sans barre finale.
            </Champ>
            <Champ bloc={secrets} nom="UMAMI_API_WEBSITE_ID">
              L'identifiant du site mesuré, tel qu'Umami l'a créé.
            </Champ>
            <Champ bloc={secrets} nom="UMAMI_API_USERNAME">
              Un compte Umami en lecture.{" "}
              <code className="text-xs">UMAMI_API_*</code> et non{" "}
              <code className="text-xs">UMAMI_*</code> : le{" "}
              <code className="text-xs">.env</code> du VPS porte déjà{" "}
              <code className="text-xs">UMAMI_DB_PASSWORD</code> et{" "}
              <code className="text-xs">UMAMI_APP_SECRET</code>, qui sont
              d'autres secrets pour un autre usage.
            </Champ>
            <Champ bloc={secrets} nom="UMAMI_API_PASSWORD">
              Le mot de passe de ce compte. Envoyé à Umami une fois, contre un
              jeton de session que le serveur garde une demi-heure.
            </Champ>
            <Champ bloc={secrets} nom="UMAMI_API_SHARE_ID">
              Facultative, et elle doit le rester : un lien de partage Umami
              est un secret porteur — qui le détient voit les chiffres, sans
              compte.
              {umamiApi.shared ? " Une valeur est posée dans l'environnement." : ""}
            </Champ>
            <Command>
              cd packages/backend && npx convex env set UMAMI_API_PASSWORD …
            </Command>
          </>
        )}
      </SettingsGroup>
    </>
  )
}
