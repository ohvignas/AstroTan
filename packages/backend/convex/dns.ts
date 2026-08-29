import { ConvexError, v } from "convex/values"
import { action } from "./_generated/server"
import { api } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { requireRole } from "./lib/authz"
import { resoudre, type TypeDns } from "./lib/doh"
import { normaliserHote } from "./lib/hoteNu"
import { isPrivateIpv4 } from "./lib/webhookUrl"

// Dire à l'adoptant quels enregistrements DNS créer, et lesquels sont déjà là.
//
// AstroTan est installé par des tiers, chez leur hébergeur, avec leur
// domaine. Deux choses doivent tenir : que le site réponde (les A), et que
// ses emails arrivent (SPF, DKIM, DMARC). Ces deux vérifications ne
// changent rien nulle part — elles lisent le DNS public et rendent, pour
// chaque enregistrement, ce qu'il faut faire.
//
// Des `action` et non des `query` : elles font des appels sortants, ce
// qu'une query Convex ne peut pas. La distinction n'est pas qu'une
// signature — une query est réactive et repartirait vers le résolveur à
// chaque tick d'abonnement, pour une réponse qui met des minutes à changer.
//
// `owner`/`admin` seulement. Un editor ne configure pas le domaine, et
// chaque appel déclenche cinq requêtes sortantes depuis une route qu'un
// compte du dashboard peut atteindre : ce n'est pas une lecture inoffensive.

/**
 * Quatre états, pas deux — et surtout pas trois confondus en deux.
 *
 * - `ok` : l'enregistrement est là et convient.
 * - `manquant` : le nom ne porte pas cet enregistrement. « Créez-le. »
 * - `different` : un enregistrement existe mais ne convient pas.
 *   « Remplacez sa valeur. »
 * - `indisponible` : le résolveur n'a pas répondu. « Réessayez. »
 *
 * `manquant` et `indisponible` doivent rester distincts jusqu'ici :
 * afficher « créez cet enregistrement » quand on n'a simplement pas pu
 * regarder fait créer un doublon chez l'hébergeur de l'adoptant, qu'il
 * devra ensuite diagnostiquer sans savoir d'où il vient.
 */
export type EtatVerdict = "ok" | "manquant" | "different" | "indisponible"

export type Verdict = {
  /** Stable, pour que l'écran s'y accroche : `site`, `admin`, `spf`, … */
  cle: string
  libelle: string
  /** La valeur à saisir chez l'hébergeur, mot pour mot quand elle est connue. */
  attendu: string
  /** Ce que le résolveur a rendu — vide si absent ou indisponible. */
  trouve: string[]
  etat: EtatVerdict
  /**
   * La phrase à suivre, type + nom + valeur compris.
   *
   * Elle est composée ici et pas dans le composant : une instruction rendue
   * à la main dans un JSX n'est vérifiée par rien. Ici, un test l'exige.
   */
  instruction: string
}

type Controle = {
  cle: string
  libelle: string
  /** Le nom DNS interrogé, tel qu'il sera saisi chez l'hébergeur. */
  nom: string
  type: TypeDns
  attendu: string
  /** Une des valeurs trouvées convient-elle ? */
  accepte: (valeurs: string[]) => boolean
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * Cette valeur est-elle une adresse IPv4 qui rend le site joignable ?
 *
 * `isPrivateIpv4` vient de `lib/webhookUrl.ts` : la liste des plages
 * privées y est déjà écrite, et une seconde copie ici divergerait à la
 * première correction. On n'appelle pas `refuseWebhookUrl`, qui exige
 * `https:` et refuserait un hôte nu.
 *
 * Un A vers `192.168.1.10` est l'erreur fréquente derrière un routeur
 * domestique : l'enregistrement existe, il ne mène nulle part depuis
 * l'extérieur. Répondre « ok » enverrait l'adoptant chercher ailleurs.
 */
function estIpv4Publique(valeur: string): boolean {
  const octets = IPV4.exec(valeur)
  if (!octets) return false
  if (octets.slice(1).some((octet) => Number(octet) > 255)) return false
  return !isPrivateIpv4(valeur)
}

// Le résolveur rend la chaîne complète pour un A : si le nom est un CNAME,
// la réponse porte le CNAME *et* le A final. `some` trouve donc l'adresse
// au bout de la chaîne, sans avoir à dérouler les alias nous-mêmes.
const accepteA = (valeurs: string[]) => valeurs.some(estIpv4Publique)

/**
 * La valeur d'un A n'est pas connue d'ici : c'est l'adresse du serveur de
 * l'adoptant. On la nomme au lieu de la citer — c'est la seule des cinq
 * lignes dont la valeur ne se copie pas telle quelle.
 */
const VALEUR_A = "l'adresse IPv4 publique de votre serveur"

/** Resend expédie par Amazon SES : c'est ce que le SPF doit autoriser. */
const VALEUR_SPF = "v=spf1 include:amazonses.com ~all"

/** `p=none` observe sans rejeter — le point de départ, jamais l'arrivée. */
const VALEUR_DMARC = "v=DMARC1; p=none;"

/** Le sélecteur que Resend publie pour ce domaine. */
const SELECTEUR_DKIM = "resend._domainkey"

function controlesSite(hote: string): Controle[] {
  return [
    {
      cle: "site",
      libelle: "Le site public",
      nom: hote,
      type: "A",
      attendu: VALEUR_A,
      accepte: accepteA,
    },
    {
      cle: "admin",
      libelle: "Le tableau de bord",
      nom: `admin.${hote}`,
      type: "A",
      attendu: VALEUR_A,
      accepte: accepteA,
    },
  ]
}

function controlesEmail(hote: string): Controle[] {
  return [
    {
      cle: "spf",
      libelle: "SPF — qui a le droit d'envoyer en votre nom",
      nom: hote,
      type: "TXT",
      attendu: VALEUR_SPF,
      // `some` et pas « la » valeur : un domaine porte souvent plusieurs
      // TXT (jetons de vérification d'un moteur de recherche, d'un
      // fournisseur d'emails). On cherche celui qui est un SPF.
      accepte: (valeurs) =>
        valeurs.some((valeur) => {
          const bas = valeur.toLowerCase()
          return bas.startsWith("v=spf1") && bas.includes("amazonses.com")
        }),
    },
    {
      cle: "dkim",
      libelle: "DKIM — la signature de vos messages",
      nom: `${SELECTEUR_DKIM}.${hote}`,
      type: "TXT",
      attendu: "la clé publique fournie par Resend (elle commence par « p= »)",
      // Deux formes circulent : la clé nue (`p=MIGf…`) et la forme
      // complète (`v=DKIM1; k=rsa; p=MIGf…`). Les deux signent.
      accepte: (valeurs) =>
        valeurs.some((valeur) => {
          const bas = valeur.toLowerCase()
          return bas.startsWith("p=") || bas.startsWith("v=dkim1")
        }),
    },
    {
      cle: "dmarc",
      libelle: "DMARC — ce qu'un serveur doit faire d'un message non signé",
      nom: `_dmarc.${hote}`,
      type: "TXT",
      attendu: VALEUR_DMARC,
      accepte: (valeurs) =>
        valeurs.some((valeur) => valeur.toLowerCase().startsWith("v=dmarc1")),
    },
  ]
}

function instruction(controle: Controle, etat: EtatVerdict): string {
  const enregistrement = `un enregistrement ${controle.type} sur « ${controle.nom} », de valeur : ${controle.attendu}`
  switch (etat) {
    case "ok":
      return `Rien à faire : ${enregistrement} — il est en place.`
    case "manquant":
      return `Créez ${enregistrement}`
    case "different":
      return `« ${controle.nom} » porte déjà un enregistrement ${controle.type}, mais aucun qui convienne. Remplacez sa valeur par : ${controle.attendu}`
    case "indisponible":
      return `Le résolveur DNS n'a pas répondu — réessayez dans un instant, ne créez rien pour l'instant. L'enregistrement attendu reste ${enregistrement}`
  }
}

async function verifier(controles: Controle[]): Promise<Verdict[]> {
  // `Promise.all` : les requêtes sont indépendantes, et les enchaîner
  // ferait attendre l'adoptant cinq fois le délai d'attente quand le
  // résolveur est en panne — c'est précisément le cas où l'écran doit
  // répondre vite pour dire « réessayez ».
  return await Promise.all(
    controles.map(async (controle): Promise<Verdict> => {
      const reponse = await resoudre(controle.nom, controle.type)
      const etat: EtatVerdict =
        reponse.statut === "erreur"
          ? "indisponible"
          : reponse.statut === "absent"
            ? "manquant"
            : controle.accepte(reponse.valeurs)
              ? "ok"
              : "different"
      return {
        cle: controle.cle,
        libelle: controle.libelle,
        attendu: controle.attendu,
        trouve: reponse.statut === "ok" ? reponse.valeurs : [],
        etat,
        instruction: instruction(controle, etat),
      }
    }),
  )
}

/**
 * Le domaine, normalisé — ou un refus, AVANT tout appel sortant.
 *
 * L'ordre compte : valider après le premier `fetch` ferait de ce champ de
 * saisie un moyen de faire émettre des requêtes arbitraires depuis ce
 * déploiement.
 */
function exigerHote(domaine: string): string {
  const hote = normaliserHote(domaine)
  if (hote === null) throw new ConvexError({ code: "INVALID_DOMAIN", field: "domaine" })
  return hote
}

export const checkSite = action({
  args: { domaine: v.string() },
  handler: async (ctx, args): Promise<Verdict[]> => {
    await requireRole(ctx, ["owner", "admin"])
    return await verifier(controlesSite(exigerHote(args.domaine)))
  },
})

export const checkEmail = action({
  args: { domaine: v.string() },
  handler: async (ctx, args): Promise<Verdict[]> => {
    await requireRole(ctx, ["owner", "admin"])
    return await verifier(controlesEmail(exigerHote(args.domaine)))
  },
})

// `exemple.invalid` et non un vrai domaine : `.invalid` est réservé par la
// RFC 2606 pour ne jamais être délégué. La matrice de permissions appelle
// ces deux actions pour de bon, et un domaine réel y ferait partir des
// requêtes vers le résolveur public à chaque exécution de la suite.
MUTATION_REGISTRY.push(
  {
    name: "dns.checkSite",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.action(api.dns.checkSite, { domaine: "exemple.invalid" }),
  },
  {
    name: "dns.checkEmail",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.action(api.dns.checkEmail, { domaine: "exemple.invalid" }),
  },
)
