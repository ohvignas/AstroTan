import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_SCORE,
  scorePassword,
} from "@astrotan/backend/convex/lib/passwordStrength"
import { Eye, EyeOff } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { PasswordStrengthMeter } from "@/components/password-strength-meter"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// Hors de `_authed`, même position qu'`accept-invite.tsx` : le jeton reçu
// par email EST l'autorisation, il n'y a pas de session derrière.
//
// Les bornes affichées plus bas sont LUES dans
// `lib/passwordStrength.ts` — le module que le serveur applique
// réellement, à travers `minPasswordLength`/`maxPasswordLength` d'`auth.ts`
// et le `hooks.before` qui y ajoute `MIN_PASSWORD_SCORE`. Les recopier à
// l'écran donnerait deux vérités : « 8 caractères minimum » affiché d'un
// côté, un refus inexpliqué de l'autre, le jour où la constante bouge.
export const Route = createFileRoute("/reset-password")({
  // Même forme que la `validateSearch` d'`accept-invite.tsx`, et pour la
  // même raison (pas de zod dans cette application) : ce qui n'est pas une
  // chaîne devient `undefined`, donc la carte « lien expiré », plutôt
  // qu'une exception plus bas dans l'arbre.
  //
  // `error` existe parce que c'est ce que Better Auth ajoute à l'URL quand
  // le jeton est invalide ou expiré (`?error=INVALID_TOKEN`, posé par sa
  // route de redirection `/reset-password/:token`). L'email de ce dépôt
  // pointe directement ici, sans passer par elle, mais un lien bâti
  // autrement — une version antérieure, un client tiers — atterrirait sur
  // cette page avec ce paramètre et sans jeton.
  validateSearch: (
    search: Record<string, unknown>
  ): { token?: string; error?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: ResetPasswordPage,
})

const CHEMIN_DEMANDE = "/forgot-password"
const CHEMIN_CONNEXION = "/login"

function ResetPasswordPage() {
  const { token, error } = Route.useSearch()

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        {token === undefined || error !== undefined ? (
          <ReinitialisationInvalide />
        ) : (
          <FormulaireReinitialisation token={token} />
        )}
      </div>
    </div>
  )
}

// `<a>` et non `<Link>` dans les deux cartes ci-dessous : `<Link>` exige un
// routeur monté, ce qui les rendrait intestables seules (même constat que
// `settings-nav.test.tsx`), et un rechargement complet est justement ce
// qu'on veut en quittant cette page-ci — son URL porte un jeton mort, et la
// session vient d'être révoquée côté serveur pour tous les appareils.

/**
 * Le cul-de-sac : jeton absent, invalide ou expiré. Les trois se
 * confondent volontairement — le serveur rend `INVALID_TOKEN` pour tous, et
 * les distinguer ici reviendrait à dire à un inconnu lequel de ses essais
 * a désigné un vrai jeton.
 *
 * Ne reproche rien : un lien qui a passé une heure dans une boîte mail
 * n'est la faute de personne. Dit quoi faire, et rien sur le pourquoi.
 */
export function ReinitialisationInvalide() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Lien expiré</CardTitle>
        <CardDescription>
          Ce lien de réinitialisation n'est plus valide.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button render={<a href={CHEMIN_DEMANDE} />} nativeButton={false}>
          Demander un nouveau lien
        </Button>
      </CardContent>
    </Card>
  )
}

export function ReinitialisationReussie() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Mot de passe modifié</CardTitle>
        {/* La déconnexion des autres appareils est dite parce qu'elle se
            constate : `revokeSessionsOnPasswordReset` ferme les sessions
            ouvertes ailleurs, et quelqu'un qui l'ignore prendrait cela
            pour une panne. */}
        <CardDescription>
          Connectez-vous avec le nouveau. Vos autres appareils ont été
          déconnectés.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button render={<a href={CHEMIN_CONNEXION} />} nativeButton={false}>
          Aller à la connexion
        </Button>
      </CardContent>
    </Card>
  )
}

// Les trois refus que `/reset-password` peut rendre sur un jeton valide.
// `INVALID_TOKEN` n'y figure pas : il ne se raconte pas dans le
// formulaire, il le remplace par la carte ci-dessus.
//
// `WEAK_PASSWORD` vient du `hooks.before` d'`auth.ts`, pas de Better Auth :
// la route ne contrôle d'elle-même que la longueur, et le dépôt y ajoute
// `MIN_PASSWORD_SCORE` pour que la récupération ne soit pas plus permissive
// que la création de compte. Il reste atteignable malgré la jauge
// ci-dessous, qui score sans adresse : le serveur, lui, score contre celle
// du compte que le jeton désigne, et pénalise un mot de passe qui en
// dérive.
const MESSAGES_REFUS: Record<string, string> = {
  WEAK_PASSWORD:
    "Ce mot de passe est trop faible. Choisissez-en un plus long ou plus varié.",
  PASSWORD_TOO_SHORT: `Il faut au moins ${MIN_PASSWORD_LENGTH} caractères.`,
  PASSWORD_TOO_LONG: `${MAX_PASSWORD_LENGTH} caractères au maximum.`,
}

function decrireRefus(error: {
  code?: string
  status?: number
  message?: string | null
}): string {
  if (error.code !== undefined && MESSAGES_REFUS[error.code]) {
    return MESSAGES_REFUS[error.code]!
  }
  if (error.status === undefined || error.status >= 500) {
    return "Impossible de contacter le serveur. Réessayez dans un instant."
  }
  return "Une erreur inattendue est survenue."
}

export function FormulaireReinitialisation({ token }: { token: string }) {
  const [motDePasse, setMotDePasse] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [visible, setVisible] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  // Le jeton a été refusé à la soumission : consommé ailleurs, ou expiré
  // pendant que le formulaire était ouvert. Le même cul-de-sac que celui
  // d'un lien mort, parce que c'est la même situation.
  const [jetonRefuse, setJetonRefuse] = useState(false)
  const [termine, setTermine] = useState(false)

  // Scoré sans adresse : ce formulaire ne connaît pas celle du compte, et
  // le jeton ne la révèle pas. La jauge peut donc être un cran plus
  // indulgente que le serveur — d'où `WEAK_PASSWORD` dans les refus
  // ci-dessus, qui n'est pas du code mort.
  const force = scorePassword(motDePasse)
  const discordance = confirmation.length > 0 && confirmation !== motDePasse
  const peutSoumettre =
    force.score >= MIN_PASSWORD_SCORE && confirmation === motDePasse

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErreur(null)
    setEnvoi(true)

    const result = await authClient.resetPassword({
      newPassword: motDePasse,
      token,
    })
    setEnvoi(false)

    if (result.error) {
      if (result.error.code === "INVALID_TOKEN") {
        setJetonRefuse(true)
        return
      }
      setErreur(decrireRefus(result.error))
      return
    }
    setTermine(true)
  }

  if (jetonRefuse) return <ReinitialisationInvalide />
  if (termine) return <ReinitialisationReussie />

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Nouveau mot de passe</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="reset-password">Mot de passe</FieldLabel>
                {/* Un seul bouton pour les deux champs, comme dans
                    `accept-invite.tsx` : ils doivent être identiques, donc
                    n'en révéler qu'un n'aide contre aucune des deux
                    fautes de frappe. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-my-1 h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
                  onClick={() => setVisible((montre) => !montre)}
                >
                  {visible ? (
                    <EyeOff aria-hidden className="size-3.5" />
                  ) : (
                    <Eye aria-hidden className="size-3.5" />
                  )}
                  {visible ? "Masquer" : "Afficher"}
                </Button>
              </div>
              <Input
                id="reset-password"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                required
                aria-describedby="reset-password-strength"
                value={motDePasse}
                onChange={(event) => setMotDePasse(event.target.value)}
              />
              {motDePasse.length > 0 ? (
                <PasswordStrengthMeter
                  id="reset-password-strength"
                  strength={force}
                />
              ) : (
                <FieldDescription id="reset-password-strength">
                  Entre {MIN_PASSWORD_LENGTH} et {MAX_PASSWORD_LENGTH}{" "}
                  caractères.
                </FieldDescription>
              )}
            </Field>

            <Field data-invalid={discordance ? true : undefined}>
              <FieldLabel htmlFor="reset-confirmation">Confirmer</FieldLabel>
              <Input
                id="reset-confirmation"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                required
                aria-invalid={discordance}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              {discordance && (
                <FieldError>
                  Les deux mots de passe ne sont pas identiques.
                </FieldError>
              )}
            </Field>

            {erreur && <FieldError>{erreur}</FieldError>}
            <Field>
              <Button type="submit" disabled={envoi || !peutSoumettre}>
                {envoi ? "Enregistrement…" : "Changer le mot de passe"}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
