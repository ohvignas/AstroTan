import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { CleEmail } from "@astrotan/backend/convex/lib/catalogueEmails"
import { describeSettingsError } from "@/lib/settingsErrors"
import {
  BandeauModeEssai,
  ChampAdresseExpedition,
  EditeurGabarit,
  ListeEmails,
  OrigineDesLiens,
  SectionCleResend,
  gabaritEnCoursModifie,
  validationLocale,
} from "@/components/email-templates"
import type { EmailAffiche } from "@/components/email-templates"
import { useAutoSave } from "@/components/save-bar"
import { SettingsGroup } from "@/components/settings-nav"
import {
  SettingsFormShell,
  SettingsLoading,
  useSecretsAccess,
} from "@/components/settings-page"
import { useUnsavedChangesGuard } from "@/components/unsaved-changes-guard"

export const Route = createFileRoute("/_authed/settings/emails")({
  component: EmailsRoute,
})

type Settings = FunctionReturnType<typeof api.settings.getPrivate>

// ---------------------------------------------------------------------
// L'écran qui répond à « mettre l'API et l'adresse email, et voir tout ce
// qui va s'envoyer ».
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
      adminUrl={environment.adminUrl}
      secrets={secrets}
      emails={emails ?? []}
      canWrite={canWrite}
    />
  )
}

function EmailsForm({
  settings,
  testMode,
  resendConfigure,
  adminUrl,
  secrets,
  emails,
  canWrite,
}: {
  settings: Settings
  testMode: boolean
  resendConfigure: boolean
  adminUrl: string | null
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
      {/* En tête, et avant tout le reste : tant que le mode d'essai tient,
          rien de ce qui se règle en dessous ne produit d'email reçu. */}
      <BandeauModeEssai actif={testMode} />

      {secrets === undefined ? null : (
        <SectionCleResend
          secrets={secrets}
          resend={{ configured: resendConfigure }}
        />
      )}

      <SettingsGroup title="L'adresse d'expédition">
        <ChampAdresseExpedition
          valeur={emailFrom}
          canWrite={canWrite}
          onChange={setEmailFrom}
          lienDomaine={
            // `<Link>` et non `<a href>` : c'est une vraie navigation, et
            // le routeur doit la voir pour que le garde-fou de
            // modifications non enregistrées puisse la retenir.
            <Link to="/settings/domaine" className="underline">
              Domaine &amp; emails
            </Link>
          }
        />
        <OrigineDesLiens adminUrl={adminUrl} />
      </SettingsGroup>

      {canWrite ? (
        <ListeEmailsConnectee emails={emails} />
      ) : (
        <SettingsGroup title="Ce que ce site envoie">
          <p className="text-sm text-muted-foreground">
            La liste des emails, leurs textes et leurs interrupteurs sont
            réservés au propriétaire et aux administrateurs : le texte d'une
            invitation décide de ce que lit une personne à qui on ouvre
            l'administration.
          </p>
        </SettingsGroup>
      )}
    </SettingsFormShell>
  )
}

// ---------------------------------------------------------------------
// La liste, ses interrupteurs, et l'éditeur ouvert
// ---------------------------------------------------------------------

/**
 * L'état d'édition vit ICI, pas dans `ListeEmails`.
 *
 * Un seul gabarit s'édite à la fois, et c'est voulu : deux panneaux
 * ouverts sur deux textes en cours, avec un seul bouton d'enregistrement
 * chacun, est la forme la plus sûre de perdre l'un des deux.
 *
 * L'éditeur ne passe PAS par la barre d'enregistrement de la page : celle-ci
 * appelle `settings.update`, et un gabarit s'écrit par `emails.setTemplate`.
 * Les mêler ferait d'un clic sur « Enregistrer » deux mutations dont une
 * seule est visible dans le libellé.
 *
 * SON PROPRE GARDE-FOU DE SORTIE, ET NON UNE EXTENSION DE
 * `SettingsFormShell`.
 *
 * `SettingsFormShell` calcule son `dirty` à partir d'un seul `autoSave`
 * (ici celui d'`emailFrom`) : lui faire aussi surveiller le texte d'un
 * gabarit demanderait de faire remonter `objet`/`corps` — un état qui n'a
 * de sens QUE pendant que ce panneau précis est ouvert — jusqu'à un
 * composant qui n'a par ailleurs aucune raison de connaître l'existence
 * d'un éditeur de gabarit. Le shell aurait alors deux raisons de refuser
 * de quitter, à fusionner dans une seule phrase (« quel `unsavedLabel »
 * lire ? »), pour un couplage qui n'apporte rien : les deux formulaires
 * s'enregistrent déjà par deux mutations distinctes et ne partagent aucun
 * état.
 *
 * Un garde-fou LOCAL, posé ici où vit l'état `objet`/`corps`, colle au
 * cycle de vie réel du panneau : `dirty` ne s'arme que pendant qu'un
 * éditeur est ouvert ET modifié, et retombe tout seul à sa fermeture — pas
 * de prop à faire voyager, pas de contrat à étendre. `useBlocker`
 * (`unsaved-changes-guard.tsx`) accepte plusieurs blocages enregistrés en
 * parallèle : celui-ci et celui de `SettingsFormShell` coexistent sans se
 * marcher dessus, chacun avec sa propre phrase.
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
   * Ce que l'éditeur montre à l'ouverture.
   *
   * `enregistre` d'abord, MÊME invalide : c'est le texte qu'on demande de
   * réparer. L'ouvrir sur le texte par défaut afficherait « votre texte
   * n'est plus valide » en face d'un texte qui, lui, l'est — et le
   * travail à corriger serait devenu invisible.
   */
  function ouvrir(email: EmailAffiche) {
    if (ouverte === email.cle) {
      setOuverte(null)
      return
    }
    setOuverte(email.cle)
    setObjet(email.enregistre?.objet ?? email.objet)
    setCorps(email.enregistre?.corps ?? email.corps)
    setEnregistrement("repos")
    setErreurServeur(null)
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-snug font-medium">
          Ce que ce site envoie
        </h2>
        <p className="text-sm text-muted-foreground">
          La liste complète, telle que le code la déclare
          (<code className="text-xs">convex/lib/catalogueEmails.ts</code>) :
          un envoi qui n'y figure pas n'existe pas. Better Auth n'en émet
          aucun de son côté — ni vérification d'adresse, ni réinitialisation
          de mot de passe.
        </p>
        <p className="text-sm text-muted-foreground">
          {/* Pas un champ, et c'en aurait été un mauvais : une liste
              d'adresses saisie à la main survit aux départs, aux
              suspensions et aux changements de rôle — l'inverse de ce
              qu'on attend d'une alerte interne. */}
          Aucune liste de destinataires ne se saisit ici : les notifications
          partent aux comptes <strong>propriétaire</strong> et{" "}
          <strong>administrateur</strong> non suspendus, et cela se règle
          depuis l'écran Utilisateurs, en donnant ou en retirant un rôle.
        </p>
      </div>

      {erreurListe === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {erreurListe}
        </p>
      )}

      <ListeEmails
        emails={emails}
        cleOuverte={ouverte}
        onToggle={(cle, actif) => void basculer(cle, actif)}
        onModifier={(cle) => {
          const email = emails.find((candidat) => candidat.cle === cle)
          if (email !== undefined) ouvrir(email)
        }}
        editeur={(email) => (
          <EditeurGabarit
            email={email}
            objet={objet}
            corps={corps}
            // LE point de l'exigence : le refus est calculé à la frappe et
            // affiché à côté du champ, pas découvert après le clic.
            erreur={validationLocale(email, objet, corps)}
            erreurServeur={erreurServeur}
            // `email` ici est toujours l'email ouvert : `ListeEmails` n'appelle
            // ce callback que pour la carte dont `cleOuverte === email.cle`,
            // donc `gabaritModifie` (calculé plus haut depuis `emailOuvert`)
            // porte exactement la même valeur.
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
                  // Le panneau se referme : la carte affiche alors
                  // « Texte personnalisé » et la date, ce qui est
                  // l'accusé de réception.
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
      {guardDialog}
    </div>
  )
}
