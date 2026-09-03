import { CopyButton } from "@/components/copy-button"

const EMAIL_LABEL = "Copier l’e-mail"
const PHONE_LABEL = "Copier le téléphone"

export function CopyLeadContact({
  email,
  phone,
}: {
  email?: string
  phone?: string
}) {
  const adresse = email?.trim() ?? ""
  const numero = phone?.trim() ?? ""
  if (adresse.length === 0 && numero.length === 0) return null

  return (
    <span className="inline-flex shrink-0 items-center">
      {adresse.length > 0 && (
        <CopyButton label={EMAIL_LABEL} value={adresse} iconClassName="size-4" />
      )}
      {numero.length > 0 && (
        <CopyButton label={PHONE_LABEL} value={numero} iconClassName="size-4" />
      )}
    </span>
  )
}
