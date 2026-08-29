import { v } from "convex/values"
import { ConvexError } from "convex/values"
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { api, internal } from "./_generated/api"
import { MUTATION_REGISTRY } from "./_registry"
import { isCurrentlyBanned, requireRole } from "./lib/authz"
import { makeResend } from "./lib/resend"
import { resoudreExpediteur } from "./lib/expediteur"
import { listUsersWithRole } from "./users"
import { assertSharedSecret } from "./lib/sharedSecret"
import { journaliser, nomDeLAuteur } from "./lib/auditEvent"
import { RateLimiter } from "@convex-dev/rate-limiter"
import { components } from "./_generated/api"
import {
  LEAD_EMAIL_LIMIT_CONFIG,
  LEAD_EMAIL_LIMIT_NAME,
  LEAD_ORIGIN_LIMIT_CONFIG,
  LEAD_ORIGIN_LIMIT_NAME,
} from "./lib/leadRateLimit"
import { origineDeComptage } from "./lib/originFingerprint"
import {
  LEAD_STATUSES,
  MAX_LEAD_BODY_LENGTH,
  MAX_LEAD_EMAIL_LENGTH,
  MAX_LEAD_NAME_LENGTH,
  MAX_LEAD_SUBJECT_LENGTH,
  looksLikeEmail,
  type LeadStatus,
} from "./content"

// Les personnes qui écrivent depuis le formulaire de contact.
//
// `submit` est la SEULE écriture publique de tout le backend. Partout
// ailleurs, `apps/web` ne fait que lire. Cette exception est étroite par
// construction : elle exige un secret partagé que seul le serveur détient,
// et elle est appelée par une route Astro qui voit l'adresse du visiteur —
// deux choses qu'un navigateur ne peut pas fournir honnêtement.
//
// La limitation de débit est ICI, et il faut le dire parce que ce
// commentaire a affirmé le contraire pendant des semaines : il renvoyait à
// la route Astro, laquelle renvoyait à Convex, et aucune des deux ne la
// portait. Une revue de sécurité a relevé que le seul chemin d'écriture
// public du backend était sans limite, alors que chaque envoi déclenche en
// plus un appel de webhook sortant et un email.

const statusValidator = v.union(...LEAD_STATUSES.map((s) => v.literal(s)))

/**
 * Le secret partagé, comparé à temps constant et haché des deux côtés.
 *
 * La règle vit dans `lib/sharedSecret.ts` : elle était recopiée ici, dans
 * `/api/revalidate` et dans `consent.record`, et le troisième exemplaire
 * avait divergé.
 */
async function assertSecret(provided: string): Promise<void> {
  await assertSharedSecret(provided, process.env.LEAD_SUBMIT_SECRET)
}

// Même montage qu'à la connexion : la configuration est statique ici, le
// contexte Convex n'arrive qu'à l'appel.
const limiteur = new RateLimiter(components.rateLimiter, {
  [LEAD_ORIGIN_LIMIT_NAME]: LEAD_ORIGIN_LIMIT_CONFIG,
  [LEAD_EMAIL_LIMIT_NAME]: LEAD_EMAIL_LIMIT_CONFIG,
})

function assertBounded(value: string, max: number, field: string): void {
  if (value.length > max) throw new ConvexError({ code: "TOO_LONG", field })
}

export const submit = mutation({
  args: {
    secret: v.string(),
    /**
     * Une EMPREINTE de l'adresse du visiteur, jamais l'adresse elle-même.
     * La route Astro la hache avec le secret partagé : Convex ne voit donc
     * pas d'IP, et la politique de confidentialité peut continuer d'écrire
     * que le formulaire n'en conserve pas. Optionnel — un appelant qui ne
     * la fournit pas tombe dans un seau commun, il n'obtient pas un budget
     * neuf.
     */
    origin: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    await assertSecret(args.secret)

    // Deux compteurs, dans cet ordre. L'origine d'abord : elle est plus
    // large, donc elle arrête l'envoi automatisé avant qu'il ne consomme le
    // budget d'une adresse qu'il ne possède pas.
    const origine = origineDeComptage(args.origin)
    const parOrigine = await limiteur.limit(ctx, LEAD_ORIGIN_LIMIT_NAME, { key: origine })
    if (!parOrigine.ok) {
      throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parOrigine.retryAfter })
    }

    const name = args.name.trim()
    const email = args.email.trim().toLowerCase()
    const body = args.body.trim()
    const subject = args.subject?.trim() || undefined

    // Vide après nettoyage : un formulaire rempli d'espaces n'est pas un
    // message, et le laisser passer remplirait le tableau de cartes vides.
    if (name.length === 0 || body.length === 0) {
      throw new ConvexError({ code: "EMPTY" })
    }

    // Après normalisation : `A@B.fr` et `a@b.fr` doivent partager un seul
    // budget, sinon la casse suffit à le contourner.
    const parEmail = await limiteur.limit(ctx, LEAD_EMAIL_LIMIT_NAME, { key: email })
    if (!parEmail.ok) {
      throw new ConvexError({ code: "RATE_LIMITED", retryAfter: parEmail.retryAfter })
    }
    assertBounded(name, MAX_LEAD_NAME_LENGTH, "name")
    assertBounded(email, MAX_LEAD_EMAIL_LENGTH, "email")
    assertBounded(body, MAX_LEAD_BODY_LENGTH, "body")
    if (subject) assertBounded(subject, MAX_LEAD_SUBJECT_LENGTH, "subject")
    if (!looksLikeEmail(email)) throw new ConvexError({ code: "INVALID_EMAIL" })

    const now = Date.now()
    // L'email fait l'identité : quelqu'un qui réécrit ne crée pas une
    // seconde carte à côté de la sienne.
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique()

    let leadId: Id<"leads">
    if (existing === null) {
      leadId = await ctx.db.insert("leads", {
        name,
        email,
        status: "new",
        lastMessageAt: now,
        messageCount: 1,
      })
      // Le plancher de l'historique. C'est sa présence — et rien d'autre —
      // qui permet à `timeline` de distinguer « il ne s'est rien passé »
      // de « ce qui s'est passé n'a pas été enregistré » pour les fiches
      // antérieures au suivi.
      await ctx.db.insert("leadEvents", { leadId, type: "created", to: "new" })
    } else {
      leadId = existing._id
      await ctx.db.patch(leadId, {
        // Le nom de la fiche est conservé : c'est celui que l'équipe a déjà
        // sous les yeux, et un formulaire re-rempli à la va-vite ne doit pas
        // renommer un contact connu.
        status: "new",
        lastMessageAt: now,
        messageCount: existing.messageCount + 1,
      })
      // Une relance ramène la fiche en tête, donc dans la colonne Nouveau.
      // C'est un vrai changement de colonne — celui qu'on voit se produire
      // sur le tableau — et il se raconte comme les autres, sans auteur :
      // personne dans l'équipe ne l'a décidé, la personne a réécrit.
      if (existing.status !== "new") {
        await ctx.db.insert("leadEvents", {
          leadId,
          type: "status",
          from: existing.status,
          to: "new",
        })
      }
    }

    // Un message n'écrase jamais le précédent. Fusionner les deux forcerait
    // à choisir entre garder le premier ou le dernier, et les deux choix
    // perdent quelque chose que personne ne pourra retrouver.
    const messageId = await ctx.db.insert("leadMessages", {
      leadId,
      subject,
      body,
      userAgent: args.userAgent,
    })
    // L'événement ne recopie pas le corps : il pointe la ligne qui le
    // porte. Deux copies du même texte finiraient par diverger, et il n'y
    // aurait plus moyen de dire laquelle la personne a écrite.
    await ctx.db.insert("leadEvents", { leadId, type: "message", messageId })

    // APRÈS l'écriture, et planifié : le lead est en base quoi qu'il
    // advienne du tiers. Planifier avant, ou appeler pendant, ferait
    // dépendre un message reçu de la santé d'un service qu'on ne contrôle
    // pas.
    const messageCount = existing === null ? 1 : existing.messageCount + 1
    await ctx.scheduler.runAfter(0, internal.leads.deliverWebhook, {
      leadId,
      name,
      email,
      subject,
      body,
      messageCount,
    })

    // Même raisonnement, même ordre : prévenir les responsables est un
    // effet de bord de l'écriture, jamais une condition de l'écriture. Une
    // panne de Resend, une clé absente, un domaine non vérifié — rien de
    // tout cela ne doit faire disparaître un message qu'une personne a
    // pris la peine d'écrire.
    await ctx.scheduler.runAfter(0, internal.leads.notifyStaff, {
      name,
      email,
      subject,
      body,
      messageCount,
    })

    return null
  },
})

export type Board = Record<LeadStatus, Doc<"leads">[]>

export const board = query({
  args: {},
  handler: async (ctx): Promise<Board> => {
    await requireRole(ctx, ["owner", "admin", "editor"])

    const columns = await Promise.all(
      LEAD_STATUSES.map((status) =>
        ctx.db
          .query("leads")
          .withIndex("by_status", (q) => q.eq("status", status))
          // Le plus récent en tête : c'est l'ordre dans lequel on répond.
          .order("desc")
          .collect(),
      ),
    )

    return Object.fromEntries(
      LEAD_STATUSES.map((status, index) => [status, columns[index]]),
    ) as Board
  },
})

/** Une ligne de la frise, telle que le panneau de détail la rend. */
export type LeadTimelineEntry =
  | { kind: "created"; at: number }
  | { kind: "message"; at: number; subject?: string; body: string }
  | {
      kind: "status"
      at: number
      from: LeadStatus
      to: LeadStatus
      /** `null` quand le geste vient du visiteur et non de l'équipe. */
      actorName: string | null
    }

export type LeadTimeline = {
  /** Du plus récent au plus ancien — l'ordre dans lequel on relit. */
  entries: LeadTimelineEntry[]
  /**
   * Faux quand la fiche est antérieure au suivi des événements : ses
   * messages sont là, mais ce qui leur est arrivé ne l'est pas. Le panneau
   * le dit au lieu de laisser croire à une fiche sans histoire — et l'on
   * ne fabrique surtout pas d'événements rétroactifs à partir de dates
   * approximatives, qui auraient l'air vrais.
   */
  complete: boolean
}

// À date égale — deux écritures d'une même mutation partagent la
// milliseconde — c'est ce rang qui décide, et non l'ordre d'arrivée dans
// la boucle. Une relance produit d'un seul coup le retour en colonne
// Nouveau et le message : « a écrit » se lit au-dessus de « repassé en
// Nouveau », parce que le second est la conséquence du premier.
const RANG: Record<LeadTimelineEntry["kind"], number> = {
  created: 0,
  status: 1,
  message: 2,
}

export const timeline = query({
  args: { id: v.id("leads") },
  handler: async (ctx, args): Promise<LeadTimeline> => {
    await requireRole(ctx, ["owner", "admin", "editor"])

    // La fiche d'abord : sans elle, rendre une liste vide laisserait croire
    // qu'une personne connue n'a jamais rien écrit.
    const lead = await ctx.db.get(args.id)
    if (lead === null) throw new ConvexError({ code: "NOT_FOUND" })

    const [events, messages] = await Promise.all([
      ctx.db
        .query("leadEvents")
        .withIndex("by_lead", (q) => q.eq("leadId", args.id))
        .collect(),
      ctx.db
        .query("leadMessages")
        .withIndex("by_lead", (q) => q.eq("leadId", args.id))
        .collect(),
    ])

    // Les événements forment la trame ; les messages fournissent le texte.
    // Ce qui reste dans cette table après la boucle est exactement ce
    // qu'aucun événement ne couvre — les messages écrits avant que le
    // suivi n'existe. Ils apparaissent quand même : ne pas savoir ce qui
    // leur est arrivé n'est pas une raison de les cacher.
    const parMessage = new Map(messages.map((message) => [message._id, message]))
    const entries: LeadTimelineEntry[] = []

    for (const event of events) {
      if (event.type === "message") {
        const message = event.messageId && parMessage.get(event.messageId)
        // Un événement dont le message a disparu ne se rend pas : il
        // afficherait une ligne vide sans rien apprendre.
        if (!message) continue
        parMessage.delete(message._id)
        entries.push({
          kind: "message",
          at: message._creationTime,
          subject: message.subject,
          body: message.body,
        })
      } else if (event.type === "status") {
        // `from`/`to` sont facultatifs dans le schéma parce qu'ils n'ont de
        // sens que pour ce type — c'est ici, au seul point de lecture, que
        // la forme typée se recompose.
        if (event.from === undefined || event.to === undefined) continue
        entries.push({
          kind: "status",
          at: event._creationTime,
          from: event.from,
          to: event.to,
          actorName: event.actorName ?? null,
        })
      } else {
        entries.push({ kind: "created", at: event._creationTime })
      }
    }

    for (const message of parMessage.values()) {
      entries.push({
        kind: "message",
        at: message._creationTime,
        subject: message.subject,
        body: message.body,
      })
    }

    entries.sort((a, b) => b.at - a.at || RANG[b.kind] - RANG[a.kind])

    return {
      entries,
      complete: events.some((event) => event.type === "created"),
    }
  },
})

export const newCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    await requireRole(ctx, ["owner", "admin", "editor"])
    const waiting = await ctx.db
      .query("leads")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect()
    return waiting.length
  },
})

export const move = mutation({
  args: { id: v.id("leads"), status: statusValidator },
  handler: async (ctx, args): Promise<null> => {
    const authUser = await requireRole(ctx, ["owner", "admin", "editor"])
    const lead = await ctx.db.get(args.id)
    if (lead === null) throw new ConvexError({ code: "NOT_FOUND" })

    // Reposer une carte dans sa propre colonne n'est pas un déplacement.
    // L'interface l'évite déjà, mais c'est ici que ça compte : une ligne
    // « passé de Nouveau à Nouveau » serait du bruit dans un historique
    // qu'on lit pour comprendre.
    if (lead.status === args.status) return null

    await ctx.db.patch(args.id, { status: args.status })
    // Dans la MÊME mutation que le changement, jamais dans une action
    // planifiée : l'écriture et sa trace réussissent ou échouent ensemble.
    // Un historique auquel il peut manquer une ligne est pire qu'absent —
    // on le croit complet.
    await ctx.db.insert("leadEvents", {
      leadId: args.id,
      type: "status",
      from: lead.status,
      to: args.status,
      actorId: authUser._id,
      actorName: await nomDeLAuteur(ctx, authUser._id, authUser.email),
    })
    return null
  },
})

export const remove = mutation({
  args: { id: v.id("leads") },
  handler: async (ctx, args): Promise<null> => {
    // Supprimer est réservé : un éditeur classe, il n'efface pas ce qu'un
    // visiteur a écrit.
    const acteur = await requireRole(ctx, ["owner", "admin"])
    const lead = await ctx.db.get(args.id)
    if (lead === null) throw new ConvexError({ code: "NOT_FOUND" })

    // Les messages partent avec la fiche. Les laisser derrière serait une
    // fuite silencieuse : plus personne ne les verrait, et ils resteraient.
    const messages = await ctx.db
      .query("leadMessages")
      .withIndex("by_lead", (q) => q.eq("leadId", args.id))
      .collect()
    for (const message of messages) await ctx.db.delete(message._id)

    // L'historique part avec, pour la même raison : des événements qui
    // désignent une fiche disparue ne se rendent nulle part et ne se
    // suppriment plus.
    const events = await ctx.db
      .query("leadEvents")
      .withIndex("by_lead", (q) => q.eq("leadId", args.id))
      .collect()
    for (const event of events) await ctx.db.delete(event._id)

    await ctx.db.delete(args.id)
    // L'IDENTIFIANT de la fiche, et rien d'autre : ni l'adresse, ni le nom.
    // `/confidentialite` promet l'effacement et `dataSubject.ts` le rend
    // exécutable ; recopier ici l'adresse d'une personne qu'on vient
    // d'effacer le défairait, dans une table qui, elle, ne s'efface pas.
    // Le journal répond à « qui a supprimé une fiche, et quand » — la
    // question qu'on ne peut pas reconstituer autrement — sans avoir
    // besoin de répondre à « laquelle ».
    await journaliser(ctx, {
      acteur,
      action: "lead.remove",
      cible: args.id,
    })
    return null
  },
})

// --- Registre des mutations ----------------------------------------------
//
// `submit` n'est gardée par aucun rôle, volontairement : c'est ainsi qu'un
// visiteur sans compte écrit. Son autorisation est la possession du secret
// partagé, jamais le rôle de l'appelant. Déclarer les trois rôles l'enregistre
// honnêtement — aucun n'est refusé, parce qu'aucun n'est ce que `submit`
// vérifie. Le vrai cas, l'appel sans session, est couvert par `leads.test.ts`,
// que cette matrice n'exerce jamais.
MUTATION_REGISTRY.push(
  {
    name: "leads.submit",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: (t) =>
      t.mutation(api.leads.submit, {
        secret: process.env.LEAD_SUBMIT_SECRET ?? "",
        name: "Registre",
        email: `registry-${Date.now()}-${Math.random()}@example.com`,
        body: "Message du registre.",
      }),
  },
  {
    name: "leads.move",
    allowedRoles: ["owner", "admin", "editor"],
    invoke: async (t) => {
      const id = await t.run((ctx: any) =>
        ctx.db.insert("leads", {
          name: "Registre",
          email: `registry-move-${Date.now()}-${Math.random()}@example.com`,
          status: "new",
          lastMessageAt: Date.now(),
          messageCount: 1,
        }),
      )
      return t.mutation(api.leads.move, { id, status: "contacted" })
    },
  },
  {
    // Supprimer est réservé : un éditeur classe, il n'efface pas ce qu'un
    // visiteur a écrit.
    name: "leads.remove",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await t.run((ctx: any) =>
        ctx.db.insert("leads", {
          name: "Registre",
          email: `registry-remove-${Date.now()}-${Math.random()}@example.com`,
          status: "new",
          lastMessageAt: Date.now(),
          messageCount: 1,
        }),
      )
      return t.mutation(api.leads.remove, { id })
    },
  },
)

// --- Le webhook ----------------------------------------------------------

/**
 * Prévenir un service tiers qu'un lead est arrivé.
 *
 * Une `action` planifiée APRÈS l'écriture, jamais avant et jamais pendant :
 * le lead est en base quoi qu'il arrive au tiers. L'ordre n'est pas un
 * détail d'implémentation, c'est la garantie qu'une panne de n8n ne fait
 * pas perdre un message.
 *
 * Une seule tentative. Un réessai automatique demanderait une file, une
 * limite, et une idempotence côté receveur qu'on ne contrôle pas — trois
 * choses qu'il vaut mieux ne pas simuler. L'échec est écrit dans les
 * réglages, où il se voit.
 */
export const deliverWebhook = internalAction({
  args: {
    leadId: v.id("leads"),
    name: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    messageCount: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    const settings = await ctx.runQuery(internal.leads.webhookConfig, {})
    if (settings === null) return null

    const payload = JSON.stringify({
      type: "lead.created",
      // Millisecondes, et dit comme tel : la moitié des intégrations se
      // trompent d'unité en silence, et une date de 1970 ne se remarque pas.
      occurredAtMs: Date.now(),
      lead: {
        id: args.leadId,
        name: args.name,
        email: args.email,
        subject: args.subject ?? null,
        message: args.body,
        messageCount: args.messageCount,
      },
    })

    let status: string
    try {
      const response = await fetch(settings.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // La signature permet au receveur de vérifier que l'envoi vient
          // bien de nous. Sans elle, qui connaît l'URL du scénario peut y
          // injecter de faux leads — et une URL de webhook n'est pas un
          // secret : elle traverse des journaux, des captures d'écran.
          "x-astrotan-signature": await sign(payload, settings.secret),
        },
        body: payload,
        // Borné : un tiers qui ne répond pas ne doit pas tenir une action
        // ouverte indéfiniment.
        signal: AbortSignal.timeout(10_000),
      })
      status = response.ok ? `Envoyé (${response.status})` : decrire(response.status)
    } catch (error) {
      // `TimeoutError` vient de notre propre `AbortSignal.timeout`, et
      // signifie autre chose qu'une adresse morte : le service a accepté la
      // connexion mais n'a pas répondu.
      status =
        error instanceof Error && error.name === "TimeoutError"
          ? "Pas de réponse en 10 s — le service a peut-être mis trop de temps"
          : "Adresse injoignable — vérifiez l'URL et que le service tourne"
    }

    await ctx.runMutation(internal.leads.recordWebhookResult, { status })
    return null
  },
})

/**
 * Un code HTTP en une phrase que quelqu'un peut suivre.
 *
 * « échec 410 » n'apprend rien à qui n'a pas les codes HTTP en tête, et
 * c'est précisément la personne qui lit cet écran : elle veut savoir si
 * elle doit corriger l'URL, rallumer un scénario, ou attendre.
 */
function decrire(status: number): string {
  if (status === 404 || status === 410) {
    return `Le scénario n'existe plus à cette adresse (${status}) — il a été supprimé ou désactivé`
  }
  if (status === 401 || status === 403) {
    return `Envoi refusé (${status}) — le service demande une authentification que nous n'envoyons pas`
  }
  if (status === 429) {
    return `Trop d'envois (${status}) — le service nous demande de ralentir`
  }
  if (status >= 500) {
    return `Le service a échoué de son côté (${status})`
  }
  return `Envoi refusé (${status})`
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/** Lue par l'action ; `null` quand le webhook n'est pas configuré. */
export const webhookConfig = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ url: string; secret: string } | null> => {
    const settings = await ctx.db.query("settings").first()
    if (!settings?.leadWebhookUrl || !settings.leadWebhookSecret) return null
    return { url: settings.leadWebhookUrl, secret: settings.leadWebhookSecret }
  },
})

export const recordWebhookResult = internalMutation({
  args: { status: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const settings = await ctx.db.query("settings").first()
    if (settings === null) return null
    await ctx.db.patch(settings._id, {
      leadWebhookLastStatus: args.status,
      leadWebhookLastAt: Date.now(),
    })
    return null
  },
})

// --- Prévenir les responsables -------------------------------------------

/**
 * Les adresses à prévenir : les comptes `owner` et `admin`, personne
 * d'autre.
 *
 * Pas « qui peut lire » mais « qui doit répondre » — un éditeur classe les
 * fiches sans avoir à recevoir chaque message dans sa boîte. Le rôle est lu
 * sur l'utilisateur Better Auth (invariant 4), par la même primitive que
 * `users.ts` utilise pour compter les owners, et non par une seconde
 * interrogation maison de la table du composant.
 *
 * Un compte banni est retiré : lui envoyer par email ce qu'on vient de lui
 * interdire de lire ferait du ban une décoration, exactement comme
 * `decideAccess` l'évite côté lecture.
 */
export const staffRecipients = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const [owners, admins] = await Promise.all([
      listUsersWithRole(ctx, "owner"),
      listUsersWithRole(ctx, "admin"),
    ])
    const emails = [...owners, ...admins]
      .filter((user) => !isCurrentlyBanned(user))
      .map((user) => user.email)
    // Dédupliqué : deux rôles ne peuvent pas coexister sur un compte
    // aujourd'hui, mais une adresse en double enverrait deux fois le même
    // email, et c'est le genre de défaut qu'on ne remarque qu'en production.
    return [...new Set(emails)]
  },
})

/** `&`, `<`, `>` et `"` échappés : le corps du message vient d'Internet. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Une seule ligne, sans retour chariot.
 *
 * Le nom et le sujet sont saisis par le visiteur et atterrissent dans
 * l'en-tête `Subject:` d'un email. Un retour à la ligne y ouvre la porte à
 * l'injection d'en-têtes ; les bornes de longueur de `content.ts` ne
 * disent rien des caractères de contrôle.
 */
function singleLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim()
}

/**
 * Prévenir les responsables qu'un message est arrivé.
 *
 * Une `internalAction` planifiée APRÈS l'écriture — voir `submit`. Elle
 * emprunte le chemin Resend déjà tracé par `invitations.ts` (même
 * composant, même configuration partagée via `lib/resend.ts`), et non un
 * second mécanisme d'envoi.
 *
 * Deux silences délibérés, et un seul cri :
 *
 * - **Pas de `RESEND_API_KEY`** : on ne tente rien. Un template qu'on
 *   essaie avant d'avoir ouvert un compte Resend ne doit pas afficher un
 *   job en échec à la première prise de contact. La clé absente est une
 *   configuration incomplète, pas une panne.
 * - **Aucun compte owner ni admin** : il n'y a personne à prévenir. C'est
 *   l'état normal d'un déploiement neuf, où un visiteur peut écrire avant
 *   que le premier compte n'existe.
 * - **`SITE_URL` absente** : là, on lève. La variable est censée être
 *   posée (c'est déjà ce que fait `sendInvitationEmail`), et un lien vers
 *   le dashboard ne se devine pas depuis Convex — un job en échec, visible
 *   dans le tableau de bord, vaut mieux qu'un email amputé de ce qui
 *   permet d'agir. Le lead, lui, est déjà en base.
 */
export const notifyStaff = internalAction({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    messageCount: v.number(),
  },
  handler: async (ctx, args): Promise<null> => {
    if (!process.env.RESEND_API_KEY) return null

    const recipients = await ctx.runQuery(internal.leads.staffRecipients, {})
    if (recipients.length === 0) return null

    const siteUrl = process.env.SITE_URL
    if (!siteUrl) throw new Error("SITE_URL is not set on this Convex deployment")
    const link = `${siteUrl}/leads`

    const name = singleLine(args.name)
    const subject = args.subject ? singleLine(args.subject) : "(sans sujet)"
    // Une relance se répond autrement qu'une première prise de contact :
    // le dire dans l'email évite d'avoir à ouvrir la fiche pour le
    // découvrir.
    const relance =
      args.messageCount > 1 ? `${args.messageCount}e message de cette personne.` : null

    const text = [
      `${name} <${args.email}> a écrit depuis le formulaire de contact.`,
      ...(relance ? [relance] : []),
      ``,
      `Sujet : ${subject}`,
      ``,
      args.body,
      ``,
      `Répondre depuis le dashboard : ${link}`,
    ].join("\n")

    const html = [
      `<p><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(args.email)}&gt; a écrit depuis le formulaire de contact.</p>`,
      relance ? `<p>${escapeHtml(relance)}</p>` : "",
      `<p><strong>Sujet :</strong> ${escapeHtml(subject)}</p>`,
      `<p style="white-space:pre-wrap">${escapeHtml(args.body)}</p>`,
      `<p><a href="${escapeHtml(link)}">Répondre depuis le dashboard</a></p>`,
    ].join("")

    const resend = await makeResend(ctx)
    // Hissé hors de la boucle : la valeur est constante pour tout l'appel,
    // la relire à chaque destinataire n'a aucune raison fonctionnelle — à
    // la différence du `sendEmail` un par un juste en dessous, qui lui sert
    // une vraie raison (ne pas révéler à chacun la liste des autres).
    const expediteur = await resoudreExpediteur(ctx)
    for (const to of recipients) {
      // Un email par destinataire, pas un seul avec plusieurs `to` : une
      // notification interne n'a pas à révéler à chacun la liste des
      // adresses des autres.
      await resend.sendEmail(ctx, {
        from: expediteur,
        to,
        subject: singleLine(`Nouveau message de ${name}`),
        html,
        text,
        // Répondre à cet email, c'est répondre à la personne qui a écrit.
        replyTo: [args.email],
      })
    }

    return null
  },
})
