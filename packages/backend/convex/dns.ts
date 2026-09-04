import { ConvexError, v } from "convex/values"
import { action, query } from "./_generated/server"
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
// ses emails arrivent (SPF, DKIM, DMARC).
//
// DEUX QUESTIONS, ET NON UNE. « Qu'est-ce qu'il faut créer ? » ne dépend
// que du domaine déclaré : `_dmarc.exemple.fr`, un TXT, telle valeur — ça
// s'écrit sans demander l'avis de personne. « Qu'est-ce qui est déjà en
// place ? » demande le réseau. Les fondre en une seule réponse faisait
// naître la liste des enregistrements du bouton « Vérifier » : personne ne
// savait quoi créer avant d'avoir lancé une lecture DNS qui ne le disait
// pas mieux. D'où `plan` (une query, instantanée) d'un côté, `checkSite` et
// `checkEmail` (des actions, lentes) de l'autre.
//
// Des `action` et non des `query` pour les deux vérifications : elles font
// des appels sortants, ce qu'une query Convex ne peut pas. La distinction
// n'est pas qu'une signature — une query est réactive et repartirait vers
// le résolveur à chaque tick d'abonnement, pour une réponse qui met des
// minutes à changer.
//
// `owner`/`admin` pour les trois. Un editor ne configure pas le domaine, et
// chaque vérification déclenche cinq requêtes sortantes depuis une route
// qu'un compte du dashboard peut atteindre : ce n'est pas une lecture
// inoffensive.

/**
 * Cinq états, pas deux — et surtout pas quatre confondus en trois.
 *
 * - `ok` : l'enregistrement est là et convient. Pour un A, cela veut dire
 *   qu'il a été COMPARÉ à l'adresse du serveur, et qu'il y mène.
 * - `forme` : la ligne A est bien une IPv4 publique, et il n'existait
 *   AUCUN serveur de référence à qui la comparer. Elle est plausible ;
 *   elle n'est pas vérifiée. Le seul état que `jugerA` produise seul, et
 *   le seul qui dise « on a regardé, mais pas ce qu'il fallait ».
 * - `manquant` : le nom ne porte pas cet enregistrement. « Créez-le. »
 * - `different` : un enregistrement existe mais ne convient pas.
 *   « Remplacez sa valeur. »
 * - `indisponible` : le résolveur n'a pas répondu. « Réessayez. »
 *
 * `manquant` et `indisponible` doivent rester distincts jusqu'ici :
 * afficher « créez cet enregistrement » quand on n'a simplement pas pu
 * regarder fait créer un doublon chez l'hébergeur de l'adoptant, qu'il
 * devra ensuite diagnostiquer sans savoir d'où il vient.
 *
 * `ok` et `forme` de même, et pour une raison qui n'est apparue qu'après
 * coup. L'écran arme le bouton d'enregistrement sur les deux — il le
 * doit, sinon un déploiement sans serveur de référence n'aurait aucune
 * issue —, mais il ne doit pas les AFFICHER pareil : les fondre en un
 * seul « A en place » vert promet une comparaison qui n'a pas eu lieu.
 * Le raisonnement entier est dans `jugerA`.
 */
export type EtatVerdict = "ok" | "forme" | "manquant" | "different" | "indisponible"

/**
 * Un enregistrement à créer chez l'hébergeur — connu sans rien résoudre.
 *
 * `type`, `nom` et `attendu` sont TROIS CHAMPS et non une phrase. Un
 * formulaire de zone DNS demande ces trois valeurs, dans cet ordre, et
 * l'écran les met en colonnes. Ils vivaient jusqu'ici fondus dans une
 * `instruction` composée ici (« Créez un enregistrement TXT sur “…”, de
 * valeur : … ») : l'écran ne pouvait alors ni la découper en colonnes sans
 * expression régulière, ni recalculer les mêmes noms de son côté sans
 * dupliquer `controlesSite` / `controlesEmail`. La phrase a donc été
 * retirée au profit des champs qu'elle contenait — rien d'autre ne la
 * lisait.
 */
export type Enregistrement = {
  /** Stable, pour que l'écran s'y accroche : `site`, `admin`, `spf`, … */
  cle: string
  /** À quoi sert cette ligne, en clair. L'écran en fait une infobulle. */
  libelle: string
  /** `A`, `TXT`, … — la première colonne de tout formulaire de zone. */
  type: TypeDns
  /** L'hôte complet à créer : `_dmarc.exemple.fr`, jamais `_dmarc` seul. */
  nom: string
  /** La valeur à saisir chez l'hébergeur, mot pour mot quand elle est connue. */
  attendu: string
}

/** L'enregistrement, plus ce que le résolveur en dit aujourd'hui. */
export type Verdict = Enregistrement & {
  /** Ce que le résolveur a rendu — vide si absent ou indisponible. */
  trouve: string[]
  etat: EtatVerdict
  /** Pourquoi le lookup a échoué ou pourquoi le nom est absent (NXDOMAIN). */
  raison?: string
}

/**
 * Ce qu'un contrôle conclut de valeurs RÉELLEMENT trouvées.
 *
 * `manquant` n'en fait pas partie, et c'est le point : il se décide avant
 * d'appeler le contrôle, parce que le résolveur l'a dit. Ce type dit les
 * trois issues qui restent une fois qu'il y a quelque chose à regarder —
 * dont `indisponible`, qui n'est pas « c'est faux » mais « on n'a pas pu
 * savoir ». La confusion de ces deux-là est exactement le défaut que ce
 * module existe pour éviter, et un `boolean` la rendait inévitable.
 */
type Jugement = Exclude<EtatVerdict, "manquant">

type Controle = Enregistrement & {
  /** Ce que les valeurs trouvées valent, une fois regardées. */
  juger: (valeurs: string[]) => Jugement
}

/**
 * Un prédicat, dans la forme d'un jugement.
 *
 * Pour les quatre contrôles qui n'ont que deux issues : la valeur convient
 * ou elle ne convient pas. Seul le A a un troisième cas, et il est le seul
 * à écrire son jugement à la main.
 */
function selon(predicat: (valeurs: string[]) => boolean) {
  return (valeurs: string[]): Jugement => (predicat(valeurs) ? "ok" : "different")
}

/**
 * Le contrôle, moins son prédicat.
 *
 * Champ par champ et non `...controle` : `juger` est une fonction, et un
 * spread l'enverrait vers un client qui ne sait pas la porter. La liste
 * explicite oblige aussi à choisir, le jour où `Enregistrement` gagne un
 * champ, s'il doit sortir d'ici.
 */
function enregistrementDe(controle: Controle): Enregistrement {
  return {
    cle: controle.cle,
    libelle: controle.libelle,
    type: controle.type,
    nom: controle.nom,
    attendu: controle.attendu,
  }
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

// ---------------------------------------------------------------------
// UNE IP PUBLIQUE N'EST PAS *NOTRE* IP — et c'est le seul cas qui compte.
//
// Vérifier la FORME d'un A (« est-ce une IPv4 publique ? ») laisse passer
// le mode d'échec le plus rapporté sur Traefik + Let's Encrypt : un
// domaine parqué chez le registrar, resté chez l'ancien hébergeur, ou
// derrière Cloudflare en mode proxy rend une IP publique parfaitement
// valide. L'étiquette passait au vert, le bouton d'enregistrement
// s'armait, Traefik demandait un certificat, le challenge HTTP-01 était
// servi par le proxy et échouait — et chaque échec compte dans le quota de
// cinq par domaine et par semaine, que ce verrou existe précisément pour
// protéger. `docker/README.md` §3 note qu'un VPS Hostinger est souvent
// livré avec son DNS chez Cloudflare : c'est le cas ATTENDU, pas un cas
// limite.
//
// L'ADRESSE DE RÉFÉRENCE NE VIENT PAS DU LOOKUP. Interroger le domaine
// déclaré pour savoir « quelle IP on attend », puis comparer ce lookup à
// lui-même, est une tautologie : illith.com rend 198.x, on affiche 198.x,
// on coche Connecté — y compris depuis un Mac en localhost. L'attendu
// vient d'une IP connue (`VPS_IP4` dans l'environnement Convex), ou des
// origines locales (`localhost:4321` / `:3001`). Jamais du DNS public.
//
// CE RAISONNEMENT SUPPOSE UN DÉPLOIEMENT EN ACCÈS DIRECT, et il faut le
// dire, parce que le dépôt propose lui-même la configuration qui le met
// en défaut. `docker/README.md` §3 offre le challenge DNS-01 comme remède
// au proxy — il ne dépend pas du routage HTTP, donc les certificats
// s'émettent avec le nuage orange allumé. Un déploiement qui a pris ce
// remède est LUI-MÊME derrière le proxy : l'hôte courant résout vers les
// adresses anycast de Cloudflare, la référence vaut ces adresses-là, et
// un nouveau domaine posé sur une AUTRE zone — donc d'autres anycast, ou
// l'IP nue du VPS — est jugé `different` alors que sa configuration est
// juste. Rien ne le débloque depuis l'écran, et l'étiquette « A à poser »
// envoie corriger ce qui n'est pas cassé.
//
// C'est un échec FERMÉ, donc la bonne direction : le verrou refuse plutôt
// qu'il n'ouvre, et rien ne part brûler le quota Let's Encrypt. Mais
// c'est une impasse, et elle n'est écrite qu'ici. La sortie serait de
// comparer autre chose que des adresses — demander à l'hôte visé s'il est
// bien CE déploiement, ce qui suppose un point de terminaison identifié
// et un secret partagé de plus. Personne n'en a eu besoin ; le jour où
// quelqu'un signale ce cas, c'est là qu'il faut chercher, pas dans
// `estIpv4Publique`.
// ---------------------------------------------------------------------

/**
 * L'adresse du serveur que CET environnement connaît — jamais le résultat
 * du lookup qu'on est en train de juger.
 *
 * - `connue` : `VPS_IP4` est posée et publique. C'est à elle qu'un A doit
 *   mener. Connecté = le DNS public (Cloudflare DoH) égale cette IP.
 * - `aucune` : pas d'IP connue. En local on affiche localhost:port ; en
 *   prod on n'invente rien. Dans les deux cas le lookup ne devient pas
 *   l'attendu, et le verdict n'est pas `ok`.
 */
export type ReferenceServeur =
  | { etat: "connue"; adresses: string[] }
  | { etat: "aucune" }

/**
 * L'IPv4 publique posée sur le déploiement Convex, ou `null`.
 *
 * `VPS_IP4` est l'adresse du VPS (runbook, `convex env set`). Une valeur
 * privée ou malformée est ignorée : s'en servir validerait n'importe
 * quoi, et une IPv4 privée ne rend pas le site joignable depuis dehors.
 */
function lireVpsIp4(): string | null {
  const brute = process.env.VPS_IP4?.trim() ?? ""
  if (brute === "") return null
  return estIpv4Publique(brute) ? brute : null
}

/** La référence de CET environnement — sync, aucun appel réseau. */
function referenceDepuisEnv(): ReferenceServeur {
  const ip = lireVpsIp4()
  if (ip !== null) return { etat: "connue", adresses: [ip] }
  return { etat: "aucune" }
}

/**
 * Le jugement d'une ligne A, face à l'adresse de référence.
 *
 * Le résolveur rend la chaîne complète pour un A : si le nom est un CNAME,
 * la réponse porte le CNAME *et* le A final. Le filtre trouve donc
 * l'adresse au bout de la chaîne, sans avoir à dérouler les alias
 * nous-mêmes.
 *
 * Une valeur qui n'est même pas une IPv4 publique est `different` quelle
 * que soit la référence : un A vers `192.168.1.10` — l'erreur fréquente
 * derrière un routeur domestique — ne mène nulle part depuis l'extérieur,
 * et ça se sait sans rien comparer.
 *
 * Ensuite, et seulement ensuite, la référence décide :
 *
 * - `connue` : l'adresse doit être `VPS_IP4`. C'est tout l'objet du verrou.
 * - `aucune` : pas d'IP connue. En local (origines en boucle) un A public
 *   ne peut pas être CET environnement — `different`, pas `ok`. En prod
 *   sans `VPS_IP4`, on ne compare pas le lookup à lui-même : `forme`,
 *   que l'écran affiche comme Non connecté.
 */
function jugerA(reference: ReferenceServeur) {
  return (valeurs: string[]): Jugement => {
    const publiques = valeurs.filter(estIpv4Publique)
    if (publiques.length === 0) return "different"
    switch (reference.etat) {
      case "connue":
        return publiques.some((adresse) => reference.adresses.includes(adresse))
          ? "ok"
          : "different"
      case "aucune":
        // Localhost n'est pas 198.x : le DNS public d'illith.com ne peint
        // pas du vert sur un `pnpm dev`.
        return originesLocales() !== null ? "different" : "forme"
    }
  }
}

const BOUCLE_LOCALE = new Set(["localhost", "127.0.0.1"])

/** Ports documentés de `pnpm dev` / `docker-compose.local.yml`. */
const WEB_LOCAL = "localhost:4321"
const ADMIN_LOCAL = "localhost:3001"

/**
 * L'hôte:port d'une origine de boucle, ou `null`.
 *
 * Sert à remplir la colonne Valeur en local : on n'invente pas une IPv4
 * de production, on affiche ce que le navigateur joint vraiment.
 */
function hoteLocalDepuis(url: string | undefined): string | null {
  if (url === undefined || url.trim() === "") return null
  try {
    const parsed = new URL(url)
    if (!BOUCLE_LOCALE.has(parsed.hostname)) return null
    return parsed.port === "" ? parsed.hostname : `${parsed.hostname}:${parsed.port}`
  } catch {
    return null
  }
}

function originesLocales(): { web: string; admin: string } | null {
  const web = hoteLocalDepuis(process.env.WEB_SITE_URL)
  const admin = hoteLocalDepuis(process.env.SITE_URL)
  if (web === null && admin === null) return null
  return { web: web ?? WEB_LOCAL, admin: admin ?? ADMIN_LOCAL }
}

/**
 * La valeur à coller pour un A — une adresse, jamais une phrase.
 *
 * - `VPS_IP4` connue : cette IPv4 ;
 * - origines Convex en boucle : `localhost:4321` / `localhost:3001` ;
 * - sinon rien : on n'invente pas une IP, et on ne recopie pas le lookup.
 */
function valeurEnregistrementA(
  cle: "site" | "admin" | "umami",
  reference: ReferenceServeur,
): string {
  if (reference.etat === "connue") return reference.adresses[0] ?? ""
  const local = originesLocales()
  if (local === null) return ""
  return cle === "admin" ? local.admin : local.web
}

/**
 * L'hôte Umami à poser chez le registrar, ou `null`.
 *
 * `routing.deriverHotes` publie `stats.<déclaré>` dès que `UMAMI_DOMAIN`
 * est posé. En local il vaut `localhost` (compose sur :3002) : pas de
 * ligne DNS, le tableau de bord n'est pas sur l'internet public.
 */
function hoteUmamiDuPlan(domaine: string): string | null {
  const brut = process.env.UMAMI_DOMAIN
  if (brut === undefined || brut.trim() === "") return null
  const nu = brut.trim().toLowerCase().split(":")[0] ?? ""
  if (BOUCLE_LOCALE.has(nu)) return null
  if (normaliserHote(brut) === null) return null
  return `stats.${domaine}`
}

/** Resend expédie par Amazon SES : c'est ce que le SPF doit autoriser. */
const VALEUR_SPF = "v=spf1 include:amazonses.com ~all"

/** `p=none` observe sans rejeter — le point de départ, jamais l'arrivée. */
const VALEUR_DMARC = "v=DMARC1; p=none;"

/** Le sélecteur que Resend publie pour ce domaine. */
const SELECTEUR_DKIM = "resend._domainkey"

/**
 * @param reference l'adresse du serveur. `aucune` par défaut, pour `plan`
 * seul : c'est une query, elle ne résout rien, et elle ne lit de ces
 * contrôles que `type`, `nom` et `attendu` — jamais leur jugement.
 */
function controlesSite(
  hote: string,
  reference: ReferenceServeur = { etat: "aucune" },
): Controle[] {
  const juger = jugerA(reference)
  const lignes: Controle[] = [
    {
      cle: "site",
      libelle: "Le site public",
      nom: hote,
      type: "A",
      attendu: valeurEnregistrementA("site", reference),
      juger,
    },
    {
      cle: "admin",
      libelle: "Le tableau de bord",
      nom: `admin.${hote}`,
      type: "A",
      attendu: valeurEnregistrementA("admin", reference),
      juger,
    },
  ]
  const umami = hoteUmamiDuPlan(hote)
  if (umami !== null) {
    lignes.push({
      cle: "umami",
      libelle: "Les statistiques (Umami)",
      nom: umami,
      type: "A",
      attendu: valeurEnregistrementA("umami", reference),
      juger,
    })
  }
  return lignes
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
      juger: selon((valeurs) =>
        valeurs.some((valeur) => {
          const bas = valeur.toLowerCase()
          return bas.startsWith("v=spf1") && bas.includes("amazonses.com")
        }),
      ),
    },
    {
      cle: "dkim",
      libelle: "DKIM — la signature de vos messages",
      nom: `${SELECTEUR_DKIM}.${hote}`,
      type: "TXT",
      attendu: "la clé publique fournie par Resend (elle commence par « p= »)",
      // Deux formes circulent : la clé nue (`p=MIGf…`) et la forme
      // complète (`v=DKIM1; k=rsa; p=MIGf…`). Les deux signent.
      juger: selon((valeurs) =>
        valeurs.some((valeur) => {
          const bas = valeur.toLowerCase()
          return bas.startsWith("p=") || bas.startsWith("v=dkim1")
        }),
      ),
    },
    {
      cle: "dmarc",
      libelle: "DMARC — ce qu'un serveur doit faire d'un message non signé",
      nom: `_dmarc.${hote}`,
      type: "TXT",
      attendu: VALEUR_DMARC,
      juger: selon((valeurs) =>
        valeurs.some((valeur) => valeur.toLowerCase().startsWith("v=dmarc1")),
      ),
    },
  ]
}

async function verifier(controles: Controle[]): Promise<Verdict[]> {
  // `Promise.all` : les requêtes sont indépendantes, et les enchaîner
  // ferait attendre l'adoptant cinq fois le délai d'attente quand le
  // résolveur est en panne — c'est précisément le cas où l'écran doit
  // répondre vite pour dire « réessayez ».
  return await Promise.all(
    controles.map(async (controle): Promise<Verdict> => {
      const reponse = await resoudre(controle.nom, controle.type)
      if (reponse.statut === "erreur") {
        return {
          ...enregistrementDe(controle),
          trouve: [],
          etat: "indisponible",
          raison: reponse.raison,
        }
      }
      if (reponse.statut === "absent") {
        return {
          ...enregistrementDe(controle),
          trouve: [],
          etat: "manquant",
          ...(reponse.nxdomain ? { raison: "NXDOMAIN" } : {}),
        }
      }
      return {
        ...enregistrementDe(controle),
        trouve: reponse.valeurs,
        etat: controle.juger(reponse.valeurs),
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

/**
 * Ce qu'il faut créer, sans avoir rien vérifié.
 *
 * Le seul endroit d'où l'écran tire ses lignes tant que la vérification
 * n'a pas répondu — et elle peut ne jamais répondre. Les deux groupes
 * ensemble plutôt qu'une query chacun : ils s'affichent toujours l'un
 * sous l'autre, et deux abonnements pour un seul argument coûteraient
 * deux allers-retours pour la même réponse.
 *
 * Le domaine reçu est celui qu'a déjà normalisé `settings.update`, qui
 * refuse tout le reste par `INVALID_DOMAIN` : `exigerHote` est ici une
 * redite volontaire, pas le chemin normal.
 */
export const plan = query({
  args: { domaine: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ site: Enregistrement[]; email: Enregistrement[] }> => {
    await requireRole(ctx, ["owner", "admin"])
    const hote = exigerHote(args.domaine)
    return {
      site: controlesSite(hote, referenceDepuisEnv()).map(enregistrementDe),
      email: controlesEmail(hote).map(enregistrementDe),
    }
  },
})

export const checkSite = action({
  args: { domaine: v.string() },
  handler: async (ctx, args): Promise<Verdict[]> => {
    await requireRole(ctx, ["owner", "admin"])
    const hote = exigerHote(args.domaine)
    // La référence vient de `VPS_IP4` / des origines locales — pas d'un
    // lookup du domaine déclaré (ce lookup est ce qu'on JUGE, plus bas).
    return await verifier(controlesSite(hote, referenceDepuisEnv()))
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
