import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { CleEmail } from "@astrotan/backend/convex/lib/catalogueEmails"
import { describeSettingsError } from "@/lib/settingsErrors"
import {
  ChampAdresseExpedition,
  EditeurGabarit,
  EtatEnvoi,
  ListeEmails,
  SectionCleResend,
  actionSurLigne,
  gabaritEnCoursModifie,
  validationLocale,
} from "@/components/email-templates"
import type { ActionLigne, EmailAffiche } from "@/components/email-templates"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSecretsAccess,
} from "@/components/settings-page"
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-guard"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export const Route = createFileRoute("/_authed/settings/emails")({
  component: EmailsRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>

// ---------------------------------------------------------------------
// L'écran qui répond à trois questions, dans cet ordre, et à rien d'autre :
//
//   1. est-ce que ça peut partir ?    → `EtatEnvoi` + la clé Resend
//   2. de la part de qui ?            → l'adresse d'expédition
//   3. qu'est-ce qui part ?           → l'accordéon des emails
//
// TROIS SOURCES, et aucune ne dit ce que disent les autres :
//
//   • `secrets.status` — ce qui est rangé EN BASE, chiffré ;
//   • `settings.environment` — ce que porte l'ENVIRONNEMENT du déploiement,
//     en booléens (dont le mode d'essai, que rien d'autre ne sait) ;
//   • `emails.list` — le catalogue des envois, enrichi de ce que l'adoptant
//     en a changé.
//
// `emails.list` est réservée à owner/admin (le texte d'une invitation
// décide de ce que lit une personne à qui on ouvre l'administration), d'où
// le `"skip"` pour un editor — qui garde la page, sans la liste.
//
// CE QUI NE S'ENREGISTRE PAS TOUT SEUL, et pourquoi ce n'est pas une
// négligence : l'adresse d'expédition suit la règle d'`/settings/webhook`.
// `bonjour@exemple.f` est une saisie en route vers `bonjour@exemple.fr`, et
// enregistrée une seconde elle devient l'expéditeur de tout ce qui part
// pendant cette seconde. D'où `auto: {}` — la temporisation n'est jamais
// armée — et la barre au clic.
// ---------------------------------------------------------------------

function EmailsRoute() {
  const { loading, canWrite, secrets } = useSecretsAccess()
  const settings = useQuery(api.settings.getPrivate)
  const environment = useQuery(api.settings.environment)
  const emails = useQuery(api.emails.list, canWrite ? {} : "skip")

  if (loading || settings === undefined || environment === undefined) {
    return <SettingsLoading />
  }
  if (canWrite && (secrets === undefined || emails === undefined)) {
    return <SettingsLoading />
  }

  return (
    <EmailsForm
      settings={settings}
      testMode={environment.resend.testMode}
      resendConfigure={environment.resend.configured}
      secrets={secrets}
      emails={emails ?? []}
      canWrite={canWrite}
    />
  )
}

/**
 * « Aucune clé Resend », affirmé seulement quand on le SAIT.
 *
 * Deux logements possibles et indépendants : l'environnement du
 * déploiement, et la table chiffrée (`convex/secrets.ts`). Une ligne en
 * base devenue illisible — la clé maîtresse a changé — ne compte pas :
 * `lireSecret` ne la déchiffre plus, donc rien ne partira.
 *
 * Un editor n'a pas accès à `secrets.status` : `cleMaitresse` est alors
 * `null`, on ne sait rien, et on n'annonce donc pas une panne qui
 * n'existe peut-être pas.
 */
function cleResendAbsente(
  secrets: ReturnType<typeof useSecretsAccess>["secrets"],
  resendConfigure: boolean
): boolean {
  if (secrets === undefined || secrets.cleMaitresse === null) return false
  if (resendConfigure) return false
  const etat = secrets.etats["RESEND_API_KEY"]
  if (etat === undefined) return true
  return !etat.environnement && !(etat.base && !etat.illisible)
}

function EmailsForm({
  settings,
  testMode,
  resendConfigure,
  secrets,
  emails,
  canWrite,
}: {
  settings: Settings
  testMode: boolean
  resendConfigure: boolean
  secrets: ReturnType<typeof useSecretsAccess>["secrets"]
  emails: readonly EmailAffiche[]
  canWrite: boolean
}) {
  const updateSettings = useMutation(api.settings.update)
  const [emailFrom, setEmailFrom] = useState(settings?.emailFrom ?? "")

  // Chaîne vide et non `null` : `settings.update` déclare `emailFrom` en
  // `v.optional(v.string())`, et c'est le trim vide qui fait retomber
  // `choisirExpediteur` sur le bac à sable. Un `null` serait refusé par le
  // validateur avant d'atteindre le handler.
  const manualFields = { emailFrom: emailFrom.trim() }

  const autoSave = useAutoSave({
    enabled: canWrite,
    // Photo vide et constante : `snapshotChanged({}, {})` est toujours
    // faux, donc rien ne part à la frappe. Voir l'en-tête du fichier.
    auto: {},
    manual: manualFields,
    saveAuto: async () => {
      // Inatteignable par construction (`auto: {}`). Lever plutôt que ne
      // rien faire : si `useAutoSave` armait un jour quand même la
      // temporisation, l'erreur s'afficherait dans la barre au lieu
      // d'enregistrer une adresse à moitié tapée.
      throw new Error(
        "L'envoi des emails n'a aucun champ à sauvegarde automatique : cet appel ne devrait pas exister."
      )
    },
    saveAll: async ({ manual }) => {
      await updateSettings(manual)
    },
    describeError: describeSettingsError,
  })

  return (
    <SettingsFormShell
      to="/settings/emails"
      canWrite={canWrite}
      autoSave={autoSave}
      unsavedLabel="L'adresse d'expédition"
    >
      {/* Question 1, en tête et en une ligne : tant que le mode d'essai
          tient, rien de ce qui se règle en dessous ne produit un email
          reçu. */}
      <EtatEnvoi
        testMode={testMode}
        cleAbsente={cleResendAbsente(secrets, resendConfigure)}
      />

      {secrets === undefined ? null : <SectionCleResend secrets={secrets} />}

      {/* Question 2. Sans titre de groupe : le libellé du champ le porte
          déjà, et l'écrire deux fois à trois lignes d'intervalle est
          exactement le doublon que `SettingsGroup` évite ailleurs. */}
      <SettingsGroup>
        <ChampAdresseExpedition
          valeur={emailFrom}
          canWrite={canWrite}
          onChange={setEmailFrom}
          lienDomaine={
            // `<Link>` et non `<a href>` : c'est une vraie navigation, et
            // le routeur doit la voir pour que le garde-fou de
            // modifications non enregistrées puisse la retenir.
            <Link to="/settings/domaine" className="underline">
              Domaine &amp; DNS
            </Link>
          }
        />
      </SettingsGroup>

      {/* Question 3. */}
      <SettingsGroup title="Ce que ce site envoie">
        {canWrite ? (
          <ListeEmailsConnectee emails={emails} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Réservé au propriétaire et aux administrateurs.
          </p>
        )}
      </SettingsGroup>
    </SettingsFormShell>
  )
}

// ---------------------------------------------------------------------
// L'accordéon, ses interrupteurs, et la ligne dépliée
// ---------------------------------------------------------------------

/**
 * L'état d'édition vit ICI, pas dans `ListeEmails`.
 *
 * Une seule ligne dépliée à la fois, et c'est voulu : deux textes ouverts
 * côte à côte, avec un bouton d'enregistrement chacun, est la forme la plus
 * sûre de perdre l'un des deux.
 *
 * L'éditeur ne passe PAS par la barre d'enregistrement de la page : celle-ci
 * appelle `settings.update`, et un gabarit s'écrit par `emails.setTemplate`.
 * Les mêler ferait d'un clic sur « Enregistrer » deux mutations dont une
 * seule est visible dans le libellé.
 *
 * DEUX GESTES PERDENT UN TEXTE, PAS UN SEUL.
 *
 * Quitter la page — retenu par `useUnsavedChangesGuard`, qui passe par le
 * blocage du routeur. Et REPLIER la ligne, ou en ouvrir une autre : ce
 * geste-là ne traverse aucun routeur, et il rouvrait exactement le défaut
 * qu'on venait de fermer, sous une autre porte. `actionSurLigne`
 * (`email-templates.tsx`) rend la décision — « ouvrir », « replier », ou
 * « confirmer » — depuis le MÊME `gabaritEnCoursModifie` que le garde-fou
 * de navigation. Une seule règle, testée, à deux endroits.
 *
 * SON PROPRE GARDE-FOU DE SORTIE, ET NON UNE EXTENSION DE
 * `SettingsFormShell`.
 *
 * `SettingsFormShell` calcule son `dirty` à partir d'un seul `autoSave`
 * (ici celui d'`emailFrom`) : lui faire aussi surveiller le texte d'un
 * gabarit demanderait de faire remonter `objet`/`corps` — un état qui n'a
 * de sens QUE pendant que cette ligne précise est dépliée — jusqu'à un
 * composant qui n'a par ailleurs aucune raison de connaître l'existence
 * d'un éditeur de gabarit. Le shell aurait alors deux raisons de refuser
 * de quitter, à fusionner dans une seule phrase (« quel `unsavedLabel`
 * lire ? »), pour un couplage qui n'apporte rien : les deux formulaires
 * s'enregistrent déjà par deux mutations distinctes et ne partagent aucun
 * état. `useBlocker` accepte plusieurs blocages en parallèle : celui-ci et
 * celui de `SettingsFormShell` coexistent, chacun avec sa phrase.
 */
function ListeEmailsConnectee({ emails }: { emails: readonly EmailAffiche[] }) {
  const setActif = useMutation(api.emails.setActif)
  const setTemplate = useMutation(api.emails.setTemplate)
  const resetTemplate = useMutation(api.emails.resetTemplate)

  const [ouverte, setOuverte] = useState<CleEmail | null>(null)
  const [objet, setObjet] = useState("")
  const [corps, setCorps] = useState("")
  const [enregistrement, setEnregistrement] = useState<"repos" | "envoi">("repos")
  const [erreurServeur, setErreurServeur] = useState<string | null>(null)
  const [erreurListe, setErreurListe] = useState<string | null>(null)
  // Le clic mis en attente pendant qu'on demande s'il faut abandonner le
  // texte en cours. `null` : aucune question posée.
  const [aConfirmer, setAConfirmer] = useState<CleEmail | null>(null)

  const emailOuvert =
    ouverte === null ? null : (emails.find((e) => e.cle === ouverte) ?? null)
  const gabaritModifie = gabaritEnCoursModifie(emailOuvert, objet, corps)
  const guardDialog = useUnsavedChangesGuard({
    dirty: gabaritModifie,
    what:
      emailOuvert === null
        ? "Le texte du gabarit"
        : `Le texte de « ${emailOuvert.titre} »`,
  })

  /**
   * Déplier une ligne, ou la replier.
   *
   * `enregistre` d'abord, MÊME invalide : c'est le texte qu'on demande de
   * réparer. Ouvrir sur le texte par défaut afficherait « votre texte
   * n'est plus valide » en face d'un texte qui, lui, l'est — et le travail
   * à corriger serait devenu invisible.
   */
  function appliquer(action: ActionLigne, cible: CleEmail) {
    // « confirmer » n'arrive jamais ici : les deux appelants ont déjà
    // tranché la question. Le refuser explicitement évite un `as` qui
    // ferait porter la garantie au typage plutôt qu'au code.
    if (action === "confirmer") return
    if (action === "replier") {
      setOuverte(null)
      return
    }
    const email = emails.find((candidat) => candidat.cle === cible)
    if (email === undefined) return
    setOuverte(cible)
    setObjet(email.enregistre?.objet ?? email.objet)
    setCorps(email.enregistre?.corps ?? email.corps)
    setEnregistrement("repos")
    setErreurServeur(null)
  }

  function cliquer(cible: CleEmail) {
    const action = actionSurLigne({ ouverte, cible, modifie: gabaritModifie })
    if (action === "confirmer") {
      setAConfirmer(cible)
      return
    }
    appliquer(action, cible)
  }

  async function basculer(cle: CleEmail, actif: boolean) {
    setErreurListe(null)
    try {
      await setActif({ cle, actif })
    } catch (err) {
      // `EMAIL_NON_DESACTIVABLE` ne devrait jamais arriver ici —
      // l'interrupteur est inerte — mais deux onglets ouverts sur deux
      // versions du catalogue suffisent à le provoquer.
      setErreurListe(describeSettingsError(err))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {erreurListe === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {erreurListe}
        </p>
      )}

      <ListeEmails
        emails={emails}
        cleOuverte={ouverte}
        onToggle={(cle, actif) => void basculer(cle, actif)}
        onModifier={cliquer}
        editeur={(email) => (
          <EditeurGabarit
            email={email}
            objet={objet}
            corps={corps}
            // LE point de l'exigence : le refus est calculé à la frappe et
            // affiché à côté du champ, pas découvert après le clic.
            erreur={validationLocale(email, objet, corps)}
            erreurServeur={erreurServeur}
            // `email` ici est toujours l'email déplié : `ListeEmails`
            // n'appelle ce callback que pour la ligne dont
            // `cleOuverte === email.cle`, donc `gabaritModifie` porte
            // exactement la même valeur.
            modifie={gabaritModifie}
            enregistrement={enregistrement}
            onObjet={setObjet}
            onCorps={setCorps}
            onEnregistrer={() => {
              void (async () => {
                setEnregistrement("envoi")
                setErreurServeur(null)
                try {
                  await setTemplate({ cle: email.cle, objet, corps })
                  // La ligne se replie : elle affiche alors « Texte
                  // personnalisé », ce qui est l'accusé de réception.
                  setOuverte(null)
                } catch (err) {
                  setErreurServeur(describeSettingsError(err))
                } finally {
                  setEnregistrement("repos")
                }
              })()
            }}
            onReinitialiser={() => {
              void (async () => {
                setEnregistrement("envoi")
                setErreurServeur(null)
                try {
                  await resetTemplate({ cle: email.cle })
                  // Le texte du code revient à l'écran tout de suite : la
                  // ligne vient d'être effacée, et laisser l'ancien texte
                  // dans les champs laisserait croire qu'il est encore
                  // enregistré.
                  setObjet(email.objetParDefaut)
                  setCorps(email.corpsParDefaut)
                } catch (err) {
                  setErreurServeur(describeSettingsError(err))
                } finally {
                  setEnregistrement("repos")
                }
              })()
            }}
          />
        )}
      />

      {/* Le second garde-fou : replier, ou ouvrir une autre ligne. Le
          défaut penche du côté qui ne perd rien — fermer autrement que par
          un bouton (Échap, un clic dehors) veut dire « je n'avais pas
          fini », et la ligne reste dépliée. */}
      <AlertDialog
        open={aConfirmer !== null}
        onOpenChange={(open) => {
          if (!open) setAConfirmer(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Modifications non enregistrées</AlertDialogTitle>
            <AlertDialogDescription>
              {emailOuvert === null
                ? "Ce texte"
                : `Le texte de « ${emailOuvert.titre} »`}{" "}
              n&apos;a pas été enregistré. Le refermer maintenant perdrait
              cette modification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAConfirmer(null)}>
              Continuer à modifier
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const cible = aConfirmer
                setAConfirmer(null)
                if (cible === null) return
                // Rejoué sans le texte modifié : la question vient d'y
                // répondre, `actionSurLigne` rend alors « ouvrir » ou
                // « replier » selon la ligne visée.
                appliquer(
                  actionSurLigne({ ouverte, cible, modifie: false }),
                  cible
                )
              }}
            >
              Abandonner la modification
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {guardDialog}
    </div>
  )
}
