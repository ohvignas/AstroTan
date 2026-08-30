import { ConvexError, v } from "convex/values"
import { action, internalQuery, query } from "./_generated/server"
import { api, internal } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { requireRole } from "./lib/authz"
import { resoudre, type TypeDns } from "./lib/doh"
import { normaliserHote } from "./lib/hoteNu"
import { isPrivateIpv4 } from "./lib/webhookUrl"
import { deriverHotes } from "./routing"

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
// L'ADRESSE DE RÉFÉRENCE NE SE DEMANDE À PERSONNE. Le déploiement la
// connaît déjà : c'est celle vers laquelle pointe l'hôte web COURANT,
// celui que Traefik sert en ce moment (`routing.deriverHotes` — le domaine
// déclaré, sinon `WEB_DOMAIN`). On la résout une fois, et on COMPARE, au
// lieu de vérifier une forme.
//
// Aucun réglage, aucune saisie : une adresse de référence configurable
// serait une valeur d'opérateur qu'il suffirait de mettre au bon chiffre
// pour désarmer le verrou — un verrou qu'on peut ouvrir soi-même n'en est
// pas un.
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
 * L'adresse du serveur, telle que le DNS la donne aujourd'hui — ou la
 * raison pour laquelle on ne la connaît pas.
 *
 * Trois cas et non deux, pour la même raison que `EtatVerdict` en tient
 * quatre :
 *
 * - `connue` : l'hôte courant résout vers une ou plusieurs IPv4 publiques.
 *   C'est à elles qu'un A doit mener.
 * - `aucune` : il n'y a pas d'hôte courant à interroger — ni domaine
 *   déclaré, ni `WEB_DOMAIN` dans l'environnement CONVEX. C'est un état
 *   ordinaire, pas une panne, et il n'est PAS réservé au premier jour :
 *   `.github/workflows/deploy.yml` ne pose aucune variable Convex, si
 *   bien qu'un adoptant qui suit le dépôt y reste tant qu'il n'a pas
 *   lancé les `convex env set` à la main (`docker/README.md` §6).
 *   Voir `jugerA`, qui en tire la seule conclusion honnête.
 * - `indisponible` : il y a un hôte courant, et le résolveur n'a rien
 *   rendu d'exploitable pour lui. On ne sait pas, et on le dit.
 */
export type ReferenceServeur =
  | { etat: "connue"; adresses: string[] }
  | { etat: "aucune" }
  | { etat: "indisponible" }

/**
 * L'hôte web que Traefik sert en ce moment, s'il y en a un.
 *
 * `internalQuery` : une action ne lit pas la base directement, et cette
 * lecture n'a aucune raison d'être atteignable depuis un client. Elle ne
 * rend qu'un hôte — jamais la ligne `settings`, dont `settings.get` est
 * publique (invariant 1).
 *
 * `deriverHotes` et non une seconde règle écrite ici : c'est elle qui
 * décide déjà, pour Traefik, quel hôte est le courant. Deux dérivations
 * divergeraient, et le jour où elles divergent le verrou compare à un
 * serveur qui n'est pas celui qui sert.
 */
export const hoteCourant = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const settings = await ctx.db.query("settings").first()
    try {
      return deriverHotes(settings?.declaredDomain).web
    } catch {
      // `NOT_CONFIGURED` : ni domaine déclaré, ni `WEB_DOMAIN`. Un premier
      // déploiement, pas une erreur — et c'est `deriverHotes` qui porte
      // cette décision, pas nous.
      return null
    }
  },
})

/**
 * L'adresse de référence, résolue une fois pour les deux lignes A.
 *
 * Une seule requête sortante de plus par vérification, partagée par
 * `exemple.fr` et `admin.exemple.fr` : les deux doivent mener au même
 * serveur, et Traefik demande un certificat pour chacune.
 *
 * Le filtre `estIpv4Publique` retire le CNAME que le résolveur rend au
 * milieu d'une chaîne, et refuse de prendre pour référence une adresse
 * privée : un déploiement dont l'hôte courant pointe vers `10.x` ne peut
 * servir de référence à rien, et s'en servir validerait n'importe quoi.
 */
async function referenceServeur(courant: string | null): Promise<ReferenceServeur> {
  if (courant === null) return { etat: "aucune" }
  const reponse = await resoudre(courant, "A")
  if (reponse.statut !== "ok") return { etat: "indisponible" }
  const adresses = reponse.valeurs.filter(estIpv4Publique)
  return adresses.length === 0 ? { etat: "indisponible" } : { etat: "connue", adresses }
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
 * - `connue` : l'adresse doit être celle-là. C'est tout l'objet du verrou.
 * - `aucune` : il n'existe aucun hôte courant, donc rien à quoi comparer
 *   — et refuser ici enfermerait dans un écran où le premier domaine ne
 *   peut jamais être enregistré. On retombe sur le contrôle de forme, qui
 *   est ce qu'on sait dire de vrai à ce moment-là, et on le DIT :
 *   `forme`, pas `ok`.
 *
 *   Cette distinction est le point le plus coûteux du module, et elle
 *   n'existe que parce que deux correctifs se sont rencontrés. Tant que
 *   l'absence d'hôte courant valait 404 sur cet écran, l'état était mort
 *   — inatteignable, donc sans conséquence. Depuis que le routage de
 *   secours fait tenir le site debout sans variable Convex
 *   (`services/routeur`, issue `routage-de-secours`), l'écran est
 *   atteignable DANS cet état : le verrou y est dégradé au contrôle de
 *   forme, et un adoptant derrière Cloudflare — l'IP publique du proxy —
 *   arme le bouton. C'est exactement le cas que ce verrou existe pour
 *   fermer, et le rendre `ok` le rendait invisible.
 *
 *   On ne referme pas le verrou pour autant : ce serait échanger une
 *   panne rare contre une impasse certaine pour tout déploiement neuf.
 *   On rend l'état visible, et l'écran écrit qu'il n'y a pas de serveur
 *   de référence (`etatDesA`, `routes/_authed/settings/domaine.tsx`).
 * - `indisponible` : un hôte courant existe et n'a pas répondu. Ni « en
 *   place » ni « à créer » : « le résolveur n'a pas répondu ». Le verrou
 *   reste fermé, l'écran dit « A non lu », et réessayer est la bonne
 *   conduite. Rendre `ok` ici rouvrirait le trou à chaque hoquet du
 *   résolveur, ce qui en ferait un trou permanent pour qui insiste.
 *
 * Le cas où l'hôte vérifié EST l'hôte courant se juge tout seul : les deux
 * résolutions portent sur le même nom, rendent les mêmes adresses, et le
 * verdict est `ok`. C'est juste — c'est le domaine qui sert déjà, et son
 * certificat est déjà émis.
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
        return "forme"
      case "indisponible":
        return "indisponible"
    }
  }
}

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
  return [
    {
      cle: "site",
      libelle: "Le site public",
      nom: hote,
      type: "A",
      attendu: VALEUR_A,
      juger,
    },
    {
      cle: "admin",
      libelle: "Le tableau de bord",
      nom: `admin.${hote}`,
      type: "A",
      attendu: VALEUR_A,
      juger,
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
      const etat: EtatVerdict =
        reponse.statut === "erreur"
          ? "indisponible"
          : reponse.statut === "absent"
            ? "manquant"
            : controle.juger(reponse.valeurs)
      return {
        ...enregistrementDe(controle),
        trouve: reponse.statut === "ok" ? reponse.valeurs : [],
        etat,
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
      site: controlesSite(hote).map(enregistrementDe),
      email: controlesEmail(hote).map(enregistrementDe),
    }
  },
})

export const checkSite = action({
  args: { domaine: v.string() },
  handler: async (ctx, args): Promise<Verdict[]> => {
    await requireRole(ctx, ["owner", "admin"])
    const hote = exigerHote(args.domaine)
    // L'ordre compte : la référence AVANT les deux lignes, parce que les
    // deux la partagent. Trois requêtes sortantes au total, pas quatre.
    const courant: string | null = await ctx.runQuery(internal.dns.hoteCourant, {})
    return await verifier(controlesSite(hote, await referenceServeur(courant)))
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
