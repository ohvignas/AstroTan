import {
  MAX_LEAD_EMAIL_LENGTH,
  MAX_LEAD_NAME_LENGTH,
  looksLikeEmail,
} from "@astrotan/backend/convex/content"
import { useState, type FormEvent } from "react"
import { startChat } from "./chatApi"
import { bannerForCode, fieldMessage } from "./chatWidgetState"

type Props = {
  onStarted: (token: string) => void
}

export function ChatGate({ onStarted }: Props) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [siteWeb, setSiteWeb] = useState("")
  const [pending, setPending] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBanner(null)
    setEmailError(null)
    const trimmed = email.trim()
    if (!looksLikeEmail(trimmed)) {
      setEmailError("Adresse e-mail invalide.")
      return
    }
    setPending(true)
    try {
      const result = await startChat({ email: trimmed, name: name.trim(), site_web: siteWeb })
      if (result.ok) {
        const token = result.data.token
        if (typeof token === "string" && token.length > 0) onStarted(token)
        return
      }
      if (result.code === "session") return
      const field = fieldMessage(result.code, "gate")
      if (field) {
        setEmailError(field.message)
        return
      }
      setBanner(bannerForCode(result.code) ?? "L'assistant est indisponible.")
    } catch {
      setBanner("L'assistant est indisponible.")
    } finally {
      setPending(false)
    }
  }

  return (
    <form className="chat-widget__form" onSubmit={(event) => void onSubmit(event)}>
      <p className="chat-widget__lead">Pour vous répondre, un e-mail suffit.</p>
      {banner ? (
        <p className="chat-widget__banner" role="alert">
          {banner}
        </p>
      ) : null}
      <label className="chat-widget__field">
        E-mail
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          maxLength={MAX_LEAD_EMAIL_LENGTH}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        {emailError ? <span className="chat-widget__error">{emailError}</span> : null}
      </label>
      <label className="chat-widget__field">
        Nom <span className="chat-widget__optional">(optionnel)</span>
        <input
          type="text"
          name="name"
          autoComplete="name"
          maxLength={MAX_LEAD_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="chat-widget__honeypot" aria-hidden="true">
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
      <button type="submit" className="chat-widget__submit" disabled={pending}>
        {pending ? "Ouverture…" : "Commencer"}
      </button>
    </form>
  )
}
