import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_SCORE,
} from "@astrotan/backend/convex/lib/passwordStrength"
import type {
  PasswordIssue,
  PasswordStrength,
} from "@astrotan/backend/convex/lib/passwordStrength"
import { cn } from "@/lib/utils"

// The gauge renders `scorePassword`'s verdict — the same function
// `invitations.accept` applies server-side. Nothing here re-derives a score
// or softens one: a meter that disagrees with the server teaches people to
// ignore it.

const SCORE_LABELS = ["Très faible", "Faible", "Correct", "Solide", "Excellent"]

// Fixed hues rather than theme tokens on purpose: this is semantic colour
// (danger → safety), not the interface's accent, and it has to read the same
// way in both themes. These four Tailwind shades hold their contrast on a
// light and a dark ground alike.
const SCORE_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
]

// One sentence per issue, phrased as what to do rather than what went wrong.
// `TOO_LONG` and `TOO_SHORT` name the actual bounds because those are the
// only two the visitor can act on precisely.
const ISSUE_MESSAGES: Record<PasswordIssue, string> = {
  TOO_SHORT: `Il faut au moins ${MIN_PASSWORD_LENGTH} caractères.`,
  TOO_LONG: `${MAX_PASSWORD_LENGTH} caractères au maximum.`,
  COMMON:
    "Ce mot de passe figure parmi les plus courants — remplacer un « a » par « @ » ne le protège pas.",
  DERIVED_FROM_EMAIL:
    "Il reprend votre adresse e-mail : c'est la première chose qui sera essayée.",
  REPEATED: "Un même caractère répété ne protège rien.",
  SEQUENTIAL:
    "Une suite de touches ou de lettres consécutives est devinée immédiatement.",
  TOO_SIMPLE:
    "Allongez-le, ou mélangez majuscules, chiffres et ponctuation. Une phrase de quatre mots fait très bien l'affaire.",
}

export function PasswordStrengthMeter({
  strength,
  id,
  className,
}: {
  strength: PasswordStrength
  /** Referenced by the password input's `aria-describedby`. */
  id: string
  className?: string
}) {
  const { score, issues } = strength
  const passes = score >= MIN_PASSWORD_SCORE

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {/* Decorative: the same information is in the live region below, and
          a screen reader reading four unlabelled bars would only be noise. */}
      <div aria-hidden className="flex gap-1">
        {[0, 1, 2, 3].map((segment) => (
          <div
            key={segment}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              segment < score ? SCORE_COLORS[score] : "bg-muted"
            )}
          />
        ))}
      </div>
      {/* `polite`, not `assertive`: this updates on every keystroke, and an
          assertive region would interrupt the person mid-word. */}
      <p id={id} aria-live="polite" className="text-xs text-muted-foreground">
        <span
          className={cn(
            "font-medium",
            passes ? "text-foreground" : "text-destructive"
          )}
        >
          {SCORE_LABELS[score]}
        </span>
        {issues.length > 0 && <> — {ISSUE_MESSAGES[issues[0]!]}</>}
      </p>
    </div>
  )
}
