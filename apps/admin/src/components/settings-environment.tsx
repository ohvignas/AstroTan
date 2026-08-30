import type { ReactNode } from "react"
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
// Les pages qui portent les JETONS et les variables de déploiement —
// Mesure & pixels et IA ici, Envoi des emails dans `email-templates.tsx`,
// qui emprunte `ChampSecret` et `SecretsBloc` ci-dessous.
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
// Les trois dernières ont déménagé avec la page qui les portait ; voir le
// bloc « Domaine & emails — RETIRÉE » plus bas.
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
      source: "aucune",
    }
  )
}

/**
 * Un jeton, avec la règle « sans clé maîtresse, pas de champ » appliquée
 * une seule fois.
 *
 * Exporté depuis que la page « Envoi des emails » vit dans son propre
 * fichier (`email-templates.tsx`) : la recopier là-bas aurait fait deux
 * endroits où décider quand un champ de jeton s'affiche, et le second
 * aurait oublié la clé maîtresse.
 */
export function ChampSecret({
  bloc,
  nom,
  children,
  consequence,
}: {
  bloc: SecretsBloc
  nom: string
  children?: ReactNode
  /** Ce qui s'arrête sans ce jeton, lu au moment de confirmer un retrait. */
  consequence?: ReactNode
}) {
  return (
    <SecretField
      etat={etatDe(bloc, nom)}
      consequence={consequence}
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
      <ChampSecret bloc={secrets} nom="OPENROUTER_API_KEY">
        {/* Dire ce qui n'existe pas encore : une pastille verte sur une
            fonctionnalité absente est un mensonge que personne ne
            corrigera, parce que rien ne casse. */}
        <strong>Aucune fonction de ce dépôt ne lit encore cette clé</strong>,
        ni ici ni dans l'environnement. La poser prépare le terrain ; elle ne
        déclenche rien aujourd'hui.
      </ChampSecret>
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
// Domaine & emails — RETIRÉE.
//
// `DomainAndEmailsPage` vivait ici et n'était plus rendue par personne :
// `/settings/domaine` a été réécrit (`routes/_authed/settings/domaine.tsx`)
// autour du domaine déclaré et de la vérification DNS, sans la reprendre.
// Elle est restée quelques heures en place, exportée, testée, et
// injoignable — du code mort qui a l'exacte apparence d'un écran vivant,
// ce qui est pire que pas de code du tout : on le lit en croyant lire ce
// que l'opérateur voit.
//
// Où sont parties ses deux moitiés :
//
//   • **la clé Resend, le mode d'essai et l'adresse d'expédition** sont
//     dans `email-templates.tsx` et `/settings/emails`. La saisie de
//     `RESEND_API_KEY` avait disparu de toute l'administration avec cette
//     réécriture — c'est la régression que ce nouvel écran referme ;
//   • **`SITE_URL`** est passée par `email-templates.tsx` (`OrigineDesLiens`)
//     un temps, puis en est repartie avec la refonte « états, étiquettes,
//     actions » (`settings-environment.test.tsx`) : un bloc qui n'était
//     qu'explication et commande n'a pas sa place sur un écran de réglages.
//     Elle vit maintenant à côté de `WEB_SITE_URL`, pour la même raison —
//     voir la ligne suivante ;
//   • **`WEB_SITE_URL`** et `SITE_URL` sont toutes deux nommées par
//     `routes/_authed/settings/domaine.tsx` (`AvertissementDivergence` pour
//     l'une, `OrigineDesLiens` de `components/domain-check.tsx` pour
//     l'autre) : le domaine déclaré y vit déjà, c'est la seule ligne de
//     base à laquelle comparer une origine.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Mesure & pixels
// ---------------------------------------------------------------------

/**
 * Ce qu'une confirmation de retrait doit dire pour les quatre premiers
 * identifiants Umami.
 *
 * Ils vont ENSEMBLE — `analytics.ts` les résout tous les quatre ou
 * répond « non configuré » — si bien qu'en retirer un revient à couper
 * les statistiques entières. La même phrase pour les quatre, parce que
 * c'est la même conséquence.
 */
const CONSEQUENCE_UMAMI =
  "Les statistiques cessent de s'afficher : les quatre identifiants vont ensemble, et il en manquera un."

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
              <strong>La base est lue</strong>{" "}
              : <code className="text-xs">convex/analytics.ts</code> résout
              ces quatre identifiants via le lecteur unique{" "}
              <code className="text-xs">secrets.lireSecret</code>, qui
              préfère la variable d'environnement quand elle existe et
              retombe sinon sur la valeur saisie ici, une fois déchiffrée.
              {" "}
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
                "L'environnement est incomplet : si la base ne complète pas ce qui manque, les statistiques répondent « non configuré »."
              )}
            </p>
            <ChampSecret
              bloc={secrets}
              nom="UMAMI_API_URL"
              consequence={CONSEQUENCE_UMAMI}
            >
              L'origine de votre Umami, sans barre finale.
            </ChampSecret>
            <ChampSecret
              bloc={secrets}
              nom="UMAMI_API_WEBSITE_ID"
              consequence={CONSEQUENCE_UMAMI}
            >
              L'identifiant du site mesuré, tel qu'Umami l'a créé.
            </ChampSecret>
            <ChampSecret
              bloc={secrets}
              nom="UMAMI_API_USERNAME"
              consequence={CONSEQUENCE_UMAMI}
            >
              Un compte Umami en lecture.{" "}
              <code className="text-xs">UMAMI_API_*</code> et non{" "}
              <code className="text-xs">UMAMI_*</code> : le{" "}
              <code className="text-xs">.env</code> du VPS porte déjà{" "}
              <code className="text-xs">UMAMI_DB_PASSWORD</code> et{" "}
              <code className="text-xs">UMAMI_APP_SECRET</code>, qui sont
              d'autres secrets pour un autre usage.
            </ChampSecret>
            <ChampSecret
              bloc={secrets}
              nom="UMAMI_API_PASSWORD"
              consequence={CONSEQUENCE_UMAMI}
            >
              Le mot de passe de ce compte. Envoyé à Umami une fois, contre un
              jeton de session que le serveur garde une demi-heure.
            </ChampSecret>
            <ChampSecret bloc={secrets} nom="UMAMI_API_SHARE_ID">
              Facultative, et elle doit le rester : un lien de partage Umami
              est un secret porteur — qui le détient voit les chiffres, sans
              compte.
              {umamiApi.shared ? " Une valeur est posée dans l'environnement." : ""}
            </ChampSecret>
            <Command>
              cd packages/backend && npx convex env set UMAMI_API_PASSWORD …
            </Command>
          </>
        )}
      </SettingsGroup>
    </>
  )
}
