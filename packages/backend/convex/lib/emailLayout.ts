import { type CleEmail } from "./catalogueEmails"
import { escapeHtml, rendreHtml, rendreTexte, singleLine } from "./gabarit"
import { chatAccentForeground } from "./agentChatAppearance"
import { estUrlLogoEmail, garantirLogoEmail } from "./emailLogo"

// Enveloppe HTML des emails, anatomie shadcn (header / carte / CTA / pied)
// en tables et CSS inline — pas de flex, pas de JS. Les couleurs sont des
// hex : OKLCH ne tient pas dans les clients de messagerie.
//
// Le TEXTE vient toujours du gabarit (`composerMessage`). Cette enveloppe
// n'ajoute que le chrome : une mention de marque, le bouton, un pied
// discret (domaine), jamais un second « AstroTan ».

const SURFACE = "#f4f4f5"
const CARTE = "#ffffff"
const BORDURE = "#e4e4e7"
const ENCRE = "#18181b"
const MUET = "#71717a"
const MARQUE = "#f60f74"
const POLICE =
  "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"

const LIBELLE_CTA: Record<CleEmail, string> = {
  invitation: "Accepter l'invitation",
  passwordReset: "Choisir un mot de passe",
  leadNotification: "Ouvrir dans l'administration",
  postPublished: "Voir l'article",
}

export type IdentiteEmail = {
  siteName: string
  logoUrl?: string | null
  brandColor?: string | null
  footerLine?: string | null
}

export async function identiteAvecLogoJoignable(
  identite: IdentiteEmail,
): Promise<IdentiteEmail> {
  return { ...identite, logoUrl: await garantirLogoEmail(identite.logoUrl) }
}

function couleurMarque(identite: IdentiteEmail): string {
  const brute = identite.brandColor?.trim()
  return brute && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(brute) ? brute : MARQUE
}

function enTete(identite: IdentiteEmail, nom: string, marque: string): string {
  if (identite.logoUrl && estUrlLogoEmail(identite.logoUrl)) {
    return `<img src="${escapeHtml(identite.logoUrl)}" alt="" width="140" style="display:block;max-width:140px;height:auto;border:0" />`
  }
  const initiale = escapeHtml((identite.siteName.trim() || "M").slice(0, 1).toUpperCase())
  const fg = chatAccentForeground(marque)
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td width="36" height="36" style="background:${marque};border-radius:8px;text-align:center;vertical-align:middle;">` +
    `<span style="color:${fg};font-size:15px;font-weight:600;line-height:36px;font-family:${POLICE}">${initiale}</span>` +
    `</td>` +
    `<td style="padding-left:12px;font-size:16px;font-weight:600;letter-spacing:-0.02em;color:${ENCRE};font-family:${POLICE}">${nom}</td>` +
    `</tr></table>`
  )
}

export function envelopperHtml(
  corpsHtml: string,
  identite: IdentiteEmail,
  options?: { cle?: CleEmail; preface?: string },
): string {
  const nom = escapeHtml(identite.siteName.trim() || "Mon site")
  const marque = couleurMarque(identite)
  const preface = options?.preface
    ? `<p style="margin:0 0 20px 0;font-size:15px;line-height:24px;color:${ENCRE}">${escapeHtml(options.preface)}</p>`
    : ""
  const corps = styliserAncres(corpsHtml, marque, options?.cle)
  const pied = identite.footerLine?.trim()
    ? `<tr><td style="padding:28px 8px 0 8px;font-family:${POLICE};font-size:12px;line-height:18px;color:${MUET};">${escapeHtml(identite.footerLine.trim())}</td></tr>`
    : ""

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${nom}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SURFACE};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 8px 24px 8px;">${enTete(identite, nom, marque)}</td>
        </tr>
        <tr>
          <td style="background:${CARTE};border:1px solid ${BORDURE};border-radius:12px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:40px 36px 36px 36px;font-family:${POLICE};color:${ENCRE};">
                  ${preface}
                  <div style="font-size:15px;line-height:24px;color:${ENCRE};white-space:pre-wrap;">${corps}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ${pied}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

const ANCRE = /<a href="([^"]+)">([\s\S]*?)<\/a>/g

function styliserAncres(html: string, marque: string, cle?: CleEmail): string {
  const libelle = cle ? LIBELLE_CTA[cle] : null
  const fg = chatAccentForeground(marque)
  return html.replace(ANCRE, (_tout, href: string, texte: string) => {
    const etiquette = libelle ?? texte
    return (
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px 0">` +
      `<tr><td style="background:${marque};border-radius:8px">` +
      `<a href="${href}" style="display:inline-block;padding:13px 22px;color:${fg};font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">${etiquette}</a>` +
      `</td></tr></table>`
    )
  })
}

export function composerMessage(
  gabarit: { objet: string; corps: string },
  valeurs: Record<string, string>,
  cle: CleEmail,
  identite: IdentiteEmail,
  extras?: { preface?: string },
): { subject: string; html: string; text: string } {
  const subject = singleLine(rendreTexte(gabarit.objet, valeurs))
  const textBrut = rendreTexte(gabarit.corps, valeurs)
  const text = extras?.preface ? `${extras.preface}\n\n${textBrut}` : textBrut
  const corpsHtml = rendreHtml(gabarit.corps, valeurs, cle)
  return {
    subject,
    text,
    html: envelopperHtml(corpsHtml, identite, { cle, preface: extras?.preface }),
  }
}

export function valeursExemple(
  cle: CleEmail,
  ctx: { siteName: string; adminUrl: string },
): Record<string, string> {
  const base = ctx.adminUrl.replace(/\/$/, "")
  switch (cle) {
    case "invitation":
      return { lien: `${base}/accept-invite?token=exemple`, nom_du_site: ctx.siteName }
    case "passwordReset":
      return { lien: `${base}/reset-password?token=exemple`, nom_du_site: ctx.siteName }
    case "leadNotification":
      return {
        nom: "Camille Dupont",
        email: "camille@exemple.fr",
        sujet: "Demande d'exemple",
        message: "Ceci est un message d'exemple pour contrôler le rendu.",
        lien: `${base}/leads`,
        url: `${base}/leads`,
        nom_du_site: ctx.siteName,
      }
    case "postPublished":
      return {
        nom_du_site: ctx.siteName,
        url: `${base}/posts/exemple`,
        titre: "Article d'exemple",
        auteur: "L'équipe",
      }
  }
}
