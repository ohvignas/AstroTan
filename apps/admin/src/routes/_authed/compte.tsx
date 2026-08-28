import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "convex/react"
import { api } from "@astrotan/backend/convex/_generated/api"
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_SCORE,
  scorePassword,
} from "@astrotan/backend/convex/lib/passwordStrength"
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export const Route = createFileRoute("/_authed/compte")({
  component: ComptePage,
})

// Le compte de la personne connectée — aujourd'hui, son mot de passe.
//
// Better Auth exige le mot de passe ACTUEL pour en poser un nouveau, et
// c'est la propriété importante de cet écran : une session volée ne suffit
// pas à s'emparer du compte. Sans elle, quelqu'un qui trouve un poste
// déverrouillé enferme dehors son propriétaire en trois clics.

const MESSAGES: Record<string, string> = {
  // Better Auth renvoie ce code quand le mot de passe actuel est faux.
  INVALID_PASSWORD: "Le mot de passe actuel est incorrect.",
  PASSWORD_TOO_SHORT: `Le nouveau mot de passe fait moins de ${MIN_PASSWORD_LENGTH} caractères.`,
  PASSWORD_TOO_LONG: `Le nouveau mot de passe dépasse ${MAX_PASSWORD_LENGTH} caractères.`,
}

function ComptePage() {
  const profile = useQuery(api.profiles.me)

  const [actuel, setActuel] = useState("")
  const [nouveau, setNouveau] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [erreur, setErreur] = useState<string | null>(null)
  const [fait, setFait] = useState(false)
  const [envoi, setEnvoi] = useState(false)

  // Le même scoreur que le serveur applique — c'est ce qui garantit que la
  // jauge ne promet pas un mot de passe que la mutation refusera ensuite.
  const strength = scorePassword(nouveau, { email: profile?.email })
  const identiques = nouveau.length > 0 && nouveau === confirmation
  const utilisable =
    actuel.length > 0 && identiques && strength.score >= MIN_PASSWORD_SCORE && !envoi

  async function soumettre(event: React.FormEvent) {
    event.preventDefault()
    setErreur(null)
    setFait(false)
    setEnvoi(true)
    try {
      const { error } = await authClient.changePassword({
        currentPassword: actuel,
        newPassword: nouveau,
        // Les autres sessions sont invalidées : si ce changement fait suite
        // à un doute, laisser vivre les sessions ouvertes ailleurs viderait
        // le geste de son sens.
        revokeOtherSessions: true,
      })
      if (error) {
        setErreur(MESSAGES[error.code ?? ""] ?? "Le mot de passe n'a pas pu être changé.")
        return
      }
      setFait(true)
      setActuel("")
      setNouveau("")
      setConfirmation("")
    } catch {
      setErreur("Le mot de passe n'a pas pu être changé.")
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Changer de mot de passe</CardTitle>
        <CardDescription>
          {profile ? `Connecté en tant que ${profile.email}.` : "Chargement…"} Les
          autres sessions ouvertes seront déconnectées.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={(e) => void soumettre(e)}>
          <Field>
            <FieldLabel htmlFor="mdp-actuel">Mot de passe actuel</FieldLabel>
            <Input
              id="mdp-actuel"
              type="password"
              autoComplete="current-password"
              value={actuel}
              onChange={(event) => setActuel(event.target.value)}
            />
            <FieldDescription>
              Demandé pour que voler une session ne suffise pas à voler le compte.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="mdp-nouveau">Nouveau mot de passe</FieldLabel>
            <Input
              id="mdp-nouveau"
              type="password"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              aria-describedby="mdp-force"
              value={nouveau}
              onChange={(event) => setNouveau(event.target.value)}
            />
            <PasswordStrengthMeter id="mdp-force" strength={strength} />
          </Field>

          <Field>
            <FieldLabel htmlFor="mdp-confirmation">Confirmer</FieldLabel>
            <Input
              id="mdp-confirmation"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            {/* L'écart ne se signale qu'une fois la confirmation commencée :
                l'annoncer dès le premier caractère reviendrait à dire
                « faux » à quelqu'un qui n'a pas fini d'écrire. */}
            {confirmation.length > 0 && !identiques && (
              <FieldDescription>Les deux saisies diffèrent.</FieldDescription>
            )}
          </Field>

          {erreur && (
            <p role="alert" className="text-sm text-destructive">
              {erreur}
            </p>
          )}
          {fait && (
            <p role="status" className="text-sm text-muted-foreground">
              Mot de passe changé. Les autres sessions ont été déconnectées.
            </p>
          )}

          <Button type="submit" disabled={!utilisable} className="self-start">
            {envoi ? "Changement…" : "Changer le mot de passe"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
