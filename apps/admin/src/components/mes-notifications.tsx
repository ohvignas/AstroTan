import type { ReactNode } from "react"
import type { CleNotification } from "@astrotan/backend/convex/lib/notifier"
import { Switch } from "@/components/ui/switch"

export type PrefAffichee = {
  cle: CleNotification
  titre: string
  cloche: boolean
  email: boolean
}

export type PrefChange = (
  cle: CleNotification,
  next: { cloche: boolean; email: boolean },
) => void

/** Cloche / E-mail d'une clé de notif ; `null` pour invitation et reset. */
export function canauxDeLigne(
  cle: string,
  prefs: readonly PrefAffichee[],
  onChange: PrefChange,
): ReactNode {
  const pref = prefs.find((ligne) => ligne.cle === cle)
  if (pref === undefined) return null
  return (
    <CanauxPerso
      cle={pref.cle}
      cloche={pref.cloche}
      email={pref.email}
      onChange={(next) => onChange(pref.cle, next)}
    />
  )
}

export function CanauxPerso({
  cle,
  cloche,
  email,
  onChange,
}: {
  cle: CleNotification
  cloche: boolean
  email: boolean
  onChange: (next: { cloche: boolean; email: boolean }) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-4">
      <label
        htmlFor={`pref-cloche-${cle}`}
        className="flex cursor-pointer items-center gap-2 text-sm"
      >
        <span>Cloche</span>
        <Switch
          id={`pref-cloche-${cle}`}
          checked={cloche}
          onCheckedChange={(next: boolean) => onChange({ cloche: next, email })}
        />
      </label>
      <label
        htmlFor={`pref-email-${cle}`}
        className="flex cursor-pointer items-center gap-2 text-sm"
      >
        <span>E-mail</span>
        <Switch
          id={`pref-email-${cle}`}
          checked={email}
          onCheckedChange={(next: boolean) => onChange({ cloche, email: next })}
        />
      </label>
    </div>
  )
}

export function MesNotifications({
  prefs,
  onChange,
}: {
  prefs: readonly PrefAffichee[]
  onChange: PrefChange
}) {
  return (
    <ul className="divide-y">
      {prefs.map((pref) => (
        <li
          key={pref.cle}
          className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm font-medium">{pref.titre}</p>
          <CanauxPerso
            cle={pref.cle}
            cloche={pref.cloche}
            email={pref.email}
            onChange={(next) => onChange(pref.cle, next)}
          />
        </li>
      ))}
    </ul>
  )
}
