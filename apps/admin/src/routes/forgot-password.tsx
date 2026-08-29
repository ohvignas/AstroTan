import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// Hors de `_authed`, comme `accept-invite.tsx` et pour la même raison :
// quelqu'un qui a perdu son mot de passe n'a pas de session, et `_authed`
// le renverrait vers `/login` — c'est-à-dire vers le problème qu'il vient
// de rencontrer.
//
// LA RÈGLE DE CET ÉCRAN, et c'est la seule : la page dit exactement la
// même chose pour une adresse qui a un compte et pour une adresse qui n'en
// a pas. Tout le chemin serveur est construit pour ça — `/request-
// password-reset` répond 200 dans les deux cas et simule même la
// génération du jeton pour égaliser les temps, `passwordReset.envoyer`
// refuse en silence un compte suspendu, et le seau de débit compte
// l'adresse REVENDIQUÉE sans jamais chercher si elle existe. Une phrase
// affirmative ici (« un email vous a été envoyé ») annulerait tout cela :
// elle confirmerait l'existence du compte à quiconque tape une adresse au
// hasard. D'où le conditionnel, qui n'est pas une précaution de style.
export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  // L'adresse soumise, une fois la demande partie — `null` tant qu'elle ne
  // l'est pas. Elle n'est gardée que pour être réaffichée : c'est ce qui
  // permet de repérer une faute de frappe dans sa propre adresse.
  const [demandePour, setDemandePour] = useState<string | null>(null)

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-4">
        {demandePour === null ? (
          <FormulaireDemande onEnvoye={setDemandePour} />
        ) : (
          <ConfirmationDemande email={demandePour} />
        )}
        <Link
          to="/login"
          className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Retour à la connexion
        </Link>
      </div>
    </div>
  )
}

/**
 * La seule chose que cette page affiche après un envoi, quelle que soit
 * l'adresse et quel qu'ait été le sort réel de la demande.
 *
 * Exportée pour être rendue seule dans le test : c'est la phrase qui porte
 * la garantie, et elle doit pouvoir être vérifiée sans monter la page.
 */
export function ConfirmationDemande({ email }: { email: string }) {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Demande envoyée</CardTitle>
        <CardDescription>
          Si un compte existe avec{" "}
          <span className="font-medium text-foreground">{email}</span>, vous
          recevrez un lien pour choisir un nouveau mot de passe.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

// Grossièrement la forme que `z.email()` accepte côté serveur. Sert à
// désactiver le bouton, pas à valider : le but est qu'une saisie
// manifestement incomplète ne parte pas se faire refuser par un 400 qui,
// lui, se confondrait avec les refus qu'on doit taire (voir
// `panneDeTransport` ci-dessous).
const FORME_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Ce qui a le droit de s'afficher comme une erreur — et rien d'autre.
 *
 * Une panne de transport n'est pas un refus métier : elle ne dit rien de
 * l'adresse saisie, et la taire enverrait quelqu'un attendre un email qui
 * n'est jamais parti. Tout le reste (un 400, un 403, un refus quelconque
 * de la route) retombe sur la confirmation commune, parce que distinguer
 * ces cas-là, c'est répondre à la question « est-ce que ce compte
 * existe ? ».
 *
 * Le 429 est nommé pour la même raison que `SIGN_IN_RATE_LIMITED` l'est
 * dans `login-form.tsx`, et il ne fait pas exception à la règle : la clé
 * du seau est bâtie sur l'adresse REVENDIQUÉE, sans aucune recherche de
 * compte (`lib/passwordResetRateLimit.ts` s'en explique longuement), donc
 * une adresse inconnue et une adresse réelle atteignent la limite au même
 * rythme.
 */
function panneDeTransport(
  error: { code?: string; status?: number } | null | undefined
): string | null {
  if (!error) return null
  if (error.status === 429) {
    return "Trop de demandes pour cette adresse. Réessayez plus tard."
  }
  if (error.status === undefined || error.status >= 500) {
    return "Impossible de contacter le serveur. Réessayez dans un instant."
  }
  return null
}

export function FormulaireDemande({
  onEnvoye,
}: {
  onEnvoye: (email: string) => void
}) {
  const [email, setEmail] = useState("")
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const adresse = email.trim()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErreur(null)
    setEnvoi(true)

    // `redirectTo` est l'origine courante, jamais une valeur configurée :
    // c'est l'unique origine dont on soit sûr qu'elle sert bien cette
    // administration-ci. Better Auth la soumet à son `originCheck` (elle
    // doit donc correspondre à `SITE_URL`, la `baseURL` du déploiement),
    // et ne s'en sert que pour bâtir l'URL qu'il passe à
    // `sendResetPassword`. Celle du dépôt ne l'utilise pas — elle bâtit le
    // lien depuis `SITE_URL` (voir `auth.ts`) — mais l'omettre laisserait
    // ce paramètre vide le jour où ce choix-là changerait.
    const result = await authClient.requestPasswordReset({
      email: adresse,
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setEnvoi(false)

    const panne = panneDeTransport(result.error)
    if (panne !== null) {
      setErreur(panne)
      return
    }
    onEnvoye(adresse)
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Mot de passe oublié</CardTitle>
        <CardDescription>
          Nous vous enverrons un lien pour en choisir un nouveau.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            {erreur && <FieldError>{erreur}</FieldError>}
            <Field>
              <Button
                type="submit"
                disabled={envoi || !FORME_EMAIL.test(adresse)}
              >
                {envoi ? "Envoi…" : "Envoyer le lien"}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
