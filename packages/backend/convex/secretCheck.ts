import { v } from "convex/values"
import { action } from "./_generated/server"
import { api } from "./_generated/api"
import { requireRole } from "./lib/authz"
import { MUTATION_REGISTRY } from "./_registry"
import { MAX_SECRET_LENGTH } from "./secrets"

// ---------------------------------------------------------------------
// Essayer un jeton avant de le ranger.
//
// CE QUE CE MODULE REFERME : `secrets.set` chiffre et range n'importe
// quelle chaîne. Une clé fautive — une lettre perdue au copier-coller,
// une clé révoquée, celle d'un autre compte — s'enregistre exactement
// comme une bonne, sous la même pastille. L'erreur ne se découvre alors
// qu'au premier envoi raté, c'est-à-dire le jour où quelqu'un attend un
// email d'invitation qui n'arrivera pas, et personne ne fait le lien avec
// une saisie faite trois semaines plus tôt.
//
// LA RÈGLE, ET SA LIMITE. On n'annonce « vérifié » que pour les jetons
// qu'on sait réellement essayer. `VERIFICATEURS` est une carte close, et
// tout nom qui n'y figure pas rend `sans_verificateur` — sans appel
// sortant, sans refus, et sans prétendre à rien. Une pastille « vérifié »
// posée sur un essai qui n'a pas eu lieu vaut moins que pas de pastille
// du tout.
//
// CE QUE LE REFUS DIT, ET CE QU'IL TAIT. Le corps d'erreur du service est
// lu — c'est lui qui distingue « clé invalide » de « clé restreinte » —
// mais il ne ressort jamais. « This API key is restricted to only send
// emails » recopié à l'écran n'apprend rien à qui ne connaît pas l'API
// Resend, et pousse à chercher du côté des permissions un problème qui
// est souvent un caractère manquant. L'écran dit donc que le service
// refuse la clé, et rien de plus.
//
// TROIS ISSUES, PAS DEUX. `injoignable` existe parce que confondre « le
// service a dit non » et « le service n'a pas répondu » ferait refuser une
// bonne clé pendant une panne Resend, en accusant l'opérateur. Le refus
// et l'indisponibilité bloquent tous deux l'enregistrement, mais l'écran
// n'en dit pas la même chose : l'un demande de vérifier la clé, l'autre de
// réessayer.
// ---------------------------------------------------------------------

/** 8 s, la même borne que les six autres appels sortants du dépôt. */
const DELAI_MS = 8_000

/** Ce qu'un essai peut conclure. */
export type Issue = "valide" | "refuse" | "injoignable"

export type Verdict =
  | { verdict: Issue; service: string }
  /** Aucun essai n'existe pour ce jeton — il s'enregistre sans être vérifié. */
  | { verdict: "sans_verificateur"; service: null }

interface Verificateur {
  /** Le service, tel qu'un opérateur le nomme. Sert à l'écrire à l'écran. */
  service: string
  essayer: (valeur: string) => Promise<Issue>
}

/**
 * Le `name` du corps d'erreur, quand il y en a un.
 *
 * Lu, jamais rendu : il sert ici à décider, et la décision seule sort.
 */
async function nomDErreur(reponse: Response): Promise<string | null> {
  try {
    const corps: unknown = await reponse.json()
    const nom = (corps as { name?: unknown } | null)?.name
    return typeof nom === "string" ? nom : null
  } catch {
    // Un corps vide ou non-JSON n'est pas une panne : c'est simplement une
    // erreur qu'on ne saura pas qualifier plus finement que son statut.
    return null
  }
}

/**
 * Resend — `GET https://api.resend.com/api-keys`.
 *
 * Le choix de l'endpoint et la lecture de ses codes viennent de la
 * référence Resend (`/docs/api-reference/api-keys/list-api-keys` et
 * `/docs/api-reference/errors`), puis d'un essai réel contre l'API, parce
 * que la documentation ne dit PAS tout :
 *
 *   • clé valide, accès complet → **200** ;
 *   • clé valide mais « Sending access » → **401 `restricted_api_key`**.
 *     Elle s'est authentifiée ; elle n'a simplement pas le droit de lister
 *     les clés. C'est une clé parfaitement bonne pour ce dépôt, qui ne
 *     fait qu'envoyer — la refuser serait le pire faux négatif possible ;
 *   • clé inexistante ou tronquée → **400 `validation_error`**, « API key
 *     is invalid ». Ce cas n'est pas dans la table des erreurs de la
 *     documentation, et c'est le plus fréquent. Une règle « 401 = refus »
 *     écrite depuis la seule documentation aurait donc ACCEPTÉ une clé
 *     bidon, ce qui est exactement le contraire du service rendu ;
 *   • clé désactivée ou suspendue → **403**. Refus : elle existe, elle
 *     n'enverra rien ;
 *   • 429 et 5xx → `injoignable`. Le service n'a pas jugé la clé.
 */
async function essayerResend(valeur: string): Promise<Issue> {
  const reponse = await fetch("https://api.resend.com/api-keys", {
    headers: { authorization: `Bearer ${valeur}` },
    signal: AbortSignal.timeout(DELAI_MS),
  })
  if (reponse.ok) return "valide"
  if (reponse.status === 429 || reponse.status >= 500) return "injoignable"
  if (reponse.status === 401 && (await nomDErreur(reponse)) === "restricted_api_key") {
    return "valide"
  }
  return "refuse"
}

/**
 * La carte close. Un nom absent d'ici n'est pas « non vérifiable » : il
 * est **non vérifié**, et c'est ce que l'écran doit dire.
 *
 * Les cinq `UMAMI_API_*` n'y sont pas, et ce n'est pas un oubli : Umami
 * auto-hébergé n'a pas de clé d'API, on s'y authentifie avec une origine,
 * un compte et un mot de passe. Aucun des trois ne s'essaie seul — un
 * mot de passe sans l'URL ni le compte ne désigne rien à interroger — et
 * les essayer ensemble supposerait un formulaire qui les enregistre
 * ensemble, ce que cet écran ne fait pas. `OPENROUTER_API_KEY` est
 * vérifiable (`GET https://openrouter.ai/api/v1/key`, 200 ou 401) et
 * n'est pas ici non plus : aucune fonction de ce dépôt ne lit encore
 * cette clé, et le premier appelant sera mieux placé pour l'ajouter.
 */
const VERIFICATEURS: Record<string, Verificateur> = {
  RESEND_API_KEY: { service: "Resend", essayer: essayerResend },
}

/**
 * Essayer un jeton, sans rien écrire.
 *
 * `nom` traverse en `string` plutôt que dans l'union close de
 * `secrets.ts`, et c'est délibéré : cette action ne lit ni n'écrit la
 * base, et ne fait d'appel sortant que pour un nom présent dans
 * `VERIFICATEURS` — une carte close, écrite ici, vers des URL fixes. Un
 * nom inconnu rend `sans_verificateur` sans toucher au réseau. Recopier
 * l'union ferait une seconde liste à tenir à jour pour un contrôle que la
 * carte assure déjà.
 *
 * Aucune trace au journal : un essai ne change rien, et journaliser une
 * frappe à chaque tentative reviendrait à écrire dans le journal le
 * rythme auquel quelqu'un se trompe de clé.
 */
export const essayer = action({
  args: { nom: v.string(), valeur: v.string() },
  handler: async (ctx, args): Promise<Verdict> => {
    // Les mêmes deux rôles que `secrets.set` : cette action prend un jeton
    // candidat en clair et le présente à un tiers. Ce n'est pas moins
    // sensible que de le ranger.
    await requireRole(ctx, ["owner", "admin"])

    const verificateur = VERIFICATEURS[args.nom]
    if (verificateur === undefined) return { verdict: "sans_verificateur", service: null }

    const valeur = args.valeur.trim()
    // Deux refus qu'on prononce sans déranger le service : `secrets.set`
    // les refuserait de toute façon, et les lui faire découvrir après un
    // aller-retour réseau n'apprendrait rien de plus.
    if (valeur.length === 0 || valeur.length > MAX_SECRET_LENGTH) {
      return { verdict: "refuse", service: verificateur.service }
    }

    try {
      return { verdict: await verificateur.essayer(valeur), service: verificateur.service }
    } catch {
      // Panne réseau, DNS, ou notre propre `AbortSignal.timeout` : le
      // service n'a pas jugé la clé. Le dire, plutôt que de compter une
      // panne Resend comme une faute de l'opérateur.
      return { verdict: "injoignable", service: verificateur.service }
    }
  },
})

// Le garde-fou d'exhaustivité (`_registry.test.ts`) couvre les actions
// publiques au même titre que les mutations : sans cette entrée, il
// échoue.
//
// `UMAMI_API_URL` et non `RESEND_API_KEY` : la matrice de `lib/authz.test.ts`
// APPELLE réellement cette action pour un owner et pour un admin. Avec un
// nom vérifiable, chaque exécution de la suite partirait interroger
// api.resend.com — un test qui dépend du réseau, et sept requêtes par
// exécution vers un tiers. Un nom sans vérificateur emprunte le même
// chemin d'autorisation et s'arrête avant le `fetch`, ce qui est
// exactement ce que la matrice a besoin d'exercer.
MUTATION_REGISTRY.push({
  name: "secretCheck.essayer",
  allowedRoles: ["owner", "admin"],
  invoke: (t) =>
    t.action(api.secretCheck.essayer, { nom: "UMAMI_API_URL", valeur: "https://umami.exemple.fr" }),
})
