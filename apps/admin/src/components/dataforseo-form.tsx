import { useState } from "react"
import type { DataForSeoIssue } from "@astrotan/backend/convex/lib/dataforseo"
import { ExternalLinkIcon, LoaderIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { FeedbackDataForSeo } from "@/components/dataforseo-verdict"

// ---------------------------------------------------------------------
// Les identifiants DataForSEO.
//
// CE QUI A CASSÉ, et qui explique la forme de ce fichier : le login était
// traité comme un secret. Le champ arrivait donc masqué — douze points —
// et le bouton exigeait que les deux champs soient retapés pour se
// réactiver. Un déploiement où le login était rangé sans mot de passe
// laissait donc un « Enregistrer » définitivement grisé, sans rien dire :
// impossible d'essayer la connexion sans deviner qu'il fallait d'abord
// effacer un masque invisible dans un champ `type="password"`.
//
// Deux corrections, et elles vont ensemble :
//
//   1. **le login est lisible et réaffiché** (`dataforseo.identifiants`).
//      C'est une adresse e-mail de compte API, que DataForSEO montre dans
//      son propre tableau de bord — la masquer ne protégeait rien et
//      coûtait la relecture ;
//   2. **un mot de passe laissé vide reprend celui qui est rangé**
//      (`dataforseo.enregistrer`). C'est ce qui fait du bouton un vrai
//      bouton d'essai : le serveur détient déjà le secret, et l'écran ne
//      peut pas le préremplir sans le faire sortir.
//
// Le mot de passe, lui, ne se réaffiche jamais — ni entier, ni en
// fragment. `passwordPose` est tout ce qui traverse le réseau à son sujet.
// ---------------------------------------------------------------------

export function DataForSeoForm({
  canWrite,
  login: loginRange,
  passwordPose,
  branche = false,
  onEnregistrer,
  onEffacer,
}: {
  canWrite: boolean
  /** Le login déjà rangé, relu en clair — `null` quand il n'y en a pas. */
  login: string | null
  /** Un mot de passe est rangé. Sa valeur, elle, ne sort jamais. */
  passwordPose: boolean
  branche?: boolean
  onEnregistrer: (login: string, password: string) => Promise<{ verdict: DataForSeoIssue }>
  onEffacer: () => Promise<void>
}) {
  const [login, setLogin] = useState(loginRange ?? "")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState<"repos" | "save" | "clear">("repos")
  const [verdict, setVerdict] = useState<DataForSeoIssue | null>(null)

  // Un essai est possible dès qu'il y a un login ET un mot de passe à
  // présenter — saisi maintenant, ou déjà rangé côté serveur.
  const pret = login.trim() !== "" && (password.trim() !== "" || passwordPose)
  const peutEffacer = loginRange !== null || passwordPose
  const dejaBranche = branche || (loginRange !== null && passwordPose)
  const erreur = verdict !== null && verdict !== "valide"
  const montreConnecte = !erreur && (dejaBranche || verdict === "valide")

  async function enregistrer() {
    setBusy("save")
    setVerdict(null)
    try {
      const rendu = await onEnregistrer(login.trim(), password.trim())
      setVerdict(rendu.verdict)
      // Le champ se vide même après un succès : le mot de passe est rangé,
      // et le laisser à l'écran ferait croire qu'il faut le retaper à
      // chaque essai.
      if (rendu.verdict === "valide") setPassword("")
    } catch {
      setVerdict("injoignable")
    } finally {
      setBusy("repos")
    }
  }

  async function effacer() {
    setBusy("clear")
    setVerdict(null)
    try {
      await onEffacer()
      setLogin("")
      setPassword("")
    } finally {
      setBusy("repos")
    }
  }

  if (!canWrite) return null

  // `gap-4`, le rythme d'un groupe de réglages — celui qui sépare deux
  // `Field` sur Identité. C'était `gap-6`, plus large que les 16 px qui
  // séparent deux GROUPES entiers, si bien que le bouton et le lien
  // flottaient à la même distance des champs que les champs entre eux :
  // aucune hiérarchie ne se lisait dans l'espace.
  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="dataforseo-login">
          Identifiant{" "}
          <code className="ml-1 text-xs font-normal text-muted-foreground">
            DATAFORSEO_LOGIN
          </code>
        </FieldLabel>
        <Input
          id="dataforseo-login"
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="compte@exemple.fr"
          value={login}
          disabled={busy !== "repos"}
          onChange={(event) => {
            setLogin(event.target.value)
            setVerdict(null)
          }}
        />
        <FieldDescription>
          L&apos;adresse e-mail du compte DataForSEO. Elle n&apos;est pas
          secrète et reste lisible ici.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="dataforseo-password">
          Mot de passe d&apos;API{" "}
          <code className="ml-1 text-xs font-normal text-muted-foreground">
            DATAFORSEO_PASSWORD
          </code>
        </FieldLabel>
        <Input
          id="dataforseo-password"
          type="password"
          // Le navigateur ne doit ni proposer, ni retenir une clé d'API.
          autoComplete="off"
          placeholder={passwordPose ? "******" : "Coller le mot de passe"}
          value={password}
          disabled={busy !== "repos"}
          onChange={(event) => {
            setPassword(event.target.value)
            setVerdict(null)
          }}
        />
        {/* Le lien vit DANS l'aide du champ qu'il sert, comme celui
            d'openrouter.ai/keys sur IA. Il était un frère du formulaire,
            à égale distance des deux champs et du bouton : rien ne disait
            plus qu'il répondait à « où trouver ce mot de passe ». */}
        <FieldDescription>
          {passwordPose
            ? "Déjà enregistré. Pour seulement vérifier la connexion, laissez-le vide."
            : "Le mot de passe d'API, et non celui du compte : il se copie depuis la page API access."}{" "}
          <a
            href="https://app.dataforseo.com/api-access"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            app.dataforseo.com/api-access
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
          </a>
        </FieldDescription>
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="w-fit cursor-pointer"
          disabled={!pret || busy !== "repos"}
          aria-busy={busy === "save"}
          onClick={() => void enregistrer()}
        >
          {busy === "save" ? (
            <>
              <LoaderIcon aria-hidden="true" className="size-4 animate-spin" />
              Enregistrement…
            </>
          ) : (
            "Enregistrer"
          )}
        </Button>
        {montreConnecte ? (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">
            Connecté
          </span>
        ) : null}
        {erreur ? <FeedbackDataForSeo verdict={verdict} /> : null}
      </div>

      {peutEffacer ? (
        <button
          type="button"
          className="w-fit cursor-pointer text-xs text-muted-foreground underline"
          disabled={busy !== "repos"}
          onClick={() => void effacer()}
        >
          Effacer
        </button>
      ) : null}
    </div>
  )
}
