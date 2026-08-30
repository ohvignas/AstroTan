import { ConvexError, v } from "convex/values"
import { action, internalMutation } from "./_generated/server"
import { api, internal } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { journaliser } from "./lib/auditEvent"
import { requireRole } from "./lib/authz"
import { lireSecret } from "./secrets"
import type { Enregistrement } from "./dns"
import type { TypeDns } from "./lib/doh"
import { normaliserHote } from "./lib/hoteNu"

// ---------------------------------------------------------------------
// Déclarer le domaine d'expédition chez Resend, depuis le tableau de bord.
//
// CE QUE ÇA SUPPRIME. Changer de domaine dans l'administration ne suffisait
// pas : tant que le domaine n'est pas déclaré ET vérifié chez Resend, Resend
// REFUSE les envois — un domaine d'expédition non vérifié ne part pas. Il
// fallait donc aller le déclarer à la main dans le tableau de bord Resend,
// puis recopier les enregistrements DNS qu'il affiche. C'est l'un des cinq
// gestes manuels qu'on retire un par un.
//
// CE QUE ÇA NE FAIT PAS. Ça ne crée aucun enregistrement DNS : personne ici
// n'a accès à la zone de l'adoptant. Ça rend la LISTE de ce qu'il doit
// créer, dans la forme exacte que le tableau de `/settings/domaine`
// consomme déjà (`Enregistrement`, celui que `dns.plan` rend) — pour que
// les lignes de Resend prennent leur place dans ce tableau, à côté de SPF,
// DKIM et DMARC, et non dans un second écran que personne n'irait voir.
//
// LIRE ET ÉCRIRE SONT DEUX FONCTIONS, ET C'EST LE POINT. Déclarer un
// domaine est une écriture chez un tiers, sous le compte de l'adoptant.
// Elle a longtemps vécu dans la MÊME action que la lecture : `declarer`
// listait, et postait si le domaine manquait. L'écran appelait cette
// action à son montage — si bien que le seul AFFICHAGE de `/settings/
// domaine` créait un domaine chez Resend, sans qu'aucun clic ne l'ait
// demandé. Le commentaire d'alors le savait sans le voir : il justifiait
// l'absence de journal d'audit par « une seconde ligne à chaque ouverture
// de l'écran noierait la première ».
//
// D'où deux actions :
//
//   • `etat` — LIT, et seulement. `GET /domains`, puis `GET /domains/{id}`
//     si le domaine y est. Rend `absent` quand il n'y est pas, et n'écrit
//     rien pour autant. C'est ce que l'ouverture de l'écran appelle.
//   • `declarer` — ÉCRIT. `POST /domains`. Elle n'existe qu'au bout d'un
//     geste explicite de l'adoptant, et elle est journalisée.
//
// Le cas le plus fréquent reste la deuxième visite, où le domaine est déjà
// déclaré : `declarer` liste donc toujours avant de poster, et ne poste
// que si le domaine manque. Une action qui échouerait sur un domaine déjà
// présent serait inutilisable dès qu'on la relance.
//
// ET ÉCRIRE QUAND MÊME SANS RIEN CASSER. Entre la lecture et l'écriture, le
// domaine peut apparaître (un autre onglet, un collègue, le tableau de bord
// Resend). Resend répond alors 403 `validation_error`, « The `x` domain has
// been registered already. » — c'est un SUCCÈS ici, pas une panne : on
// relit et on rend les mêmes lignes. Les deux mesures ensemble font qu'un
// appel répété ne crée jamais un second domaine et rend toujours la même
// chose.
//
// LA CLÉ VIENT DE `lireSecret`, JAMAIS DE `process.env`. C'est le défaut
// corrigé sur `leads.ts` : la garde y lisait l'environnement pendant que
// `makeResend` lisait la base, si bien qu'une clé saisie à l'écran envoyait
// les invitations mais pas les notifications. `secrets.ts` porte la
// précédence à un seul endroit, et c'est sa raison d'être.
//
// Sources : la référence Resend — `/docs/api-reference/domains/create-domain`,
// `/list-domains`, `/get-domain` et `/docs/api-reference/errors` (d'où vient
// la ligne « 403 validation_error : The `example.com` domain has been
// registered already. »).
// ---------------------------------------------------------------------

/** 8 s, la même borne que les sept autres appels sortants du dépôt. */
const DELAI_MS = 8_000

const API = "https://api.resend.com"

/**
 * Ce que l'écran reçoit.
 *
 * Sept issues et non deux, pour la même raison que `dns.ts` en distingue
 * quatre : « le service a dit non » et « le service n'a pas répondu » ne se
 * réparent pas de la même façon, et afficher l'un pour l'autre envoie
 * l'adoptant chercher au mauvais endroit.
 */
export type ResultatResend =
  | {
      etat: "ok"
      /** Le domaine existait déjà chez Resend — rien n'a été écrit. */
      dejaDeclare: boolean
      /** Le statut de vérification tel que Resend le nomme (`pending`, `verified`, …). */
      statut: string
      /** Les lignes à créer, dans la forme du tableau de `/settings/domaine`. */
      enregistrements: Enregistrement[]
      /** Lignes rendues par Resend qu'on n'a pas su typer — voir `versEnregistrement`. */
      ignores: number
    }
  /**
   * Le domaine n'est pas déclaré chez Resend — et rien n'a été écrit pour
   * le constater.
   *
   * L'issue que `etat` rend et que `declarer` ne rend jamais : c'est la
   * frontière entre lire et écrire, dans le type. L'écran en fait une
   * étiquette rouge et propose l'action qui la ferme.
   */
  | { etat: "absent" }
  /** Aucune clé Resend n'est configurée : rien à tenter, et on n'a rien tenté. */
  | { etat: "sans_cle" }
  /** La clé existe et n'a que le droit d'envoyer : elle ne peut pas déclarer. */
  | { etat: "cle_restreinte" }
  /** Resend a jugé la requête et l'a refusée. */
  | { etat: "refuse" }
  /** Resend dit le domaine déjà déclaré, mais cette clé ne le voit pas. */
  | { etat: "introuvable" }
  /** Resend n'a pas répondu, ou a répondu qu'il ne pouvait pas répondre. */
  | { etat: "injoignable" }

/**
 * Les types que `Enregistrement.type` sait porter.
 *
 * `satisfies` plutôt qu'une annotation : la liste garde ses littéraux (donc
 * `find` rend `TypeDns | undefined` sans cast) tout en échouant au
 * typecheck si `TypeDns` perd un de ces cinq noms.
 */
const TYPES_DNS = ["A", "AAAA", "TXT", "CNAME", "MX"] as const satisfies readonly TypeDns[]

/** Ce que Resend met dans `records[]`, tel qu'on ose le lire. */
type RecordResend = {
  record?: unknown
  name?: unknown
  type?: unknown
  value?: unknown
  priority?: unknown
}

/**
 * L'échec, distingué de la panne — la même partition que `secretCheck.ts`.
 *
 * `Panne` couvre tout ce qui n'est pas un jugement du service : le réseau,
 * notre propre `AbortSignal.timeout`, un 429, un 5xx. Une clé n'y est
 * jamais mise en cause.
 */
type Echec = { etat: "cle_restreinte" | "refuse" | "injoignable" }

class ErreurResend extends Error {
  constructor(readonly issue: Echec["etat"]) {
    super(issue)
  }
}

/**
 * Le `message` du corps d'erreur, quand il y en a un.
 *
 * Lu, jamais rendu à l'écran. Il sert ici à une seule décision — « ce
 * domaine est-il déjà déclaré ? » — et la décision seule sort. Recopier
 * « The `x` domain has been registered already. » dans l'interface
 * n'apprendrait rien à qui ne lit pas l'anglais de l'API Resend.
 */
type CorpsErreur = { name: string | null; message: string | null }

async function lireErreur(reponse: Response): Promise<CorpsErreur> {
  try {
    const corps: unknown = await reponse.json()
    const objet = corps as { name?: unknown; message?: unknown } | null
    return {
      name: typeof objet?.name === "string" ? objet.name : null,
      message: typeof objet?.message === "string" ? objet.message : null,
    }
  } catch {
    // Corps vide ou non-JSON : ce n'est pas une panne, simplement une
    // erreur qu'on ne saura pas qualifier plus finement que son statut.
    return { name: null, message: null }
  }
}

/**
 * Un appel à l'API Resend, borné dans le temps, avec ses refus déjà triés.
 *
 * Rend le corps JSON en cas de succès, et lève une `ErreurResend` sinon —
 * de sorte que l'enchaînement plus bas se lise comme la suite d'appels
 * qu'il est, sans un `if` de gestion d'erreur entre chaque ligne.
 *
 * `tolerer` laisse un appelant récupérer un refus qu'il sait interpréter :
 * c'est ce qui permet de traiter « déjà déclaré » comme un succès sans que
 * cette fonction ait à connaître ce cas particulier.
 */
async function appeler(
  cle: string,
  chemin: string,
  init: { method: string; body?: unknown },
  tolerer?: (statut: number, corps: CorpsErreur) => boolean,
): Promise<{ ok: true; corps: unknown } | { ok: false; corps: CorpsErreur }> {
  let reponse: Response
  try {
    reponse = await fetch(`${API}${chemin}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${cle}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      // La même borne que partout ailleurs. Sans elle, une réponse qui ne
      // vient jamais tient l'action jusqu'au délai d'exécution de Convex,
      // et l'écran ne dit rien pendant ce temps-là.
      signal: AbortSignal.timeout(DELAI_MS),
    })
  } catch {
    // Panne réseau, DNS, ou notre propre expiration : le service n'a rien
    // jugé. Le dire, plutôt que de compter une panne Resend comme une
    // faute de l'opérateur.
    throw new ErreurResend("injoignable")
  }

  if (reponse.ok) {
    try {
      return { ok: true, corps: await reponse.json() }
    } catch {
      // 200 avec un corps illisible : le service a répondu, mais pas ce
      // qu'on lui demandait. Ni un refus de la clé, ni une décision.
      throw new ErreurResend("injoignable")
    }
  }

  // 429 et 5xx : le service n'a pas jugé la requête. Réessayer plus tard
  // est la bonne conduite, pas régénérer une clé.
  if (reponse.status === 429 || reponse.status >= 500) {
    throw new ErreurResend("injoignable")
  }

  const corps = await lireErreur(reponse)
  if (tolerer?.(reponse.status, corps)) return { ok: false, corps }

  // Une clé « Sending access » s'authentifie très bien — `secretCheck.ts`
  // l'accepte à juste titre, elle envoie les emails. Elle ne peut
  // simplement pas gérer les domaines. Confondre ce refus-là avec « clé
  // invalide » enverrait l'adoptant régénérer une clé qui fonctionne.
  if (corps.name === "restricted_api_key" || corps.name === "invalid_permission") {
    throw new ErreurResend("cle_restreinte")
  }
  throw new ErreurResend("refuse")
}

/** Resend refuse-t-il parce que le domaine est déjà déclaré ? */
function estDejaDeclare(statut: number, corps: CorpsErreur): boolean {
  // Le statut seul ne suffit pas : 403 `validation_error` couvre aussi
  // « domaine non vérifié » et les envois de test. C'est le message qui
  // porte la distinction, et la référence Resend le donne mot pour mot :
  // « The `example.com` domain has been registered already. »
  if (statut !== 400 && statut !== 403) return false
  return (corps.message ?? "").toLowerCase().includes("registered already")
}

/**
 * L'hôte complet à créer, à partir du nom relatif que rend Resend.
 *
 * Resend rend `send` et `resend._domainkey` — relatifs au domaine. Recopiés
 * tels quels dans une zone, la moitié des hébergeurs en font
 * `resend._domainkey.resend._domainkey.exemple.fr`. Le tableau affiche donc
 * le nom complet, comme `dns.plan` le fait déjà pour `_dmarc.exemple.fr`.
 *
 * `@` et la chaîne vide désignent l'apex, et un nom qui porte déjà le
 * domaine est laissé tel quel : Resend rend parfois l'un, parfois l'autre.
 */
function hoteComplet(nom: string, domaine: string): string {
  const nettoye = nom.trim().toLowerCase().replace(/\.$/, "")
  if (nettoye === "" || nettoye === "@") return domaine
  if (nettoye === domaine || nettoye.endsWith(`.${domaine}`)) return nettoye
  return `${nettoye}.${domaine}`
}

/** Le libellé, en clair — l'écran en fait une infobulle, comme dans `dns.ts`. */
const LIBELLES: Record<string, string> = {
  SPF: "SPF — qui a le droit d'envoyer en votre nom (fourni par Resend)",
  DKIM: "DKIM — la signature de vos messages (fournie par Resend)",
  DMARC: "DMARC — ce qu'un serveur doit faire d'un message non signé",
  MX: "MX — la réception des messages",
  Tracking: "Suivi des ouvertures et des clics",
}

/**
 * Une ligne de Resend, dans la forme du tableau — ou `null`.
 *
 * `null` pour un type que `TypeDns` ne porte pas. Les cinq types couvrent
 * tout ce que la référence Resend documente (MX, TXT, CNAME) ; un type
 * hors liste veut dire que l'API a changé. On ne l'invente pas — écrire
 * « TXT » sur une ligne qui n'en est pas ferait créer un enregistrement
 * faux — mais on ne l'efface pas non plus en silence : l'appelant compte
 * les `null` et l'écran peut le dire. Une ligne disparue est un
 * enregistrement que l'adoptant ne créera jamais, et une vérification qui
 * reste rouge sans raison visible.
 */
function versEnregistrement(brut: RecordResend, domaine: string): Enregistrement | null {
  const type = TYPES_DNS.find(
    (connu) => typeof brut.type === "string" && connu === brut.type.trim().toUpperCase(),
  )
  if (type === undefined) return null
  if (typeof brut.value !== "string") return null

  const nom = hoteComplet(typeof brut.name === "string" ? brut.name : "", domaine)
  const famille = typeof brut.record === "string" ? brut.record : ""

  // La priorité entre dans `attendu` faute d'un champ à elle dans
  // `Enregistrement`. Ce n'est pas de l'ornement : un MX se saisit avec sa
  // priorité, et l'omettre fait créer un enregistrement inutilisable.
  // Ajouter un sixième champ à `Enregistrement` toucherait `dns.ts` et le
  // tableau pour une seule ligne sur cinq ; le jour où une deuxième en a
  // besoin, ce sera le bon moment.
  const attendu =
    typeof brut.priority === "number"
      ? `${brut.value} (priorité ${brut.priority})`
      : brut.value

  return {
    // Stable entre deux appels, et distincte à l'intérieur d'une réponse :
    // les deux lignes SPF (un MX et un TXT) partagent le même `name` chez
    // Resend, si bien qu'une clé bâtie sur le seul nom les confondrait — et
    // le tableau, qui s'y accroche, en perdrait une.
    cle: `resend-${nom}-${type.toLowerCase()}`,
    libelle: LIBELLES[famille] ?? "Enregistrement fourni par Resend",
    type,
    nom,
    attendu,
  }
}

/** Le corps d'un domaine Resend, réduit à ce qu'on en lit. */
function lireDomaine(corps: unknown): { id: string; statut: string; records: unknown[] } | null {
  const objet = corps as { id?: unknown; status?: unknown; records?: unknown } | null
  if (typeof objet?.id !== "string") return null
  return {
    id: objet.id,
    statut: typeof objet.status === "string" ? objet.status : "inconnu",
    records: Array.isArray(objet.records) ? objet.records : [],
  }
}

/**
 * L'identifiant du domaine chez Resend, s'il y est déjà.
 *
 * `GET /domains` ne rend PAS les enregistrements — seulement la liste. Il
 * faut donc un second appel sur `/domains/{id}` pour les obtenir, et c'est
 * pourquoi le cas « déjà déclaré » coûte deux lectures plutôt qu'une.
 *
 * `limit=100` : la liste est paginée, et un compte Resend d'adoptant porte
 * une poignée de domaines. Au-delà, le domaine échappe à cette lecture, le
 * POST qui suit se fait refuser par « registered already », et l'action
 * rend `introuvable` — un diagnostic faux mais visible, jamais un doublon.
 */
async function trouverDomaine(cle: string, hote: string): Promise<string | null> {
  const reponse = await appeler(cle, "/domains?limit=100", { method: "GET" })
  if (!reponse.ok) return null
  const corps = reponse.corps as { data?: unknown } | null
  const data = Array.isArray(corps?.data) ? corps.data : []
  for (const brut of data) {
    const objet = brut as { id?: unknown; name?: unknown }
    if (typeof objet.name === "string" && objet.name.toLowerCase() === hote) {
      if (typeof objet.id === "string") return objet.id
    }
  }
  return null
}

/**
 * Le domaine, normalisé — ou un refus, AVANT tout appel sortant.
 *
 * L'ordre est la garde : valider après le premier `fetch` ferait de ce
 * champ de saisie un moyen de faire émettre des requêtes arbitraires
 * depuis ce déploiement. Même mesure, même ordre, même code d'erreur que
 * `dns.exigerHote`.
 */
function exigerHote(domaine: string): string {
  const hote = normaliserHote(domaine)
  if (hote === null) throw new ConvexError({ code: "INVALID_DOMAIN", field: "domaine" })
  return hote
}

/**
 * L'état du domaine d'expédition chez Resend. LIT, et rien d'autre.
 *
 * C'est ce que l'ouverture de `/settings/domaine` appelle. Aucune méthode
 * autre que `GET` ne part d'ici, et `absent` est une réponse — pas une
 * invitation à réparer soi-même en postant. Le seul affichage d'un écran
 * ne doit rien écrire chez un tiers, sous le compte de l'adoptant.
 *
 * `owner`/`admin` comme `declarer` : même clé de déploiement, même appel
 * sortant authentifié, même écran.
 */
export const etat = action({
  args: { domaine: v.string() },
  handler: async (ctx, args): Promise<ResultatResend> => {
    await requireRole(ctx, ["owner", "admin"])
    const hote = exigerHote(args.domaine)
    // `lireSecret` et non `process.env` : LE point de lecture, celui qui
    // porte la précédence environnement-puis-base. Lire l'environnement
    // ici ferait ignorer la clé saisie dans l'administration — un réglage
    // décoratif, exactement le défaut corrigé sur `leads.ts`.
    const cle = await lireSecret(ctx, "RESEND_API_KEY")
    // Réponse ordinaire, pas une panne : un template qui s'installe sans
    // clé Resend ne doit pas avoir l'air cassé. Et surtout : on n'a rien
    // appelé.
    if (cle === null) return { etat: "sans_cle" }
    try {
      const existant = await trouverDomaine(cle, hote)
      // Le point exact où `declarer` posterait. Ici, on le dit.
      if (existant === null) return { etat: "absent" }
      return await relire(cle, existant, hote, true)
    } catch (erreur) {
      if (erreur instanceof ErreurResend) return { etat: erreur.issue }
      throw erreur
    }
  },
})

/**
 * Déclarer le domaine d'expédition, et rendre ce qu'il reste à créer.
 *
 * ÉCRIT chez un tiers. Elle n'est appelée que par un geste explicite de
 * l'adoptant — le bouton « Déclarer … chez Resend » —, jamais par
 * l'affichage d'un écran : c'est `etat` qui répond à l'ouverture.
 *
 * `owner`/`admin`, comme les trois fonctions de `dns.ts` et comme
 * `secrets.set` : cette action fait un appel sortant AUTHENTIFIÉ vers un
 * tiers, avec la clé du déploiement, et peut y écrire. Un editor n'a rien
 * à y faire.
 *
 * JOURNALISÉE, désormais. L'ancienne raison de ne pas le faire — « une
 * seconde ligne à chaque ouverture de l'écran noierait la première » —
 * décrivait le défaut, pas une décision : elle tenait à un déclenchement
 * qui ne devait pas exister. Une écriture chez un tiers, sous le compte de
 * l'adoptant, faite exprès par quelqu'un, est exactement ce que
 * `lib/auditEvent.ts` existe pour retenir — et c'est la seule de ce lot
 * qui sorte du déploiement. La ligne ne s'écrit que si le domaine a
 * RÉELLEMENT été créé : un domaine déjà présent n'est pas un geste.
 */
export const declarer = action({
  args: { domaine: v.string() },
  handler: async (ctx, args): Promise<ResultatResend> => {
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const hote = exigerHote(args.domaine)
    const cle = await lireSecret(ctx, "RESEND_API_KEY")
    if (cle === null) return { etat: "sans_cle" }

    try {
      const existant = await trouverDomaine(cle, hote)
      if (existant !== null) return await relire(cle, existant, hote, true)

      const creation = await appeler(
        cle,
        "/domains",
        { method: "POST", body: { name: hote } },
        estDejaDeclare,
      )
      if (creation.ok) {
        const domaine = lireDomaine(creation.corps)
        if (domaine === null) throw new ErreurResend("injoignable")
        // APRÈS l'écriture, et seulement si elle a eu lieu : un journal
        // qui note des gestes qui n'ont pas abouti ne se relit pas.
        await ctx.runMutation(internal.resendDomain.journaliserDeclaration, {
          acteurId: acteur._id,
          acteurEmail: acteur.email,
          domaine: hote,
        })
        return assembler(domaine, hote, false)
      }

      // Le domaine est apparu entre notre lecture et notre écriture. On
      // relit : c'est le même résultat que si on l'avait vu du premier
      // coup, et c'est ce qui rend un second appel inoffensif.
      const apres = await trouverDomaine(cle, hote)
      // Refusé comme déjà déclaré, et pourtant invisible avec cette clé :
      // il appartient à un autre compte ou à une autre équipe. Rendre
      // « ok » avec zéro ligne ferait croire à un domaine sans rien à
      // créer, et l'adoptant attendrait des emails qui ne partiront pas.
      if (apres === null) return { etat: "introuvable" }
      return await relire(cle, apres, hote, true)
    } catch (erreur) {
      if (erreur instanceof ErreurResend) return { etat: erreur.issue }
      throw erreur
    }
  },
})

/** Lire un domaine connu, et l'assembler — `GET /domains/{id}`. */
async function relire(
  cle: string,
  id: string,
  hote: string,
  dejaDeclare: boolean,
): Promise<ResultatResend> {
  const reponse = await appeler(cle, `/domains/${id}`, { method: "GET" })
  if (!reponse.ok) throw new ErreurResend("refuse")
  const domaine = lireDomaine(reponse.corps)
  if (domaine === null) throw new ErreurResend("injoignable")
  return assembler(domaine, hote, dejaDeclare)
}

function assembler(
  domaine: { statut: string; records: unknown[] },
  hote: string,
  dejaDeclare: boolean,
): ResultatResend {
  const enregistrements: Enregistrement[] = []
  let ignores = 0
  for (const brut of domaine.records) {
    const ligne = versEnregistrement(brut as RecordResend, hote)
    if (ligne === null) ignores += 1
    else enregistrements.push(ligne)
  }
  return { etat: "ok", dejaDeclare, statut: domaine.statut, enregistrements, ignores }
}

/**
 * La ligne de journal, écrite depuis l'action.
 *
 * `internalMutation` parce qu'une action ne touche pas `ctx.db` : c'est le
 * même détour que `passwordReset.journaliserReinitialisation`, et le seul
 * disponible. La règle 1 de `lib/auditEvent.ts` — « la ligne s'écrit dans
 * la même mutation que le geste » — ne peut pas s'appliquer ici : le geste
 * est un `POST` chez un tiers, qu'aucune transaction Convex ne couvre. On
 * écrit donc APRÈS lui, et jamais à sa place.
 *
 * Le domaine et rien d'autre : ni la clé, ni son préfixe, ni l'identifiant
 * Resend du domaine — règle 3, aucune valeur de secret au journal.
 */
export const journaliserDeclaration = internalMutation({
  args: { acteurId: v.string(), acteurEmail: v.string(), domaine: v.string() },
  handler: async (ctx, args) => {
    await journaliser(ctx, {
      acteur: { _id: args.acteurId, email: args.acteurEmail },
      action: "emailDomain.declare",
      cible: args.domaine,
    })
  },
})

// Le garde-fou d'exhaustivité (`_registry.test.ts`) compte les ACTIONS
// publiques au même titre que les mutations : sans cette entrée, il échoue.
//
// La matrice de `lib/authz.test.ts` APPELLE réellement cette action pour un
// owner et pour un admin. Elle s'arrête sur `sans_cle` — aucune clé Resend
// n'est posée dans l'environnement de test, et rien n'est chiffré en base —
// donc aucune requête ne part vers api.resend.com, et surtout aucun domaine
// n'est déclaré sur le compte Resend de qui lance la suite. C'est le chemin
// d'autorisation qu'on veut exercer ici, pas l'appel sortant.
//
// `exemple.invalid` : `.invalid` est réservé par la RFC 2606 pour ne jamais
// être délégué, et il passe `normaliserHote` — la validation doit réussir,
// sinon un owner recevrait `INVALID_DOMAIN` là où la matrice attend un
// succès.
MUTATION_REGISTRY.push(
  {
    name: "resendDomain.etat",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.action(api.resendDomain.etat, { domaine: "exemple.invalid" }),
  },
  {
    name: "resendDomain.declarer",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.action(api.resendDomain.declarer, { domaine: "exemple.invalid" }),
  },
)
