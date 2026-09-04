// Envoie un événement Lead / conversion aux pixels déjà chargés.
//
// Ce n'est PAS un nouveau traceur : Meta et Google ne sont injectés que
// par le bandeau, après accord. Ici on ne fait que parler à `fbq` / `gtag`
// s'ils existent déjà. Pas d'accord, pas de fonction, pas d'événement —
// y compris pour quelqu'un qui vient d'envoyer le formulaire.
//
// Une fois par onglet (`sessionStorage`) : un rafraîchissement de
// `/contact?envoye=1` ne doit pas compter deux leads, et le chat qui
// attache un e-mail après le formulaire non plus.

export const LEAD_CONVERSION_STORAGE_KEY = "astrotan.lead-conversion"

export type LeadConversionEnv = {
  googleTagId?: string
  googleConversionLabel?: string
}

export type LeadConversionHost = {
  fbq?: (...args: unknown[]) => void
  gtag?: (...args: unknown[]) => void
  sessionStorage?: Pick<Storage, "getItem" | "setItem">
}

/**
 * Destinataire Google Ads : `AW-123456789/AbC-D_efG`.
 *
 * Sans préfixe `AW-`, ou sans label, ce n'est pas une conversion Ads —
 * un `G-` ou un `GT-` mesurent (GA4 / conteneur), ils n'optimisent pas
 * une campagne. `null` plutôt qu'un `generate_lead` de consolation :
 * l'importer ensuite comme conversion Ads doublerait le signal le jour
 * où le label est enfin posé.
 */
export function destinataireConversionAds(env: LeadConversionEnv): string | null {
  const tagId = env.googleTagId?.trim()
  const label = env.googleConversionLabel?.trim()
  if (!tagId || !label || !tagId.startsWith("AW-")) return null
  return `${tagId}/${label}`
}

export function trackLeadConversion(
  env: LeadConversionEnv,
  host: LeadConversionHost = globalThis as LeadConversionHost,
): boolean {
  const store = host.sessionStorage
  if (store?.getItem(LEAD_CONVERSION_STORAGE_KEY) === "1") return false

  const sendTo = destinataireConversionAds(env)
  const meta = typeof host.fbq === "function"
  const google = typeof host.gtag === "function" && sendTo !== null
  if (!meta && !google) return false

  if (meta) host.fbq!("track", "Lead")
  if (google) host.gtag!("event", "conversion", { send_to: sendTo })

  store?.setItem(LEAD_CONVERSION_STORAGE_KEY, "1")
  return true
}

export function lireConversionDepuisBandeau(
  root: Pick<ParentNode, "querySelector"> | null | undefined,
): LeadConversionEnv {
  if (!root) return {}
  const el = root.querySelector("[data-consent-banner]")
  const dataset =
    el && "dataset" in el ? (el as HTMLElement).dataset : undefined
  if (!dataset) return {}
  return {
    googleTagId: dataset.googleTagId || undefined,
    googleConversionLabel: dataset.googleConversionLabel || undefined,
  }
}

/**
 * Tente tout de suite, puis à chaque injection de pixels.
 *
 * Le script de la page contact s'exécute avant celui du bandeau (il est
 * plus haut dans le `<body>`). Au premier passage `fbq` n'existe pas
 * encore, même si la personne a déjà accepté — d'où l'écoute de
 * `astrotan:pixels-ready`, émis après `injectTags`.
 */
export function programmerSuiviLead(
  env: LeadConversionEnv = lireConversionDepuisBandeau(
    typeof document === "undefined" ? null : document,
  ),
  host: LeadConversionHost & {
    document?: Pick<Document, "addEventListener">
  } = globalThis as LeadConversionHost & { document?: Document },
): void {
  const tenter = () => {
    trackLeadConversion(
      Object.keys(env).length > 0
        ? env
        : lireConversionDepuisBandeau(typeof document === "undefined" ? null : document),
      host,
    )
  }
  tenter()
  host.document?.addEventListener("astrotan:pixels-ready", tenter)
}
