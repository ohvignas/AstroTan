import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { connect } from "node:tls"
import { memoireNeuve, passe, type Hotes, type Journal, type Ports } from "./passe"

// Le service `routeur` : il suit le domaine déclaré et réécrit la
// configuration dynamique que Traefik surveille.
//
// CE FICHIER N'EST QUE DU BRANCHEMENT. La décision — quand écrire, quoi
// garder, quand refuser — vit dans `passe.ts`, derrière des ports injectés,
// et c'est là qu'elle est éprouvée. Ici il n'y a que quatre implémentations
// de ces ports et une boucle.
//
// CE QU'IL NE FAIT PAS, ET QUI EST LA MOITIÉ DE SA DÉFINITION
//
// Pas de serveur, pas de port exposé, pas de socket Docker. Un service qui
// décide du routage public est une cible ; celui-ci n'offre aucune surface :
// il ne parle qu'à deux interlocuteurs, et c'est LUI qui les appelle.
// Corollaire à ne pas défaire — le compose ne lui donne ni `ports:` ni le
// socket Docker de l'hôte, et `passe.test.ts` relit ce fichier pour le
// vérifier (il cherche des littéraux : ne pas en écrire un ici, même en
// commentaire, ferait rougir le test pour une prose).

/** Une variable dont l'absence n'a pas de repli raisonnable. */
function exigee(nom: string): string {
  const valeur = process.env[nom]
  if (valeur === undefined || valeur === "") {
    // Échouer au démarrage, pas à la première passe : le conteneur reste
    // alors en redémarrage visible dans `docker compose ps`, au lieu de
    // tourner en boucle sur une erreur que personne ne lit.
    throw new Error(`${nom} est obligatoire — voir docker/.env.example`)
  }
  return valeur
}

const CONVEX_URL = exigee("CONVEX_URL").replace(/\/+$/, "")
const ROUTING_SECRET = exigee("ROUTING_SECRET")

/**
 * Le fichier écrit, dans le volume que Traefik monte en LECTURE SEULE.
 *
 * `.yml` et pas autre chose : le provider fichier de Traefik ne lit que
 * `.toml`, `.yaml`, `.yml` et `.json`. Un fichier d'une autre extension est
 * ignoré — en silence, ce qui donne un routage vide sans erreur.
 */
const FICHIER = process.env.ROUTES_FICHIER ?? "/dynamique/routes.yml"

/**
 * L'intervalle entre deux passes. Deux passes concordantes sont
 * nécessaires avant toute écriture : c'est donc aussi le délai entre un
 * changement de domaine dans l'administration et sa prise d'effet.
 *
 * Trente secondes, et pas plus court : ce délai EST l'anti-battement, et sa
 * raison d'être est le quota Let's Encrypt (cinq certificats par domaine et
 * par semaine, échecs compris).
 */
const INTERVALLE_MS = Number(process.env.INTERVALLE_MS ?? 30_000)

/**
 * Où frapper pour savoir si un hôte sert déjà un certificat valide.
 *
 * Le conteneur Traefik DIRECTEMENT, par le réseau `edge` — jamais l'adresse
 * publique de l'hôte. Passer par internet ferait dépendre le retrait des
 * anciens hôtes de la propagation DNS et du retour du trafic sur soi-même
 * (le « hairpin » NAT), que beaucoup d'hébergeurs ne font pas. On veut
 * savoir si TRAEFIK a le certificat, pas si le réseau du monde est d'accord.
 */
const CIBLE_TLS = process.env.TRAEFIK_TLS ?? "traefik:443"

const journal: Journal = {
  info: (message) => process.stdout.write(`[routeur] ${message}\n`),
  erreur: (message) => process.stderr.write(`[routeur] ${message}\n`),
}

/**
 * `routing.hotes`, par l'API HTTP de Convex.
 *
 * En `fetch` nu plutôt qu'avec `ConvexHttpClient` : c'est UN appel, à une
 * query dont les arguments et le résultat sont des chaînes. Le client
 * apporterait le paquet `convex` entier — et son abonnement WebSocket, dont
 * ce service n'a que faire — dans une image qui, sans lui, n'embarque aucun
 * `node_modules`.
 */
async function lireHotes(): Promise<Hotes> {
  const reponse = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "routing:hotes",
      format: "convex_encoded_json",
      // Convex attend les arguments dans un tableau à un élément.
      args: [{ secret: ROUTING_SECRET }],
    }),
    // Sans délai maximal, une connexion qui pend fige la boucle entière —
    // et le routage cesse alors de suivre quoi que ce soit, sans erreur.
    signal: AbortSignal.timeout(10_000),
  })

  // Une erreur de function répond 560 avec un corps JSON exploitable : on
  // lit le corps AVANT de regarder le code, pour rendre le message plutôt
  // qu'un numéro.
  const texte = await reponse.text()
  let corps: unknown
  try {
    corps = JSON.parse(texte)
  } catch {
    throw new Error(`réponse illisible de Convex (HTTP ${reponse.status})`)
  }
  if (typeof corps !== "object" || corps === null || !("status" in corps)) {
    throw new Error(`réponse inattendue de Convex (HTTP ${reponse.status})`)
  }
  const enveloppe = corps as { status: string; value?: unknown; errorMessage?: string }
  if (enveloppe.status !== "success") {
    // Le message vient de `assertSharedSecret` en cas de secret faux, et il
    // ne dit délibérément pas ce qui cloche. Le citer tel quel reste utile :
    // il est lu ici par l'opérateur, dans les journaux de son conteneur.
    throw new Error(enveloppe.errorMessage ?? `Convex a refusé (HTTP ${reponse.status})`)
  }
  return valideHotes(enveloppe.value)
}

/**
 * La forme du résultat, vérifiée avant qu'il ne devienne du routage.
 *
 * Une réponse mal formée doit LEVER : traitée comme des hôtes, elle
 * produirait `Host(`undefined`)` — une règle que Traefik accepte et qui ne
 * correspond à rien. Le site disparaîtrait sans qu'aucune erreur ne le dise.
 */
function valideHotes(valeur: unknown): Hotes {
  const h = valeur as Partial<Hotes> | null
  if (
    h === null ||
    typeof h !== "object" ||
    typeof h.web !== "string" ||
    typeof h.admin !== "string" ||
    (h.umami !== null && typeof h.umami !== "string")
  ) {
    throw new Error(`hôtes inattendus : ${JSON.stringify(valeur)}`)
  }
  return { web: h.web, admin: h.admin, umami: h.umami ?? null }
}

async function lireRoutes(): Promise<string | null> {
  try {
    return await readFile(FICHIER, "utf8")
  } catch (cause) {
    // Absent est le cas NORMAL du premier démarrage, et le seul qu'on
    // avale : tout autre échec de lecture (droits, volume non monté) doit
    // remonter, sinon on prendrait un fichier illisible pour un fichier
    // vide et on effacerait les anciens hôtes qu'il contient.
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null
    throw cause
  }
}

/**
 * Écrit le fichier ENTIÈREMENT ou pas du tout.
 *
 * Traefik surveille ce répertoire et relit à chaque changement. Une
 * écriture en place le ferait lire à mi-chemin : un YAML tronqué, refusé,
 * et — le temps d'une réécriture — aucune route. Le `rename` est atomique
 * sur le même système de fichiers, donc Traefik ne voit jamais qu'un
 * fichier complet, l'ancien ou le nouveau.
 *
 * Le temporaire est en `.tmp` exprès : le provider fichier ne lit que
 * `.toml`/`.yaml`/`.yml`/`.json`, il ne tentera donc jamais de le charger.
 */
async function ecrireRoutes(contenu: string): Promise<void> {
  await mkdir(dirname(FICHIER), { recursive: true })
  const temporaire = `${FICHIER}.tmp`
  await writeFile(temporaire, contenu, "utf8")
  await rename(temporaire, FICHIER)
}

/**
 * Cet hôte sert-il DÉJÀ un certificat valide ?
 *
 * `socket.authorized` répond aux deux questions à la fois : la chaîne
 * remonte-t-elle à une autorité de confiance, et le certificat couvre-t-il
 * bien `servername`. C'est exactement la condition du retrait des anciens
 * hôtes.
 *
 * CONSÉQUENCE À CONNAÎTRE : sur le CA de STAGING de Let's Encrypt
 * (`ACME_CA_SERVER`, `docker/.env.example`), aucun certificat n'est reconnu
 * — donc les anciens hôtes ne sont jamais retirés. C'est le bon sens de
 * l'échec : un routage qui garde une porte de trop, jamais un routage qui
 * en ferme une de trop.
 */
function sertUnCertificatValide(hote: string): Promise<boolean> {
  const [host = "traefik", port = "443"] = CIBLE_TLS.split(":")
  return new Promise((resolve) => {
    let repondu = false
    const finir = (verdict: boolean) => {
      if (repondu) return
      repondu = true
      socket.destroy()
      resolve(verdict)
    }
    const socket = connect({ host, port: Number(port), servername: hote, timeout: 5_000 }, () =>
      finir(socket.authorized),
    )
    socket.on("error", () => finir(false))
    socket.on("timeout", () => finir(false))
  })
}

const ports: Ports = {
  lireHotes,
  lireRoutes,
  ecrireRoutes,
  sertUnCertificatValide,
  journal,
}

const attendre = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function boucle(): Promise<void> {
  const memoire = memoireNeuve()
  journal.info(`démarré — ${FICHIER}, une passe toutes les ${INTERVALLE_MS} ms`)
  for (;;) {
    // `passe` ne lève pas : elle rend ce qu'elle a fait, et journalise
    // elle-même ses refus. La boucle n'a donc aucune raison de s'arrêter,
    // ce qui est la propriété qu'on veut — un service de routage qui meurt
    // laisse le routage figé pour toujours.
    const issue = await passe(ports, memoire)
    if (issue === "écrit") journal.info("Traefik relira le fichier de lui-même")
    await attendre(INTERVALLE_MS)
  }
}

// Sans cela, `docker compose stop` attend dix secondes puis tue le
// conteneur : Node ignore SIGTERM tant qu'aucun gestionnaire ne l'écoute.
process.on("SIGTERM", () => process.exit(0))
process.on("SIGINT", () => process.exit(0))

void boucle()
