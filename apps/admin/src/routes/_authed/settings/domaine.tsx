import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useAction, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Enregistrement, Verdict } from "@astrotan/backend/convex/dns"
import { normaliserHote } from "@astrotan/backend/convex/lib/hoteNu"
import type { ResultatResend } from "@astrotan/backend/convex/resendDomain"
import { describeSettingsError } from "@/lib/settingsErrors"
import type { Signe } from "@/components/domain-check"
import {
  Etiquette,
  TableauDns,
  fusionnerResend,
  fusionnerVerdicts,
} from "@/components/domain-check"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSettingsAccess,
} from "@/components/settings-page"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export const Route = createFileRoute("/_authed/settings/domaine")({
  component: DomaineRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>

function DomaineRoute() {
  const { loading, canWrite } = useSettingsAccess()
  const settings = useQuery(api.settings.getPrivate)
  if (loading || settings === undefined) {
    return <SettingsLoading />
  }
  return <DomaineForm settings={settings} canWrite={canWrite} />
}

// ---------------------------------------------------------------------
// Un champ, un bouton, et ce que l'hébergeur attend qu'on crée.
//
// CE QUE CE CHAMP FAIT, DÉSORMAIS
//
// Il change le domaine du déploiement. Ça n'a pas toujours été vrai — la
// version précédente de ce commentaire disait l'inverse, et avait raison :
// `WEB_DOMAIN` était figée au build de l'image du site et Traefik prenait
// ses règles dans des labels Docker. Les deux ont bougé (`51f8235`,
// `58911a4`, `e091a82`) : Traefik surveille maintenant un fichier que le
// service `routeur` réécrit depuis `routing.hotes`, laquelle dérive du
// domaine déclaré ici. `docker/.env` n'est plus que le repli, celui qui
// s'applique tant que personne n'a rien déclaré.
//
// D'OÙ L'ORDRE D'OPÉRATIONS QUE CET ÉCRAN REND OBLIGATOIRE
//
// Enregistrer, c'est faire demander un certificat par Traefik. Un domaine
// dont l'enregistrement A ne pointe pas encore ici fait échouer le
// challenge HTTP-01 — et chaque échec compte dans le quota Let's Encrypt
// (5 certificats par jeu d'identifiants tous les 7 jours, aucun moyen de
// remettre le compteur à zéro : `docker/.env.example`, ACME_CA_SERVER).
// Quelqu'un qui insiste passe la semaine suivante sans certificat, donc
// avec un avertissement de sécurité sur tous les navigateurs.
//
// Le bouton d'enregistrement reste donc inerte tant que les lignes A du
// domaine ne sont pas vertes (`domaineEnregistrable`), et l'état est à
// côté du bouton qui le fait changer. Le tableau d'abord, l'enregistrement
// ensuite : c'est l'ordre, et il n'est écrit nulle part à l'écran.
//
// POURQUOI RIEN NE PART TOUT SEUL À LA SAISIE
//
// Même raison que `settings/webhook.tsx`, appliquée à un autre effet de
// bord : une valeur intermédiaire est nuisible. `exemple.f` est une saisie
// en route vers `exemple.fr`, et enregistrée ne serait-ce qu'une seconde
// elle deviendrait le domaine du déploiement. D'où `auto: {}` :
// `snapshotChanged({}, {})` est toujours faux, la temporisation n'est
// jamais armée.
//
// La VÉRIFICATION suit le champ, elle, mais seulement là où c'est gratuit.
// `dns.plan` est une query (aucun appel sortant) et prend le domaine tapé
// dès qu'il est un hôte complet : le tableau se remplit pendant qu'on
// tape. Les trois actions — deux lectures DNS et la déclaration chez
// Resend — ne partent QUE d'un clic, ou une fois au montage pour le
// domaine déjà enregistré. Les faire suivre la frappe enverrait cinq
// requêtes sortantes par caractère.
// ---------------------------------------------------------------------

function DomaineForm({
  settings,
  canWrite,
}: {
  settings: Settings
  canWrite: boolean
}) {
  const updateSettings = useMutation(api.settings.update)
  const [domaine, setDomaine] = useState(settings?.declaredDomain ?? "")

  const domaineEnregistre = settings?.declaredDomain ?? null

  // Le domaine sur lequel tout porte : le plan, la vérification, la
  // déclaration chez Resend et le verrou du bouton. C'est CE QUI EST DANS
  // LE CHAMP, pas ce qui est enregistré — sans quoi un déploiement neuf
  // n'aurait aucune issue : rien d'enregistré, donc rien de vert, donc
  // impossible d'enregistrer le premier domaine.
  //
  // `normaliserHote` du backend, et non une expression régulière locale :
  // `dns.plan` refuse par `INVALID_DOMAIN` tout ce qu'elle refuse, et une
  // query Convex qui lève relance son erreur DANS LE RENDU — l'écran
  // entier tomberait sur une frappe. Les deux règles doivent donc être la
  // même, littéralement.
  const cible = normaliserHote(domaine)

  const verification = useVerification(domaineEnregistre)
  // La lecture ne vaut que pour l'hôte qu'elle a interrogé. Modifier le
  // champ après une vérification la rend caduque : les verdicts
  // retombent à « attente » et le verrou se referme, ce qui est
  // exactement ce qu'il faut — ils ne disent rien du nouveau domaine.
  const lecture = lectureDe(cible, verification.lecture)
  const etatA = etatDesA(domaine, cible, lecture)

  // Chaîne vide = « effacer » : `null` retire le réglage côté serveur, là
  // où `undefined` le laisserait tel quel (sémantique à trois états de
  // `settings.update`).
  const manualFields = {
    declaredDomain: domaine.trim() === "" ? null : domaine.trim(),
  }

  const autoSave = useAutoSave({
    enabled: canWrite,
    auto: {},
    manual: manualFields,
    saveAuto: async () => {
      // Inatteignable par construction (`auto: {}` ci-dessus). Lever
      // plutôt que ne rien faire : si un changement futur de `useAutoSave`
      // arme quand même la temporisation, l'erreur s'affiche dans la barre
      // au lieu d'enregistrer un domaine à moitié tapé en douce.
      throw new Error(
        "Le domaine n'a aucun champ à sauvegarde automatique : cet appel ne devrait pas exister."
      )
    },
    saveAll: async ({ manual }) => {
      await updateSettings(manual)
    },
    // Le serveur refuse déjà les formes invalides (`normaliserHote`,
    // `INVALID_DOMAIN`) ; ce contrôle-ci existe pour que le refus nomme la
    // faute au lieu de la faire deviner. Il appelle LA MÊME fonction que le
    // serveur — voir `cible` plus haut.
    validate: ({ manual }) =>
      manual.declaredDomain === null || normaliserHote(manual.declaredDomain) !== null
        ? null
        : "Un nom de domaine s'écrit « exemple.fr » : sans https://, sans barre oblique, sans port.",
    describeError: describeSettingsError,
  })

  return (
    <SettingsFormShell
      to="/settings/domaine"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="Le nom de domaine déclaré"
      // Le verrou. Vider le champ reste possible — effacer le domaine
      // déclaré ne demande aucun certificat à personne.
      blocked={!domaineEnregistrable(domaine, cible, lecture)}
    >
      <SettingsGroup>
        <Field>
          <FieldLabel htmlFor="domaine">Votre nom de domaine</FieldLabel>
          <Input
            id="domaine"
            type="text"
            placeholder="exemple.fr"
            value={domaine}
            disabled={!canWrite}
            onChange={(event) => setDomaine(event.target.value)}
          />
          <FieldDescription>
            Sans <code className="text-xs">https://</code>, sans{" "}
            <code className="text-xs">www</code>.
          </FieldDescription>
        </Field>

        {canWrite ? (
          <VerificationDns
            cible={cible}
            lecture={lecture}
            etatA={etatA}
            enCours={verification.enCours}
            erreur={verification.erreur}
            onVerifier={verification.verifier}
          />
        ) : null}
      </SettingsGroup>
    </SettingsFormShell>
  )
}

// ---------------------------------------------------------------------
// Le tableau, et la vérification qui le tient à jour.
// ---------------------------------------------------------------------

type Plan = { site: Enregistrement[]; email: Enregistrement[] }
type Resultat = { site: Verdict[]; email: Verdict[] }

/**
 * Ce qu'une vérification a rendu, ET pour quel hôte.
 *
 * `hote` n'est pas décoratif : sans lui, éditer le champ après une lecture
 * laisserait les verdicts d'`ancien.fr` décrire `nouveau.fr`, avec des
 * coches vertes qui armeraient le bouton d'enregistrement pour un domaine
 * que personne n'a jamais regardé. C'est le champ qui rend `lectureDe`
 * capable de dire non.
 */
export type Lecture = {
  hote: string
  site: Verdict[]
  email: Verdict[]
  resend: ResultatResend
}

/** La lecture — si elle porte bien sur le domaine visé, sinon rien. */
export function lectureDe(
  cible: string | null,
  lecture: Lecture | null
): Lecture | null {
  if (cible === null || lecture === null) return null
  return lecture.hote === cible ? lecture : null
}

/**
 * L'état des enregistrements A du domaine visé — celui qui décide.
 *
 * LES DEUX lignes A du groupe « Le site », pas une seule : Traefik demande
 * un certificat pour `exemple.fr` ET pour `admin.exemple.fr`, et les deux
 * échouent séparément, chacune sur le quota. N'en garder qu'une laisserait
 * brûler l'autre.
 *
 * `null` quand le champ est vide : il n'y a pas d'état à montrer d'un
 * domaine qu'on est en train d'effacer.
 */
export function etatDesA(
  saisie: string,
  cible: string | null,
  lecture: Lecture | null
): { signe: Signe; texte: string } | null {
  if (saisie.trim() === "") return null
  // Ni le plan ni la vérification ne peuvent rien pour une saisie qui n'est
  // pas encore un hôte. Le dire ici plutôt que de laisser un bouton
  // désactivé sans raison visible : `validate` ne parle, lui, qu'à
  // l'enregistrement — et l'enregistrement est justement ce qui est
  // interdit.
  if (cible === null) return { signe: "inconnu", texte: "Domaine incomplet" }
  const a = lecture?.site.filter((verdict) => verdict.type === "A") ?? []
  if (a.length === 0) return { signe: "inconnu", texte: "A non lu" }
  if (a.some((verdict) => verdict.etat === "manquant" || verdict.etat === "different")) {
    return { signe: "ko", texte: "A à poser" }
  }
  // Un résolveur muet n'est pas un enregistrement absent — même règle que
  // dans le tableau, et la même conséquence ici : on n'arme rien sur ce
  // qu'on n'a pas pu lire.
  if (a.some((verdict) => verdict.etat !== "ok")) {
    return { signe: "inconnu", texte: "A non lu" }
  }
  return { signe: "ok", texte: "A en place" }
}

/**
 * Le verrou, dérivé de l'état affiché — jamais calculé une seconde fois.
 *
 * Deux règles écrites séparément finiraient par diverger, et la façon dont
 * elles divergeraient est la pire possible : un bouton armé à côté d'une
 * croix rouge, ou l'inverse. Une seule fonction décide, l'écran en montre
 * le résultat.
 */
export function domaineEnregistrable(
  saisie: string,
  cible: string | null,
  lecture: Lecture | null
): boolean {
  // Effacer le domaine déclaré ne fait demander aucun certificat.
  if (saisie.trim() === "") return true
  return etatDesA(saisie, cible, lecture)?.signe === "ok"
}

/**
 * Ce que Resend a répondu, en un état et un mot.
 *
 * SIX ISSUES, PAS DEUX — et surtout `cle_restreinte` séparée du reste. Une
 * clé « Sending access » s'authentifie parfaitement et envoie les emails :
 * `secretCheck` l'accepte à raison. Elle ne peut simplement pas gérer les
 * domaines. La ranger sous « clé invalide » enverrait l'adoptant régénérer
 * une clé qui marche, et jeter celle qui est en service.
 *
 * `introuvable` de même : le domaine est déclaré, ailleurs, sur un compte
 * que cette clé ne voit pas. Rien à créer chez l'hébergeur ne réparera ça.
 */
export function etiquetteResend(resultat: ResultatResend): {
  signe: Signe
  texte: string
} {
  switch (resultat.etat) {
    case "sans_cle":
      return { signe: "inconnu", texte: "Resend · clé absente" }
    case "cle_restreinte":
      return { signe: "ko", texte: "Resend · clé limitée à l'envoi" }
    case "refuse":
      return { signe: "ko", texte: "Resend · refusé" }
    case "introuvable":
      return { signe: "ko", texte: "Resend · domaine sur un autre compte" }
    case "injoignable":
      return { signe: "inconnu", texte: "Resend · injoignable" }
    case "ok":
      return {
        signe: SIGNE_DU_STATUT[resultat.statut] ?? "inconnu",
        // Le compte des lignes que `resendDomain` n'a pas su typer. Zéro
        // aujourd'hui — Resend n'émet que MX, TXT et CNAME. Le jour où il
        // en ajoute un, l'absence de cette ligne du tableau se voit ici
        // plutôt que de manquer en silence.
        texte:
          `Resend · ${STATUTS[resultat.statut] ?? resultat.statut}` +
          (resultat.ignores > 0
            ? ` · ${resultat.ignores} ligne${resultat.ignores > 1 ? "s" : ""} illisible${resultat.ignores > 1 ? "s" : ""}`
            : ""),
      }
  }
}

/** Les statuts de vérification que Resend publie, en français. */
const STATUTS: Record<string, string> = {
  not_started: "pas commencé",
  pending: "en attente",
  verified: "vérifié",
  failure: "échec",
  temporary_failure: "échec temporaire",
}

const SIGNE_DU_STATUT: Record<string, Signe> = {
  verified: "ok",
  failure: "ko",
}

/**
 * Les deux tableaux, du plan seul ou du plan enrichi de son verdict.
 *
 * PUR ET EXPORTÉ, SANS HOOK — c'est ici que se joue le défaut corrigé.
 * `resultat` encore `null` (avant la première vérification, ou après un
 * échec réseau) ne fait plus disparaître le tableau : `fusionnerVerdicts`
 * laisse chaque ligne à `"attente"`, et le tableau se rend quand même.
 * Aucun hook ici, donc aucun `ConvexProvider` requis pour le tester —
 * `plan` et `resultat` sont de simples valeurs, dans la même veine que
 * `FormulaireReinitialisation` (`routes/reset-password.tsx`).
 */
export function TableauxDns({
  plan,
  resultat,
  resend = null,
}: {
  plan: Plan
  resultat: Resultat | null
  /** Ce que Resend a répondu — `null` tant qu'on ne lui a rien demandé. */
  resend?: ResultatResend | null
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Deux tableaux plutôt qu'un seul : « Le site » et « Les emails »
          se corrigent chez le même hébergeur mais pour deux pannes qui
          n'ont rien à voir — le site injoignable d'un côté, les emails
          refusés de l'autre. Les lignes de Resend, elles, ne font pas un
          troisième tableau : elles décrivent la même panne que SPF, DKIM
          et DMARC, et rejoignent donc celui des emails. */}
      <TableauDns
        titre="Le site"
        lignes={fusionnerVerdicts(plan.site, resultat?.site ?? null)}
      />
      <TableauDns
        titre="Les emails"
        etat={
          resend === null ? null : <Etiquette {...etiquetteResend(resend)} />
        }
        lignes={fusionnerVerdicts(
          fusionnerResend(
            plan.email,
            resend?.etat === "ok" ? resend.enregistrements : []
          ),
          resultat?.email ?? null
        )}
      />
    </div>
  )
}

/**
 * Les trois appels sortants, leur état, et pour quel hôte.
 *
 * Un hook plutôt qu'un état interne au composant d'affichage : le verrou du
 * bouton d'enregistrement vit dans `DomaineForm`, et il lui faut la même
 * lecture. La descendre en prop depuis là est ce qui garantit que le
 * tableau et le bouton parlent du même moment.
 */
function useVerification(domaineEnregistre: string | null) {
  const checkSite = useAction(api.dns.checkSite)
  const checkEmail = useAction(api.dns.checkEmail)
  const declarerChezResend = useAction(api.resendDomain.declarer)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [lecture, setLecture] = useState<Lecture | null>(null)

  async function verifier(hote: string) {
    setEnCours(true)
    setErreur(null)
    try {
      // Les trois ensemble : elles sont indépendantes, et les enchaîner
      // ferait attendre trois fois le délai d'attente.
      const [site, email, resend] = await Promise.all([
        checkSite({ domaine: hote }),
        checkEmail({ domaine: hote }),
        // La déclaration chez Resend ne doit PAS pouvoir emporter la
        // lecture DNS : c'est elle qui décide du bouton d'enregistrement,
        // et une panne côté Resend n'a rien à dire sur les A. `declarer`
        // rend déjà ses propres refus comme des réponses ordinaires ; il
        // ne reste ici que ce qui lève vraiment.
        declarerChezResend({ domaine: hote }).catch(
          (): ResultatResend => ({ etat: "injoignable" })
        ),
      ])
      setLecture({ hote, site, email, resend })
    } catch (err) {
      setErreur(describeSettingsError(err))
    } finally {
      setEnCours(false)
    }
  }

  // Une fois au montage, et à chaque changement du domaine ENREGISTRÉ —
  // jamais à chaque rendu, et jamais à la frappe. C'est ce qui remplit la
  // colonne d'état d'un déploiement déjà configuré sans réémettre les
  // requêtes sortantes à chaque caractère tapé dans le champ.
  useEffect(() => {
    if (domaineEnregistre !== null) void verifier(domaineEnregistre)
    // `verifier` ferme sur les trois actions, stables d'un rendu à l'autre
    // (`useAction` les mémoïse) : les lister ici ne changerait rien à quand
    // l'effet se relance, et les omettre est le point — seul le domaine
    // enregistré doit déclencher une nouvelle vérification.
  }, [domaineEnregistre])

  return { lecture, enCours, erreur, verifier }
}

function VerificationDns({
  cible,
  lecture,
  etatA,
  enCours,
  erreur,
  onVerifier,
}: {
  cible: string | null
  lecture: Lecture | null
  etatA: { signe: Signe; texte: string } | null
  enCours: boolean
  erreur: string | null
  onVerifier: (hote: string) => void
}) {
  // Le plan suit le CHAMP, pas le domaine enregistré : c'est une query,
  // elle ne sort pas du déploiement, et c'est ce qui fait que le tableau
  // est déjà là quand on décide quoi créer. `"skip"` tant que la saisie
  // n'est pas un hôte — `dns.plan` refuserait le reste.
  const plan = useQuery(api.dns.plan, cible === null ? "skip" : { domaine: cible })

  return (
    <div className="flex flex-col gap-4">
      {/* L'état À CÔTÉ du bouton qui le fait changer : lire le DNS est le
          geste qui arme l'enregistrement, et les deux se regardent. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          disabled={cible === null || enCours}
          onClick={() => {
            if (cible !== null) onVerifier(cible)
          }}
        >
          {enCours
            ? "Lecture du DNS…"
            : cible === null
              ? "Vérifier"
              : lecture === null
                ? `Vérifier ${cible}`
                : `Revérifier ${cible}`}
        </Button>
        {etatA !== null ? <Etiquette {...etatA} /> : null}
      </div>

      {erreur !== null ? (
        <p className="text-sm text-destructive">{erreur}</p>
      ) : null}

      {/* Le tableau tient du plan seul, dès qu'il est chargé — pas besoin
          d'attendre `lecture` : c'est le défaut de fond que cet écran
          corrige. */}
      {plan !== undefined ? (
        <TableauxDns
          plan={plan}
          resultat={lecture}
          resend={lecture?.resend ?? null}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// LES CINQ ENDROITS OÙ UN DOMAINE SE CHANGEAIT — RETIRÉS DE L'ÉCRAN, PUIS
// LARGEMENT SUPPRIMÉS TOUT COURT.
//
// Cet écran portait une liste ordonnée de cinq étapes, sous le titre
// « Changer de domaine se fait en cinq endroits, et aucun n'est cet
// écran ». Elle a été supprimée sur consigne, sans rien pour la
// remplacer : une procédure manuelle affichée dans une interface n'est pas
// de la documentation, c'est l'aveu que l'écran ne fait pas son travail.
// ELLE NE REVIENT PAS, sous aucune forme.
//
// Le correctif qu'annonçait ce commentaire — « faire suivre
// automatiquement ce qui peut l'être » — a depuis été fait, et le
// commentaire ne l'avait pas suivi. Ce qui reste de la liste, à jour :
//
//   1. Les enregistrements DNS chez l'hébergeur. Toujours manuels, et
//      assumés tels quels : les automatiser demanderait les identifiants
//      du fournisseur DNS de l'adoptant. C'est ce que le tableau ci-dessus
//      lit, et ce que le verrou du bouton exige avant d'enregistrer.
//   2. `WEB_DOMAIN` et `ADMIN_DOMAIN` ne sont plus que le REPLI, celui qui
//      vaut tant que rien n'est déclaré ici — et le service `routeur` les
//      lit sur le déploiement CONVEX, pas dans `docker/.env`. Traefik
//      prend ses règles de routage dans un fichier que ce service réécrit
//      (`58911a4`), plus dans des labels Docker.
//   3. Reconstruire l'image du DASHBOARD, et elle seule, pour
//      `VITE_WEB_SITE_URL` : les liens d'aperçu en partent, et une `VITE_*`
//      est figée au build. Le site public, lui, n'a plus rien à
//      reconstruire — c'est tout le sens de `e091a82` : `astro.config.ts`
//      ne porte plus `security.allowedDomains`, et la reconnaissance de
//      l'hôte se fait au runtime depuis `routing.hotes`
//      (`apps/web/src/lib/allowedDomains.ts`). C'est cette phrase-là qui
//      était fausse ici, et elle l'était dans le sens le plus coûteux :
//      elle envoyait reconstruire une image pour rien.
//   4. `SITE_URL` et `WEB_SITE_URL` sur le déploiement Convex : plus
//      nécessaires. `lib/origines.ts` dérive les deux origines du domaine
//      déclaré et ne retombe sur l'environnement que faute de déclaration
//      (`241e9bf`).
//   5. Le domaine d'expédition chez Resend : cet écran le déclare
//      lui-même, et ses enregistrements prennent des lignes du tableau
//      « Les emails » (`resendDomain.declarer`, `6c0b8cb`).
//
// LES DEUX LIGNES D'ÉTAT (« Liens des emails », « Site construit pour »)
// qui rendaient visibles deux de ces pannes ont été retirées sur consigne
// explicite, répétée deux fois. Elles n'ont plus d'objet : les deux
// valeurs qu'elles comparaient dérivent maintenant du même domaine
// déclaré.
// ---------------------------------------------------------------------
