import {
  MAX_LEAD_EMAIL_LENGTH,
  looksLikeEmail,
} from "@astrotan/backend/convex/content"
import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { attachChatEmail } from "./chatApi"
import { emailCardMessage } from "./chatWidgetState"

export function ChatEmailCard({
  token,
  onAttached,
  onIgnore,
}: {
  token: string
  onAttached: () => void
  onIgnore: () => void
}) {
  const [email, setEmail] = useState("")
  const [siteWeb, setSiteWeb] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const trimmed = email.trim()
    if (!looksLikeEmail(trimmed)) {
      setError("Adresse e-mail invalide.")
      return
    }
    setPending(true)
    try {
      const result = await attachChatEmail({ token, email: trimmed, site_web: siteWeb })
      if (result.ok) {
        onAttached()
        return
      }
      setError(emailCardMessage(result.code))
    } catch {
      setError("L'assistant est indisponible.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full rounded-xl border bg-card p-4 shadow-md">
      <p id="chat-email-card-title" className="font-medium">
        Quelle est votre adresse email ?
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Entrez votre email pour être informé de nos réponses :
      </p>
      <form className="mt-3 flex flex-col gap-2" onSubmit={(event) => void onSubmit(event)}>
        <label className="sr-only" htmlFor="chat-email-card">
          Adresse e-mail
        </label>
        <Input
          id="chat-email-card"
          type="email"
          name="email"
          autoComplete="email"
          maxLength={MAX_LEAD_EMAIL_LENGTH}
          value={email}
          placeholder="Entrez votre adresse email..."
          aria-invalid={error ? true : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        {error ? (
          <span className="text-sm text-destructive" role="alert">
            {error}
          </span>
        ) : null}
        <div className="sr-only" aria-hidden="true">
          <label>
            Site web
            <input
              type="text"
              name="site_web"
              tabIndex={-1}
              autoComplete="off"
              value={siteWeb}
              onChange={(event) => setSiteWeb(event.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Enregistrement…" : "Définir mon email"}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={onIgnore}>
            Ignorer
          </Button>
        </div>
      </form>
    </div>
  )
}
