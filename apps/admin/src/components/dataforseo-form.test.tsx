import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { DataForSeoForm } from "./dataforseo-form"
import { FeedbackDataForSeo } from "./dataforseo-verdict"

const inerte = {
  canWrite: true,
  login: null as string | null,
  passwordPose: false,
  onEnregistrer: async () => ({ verdict: "valide" as const }),
  onEffacer: async () => {},
}

/**
 * Le bouton principal est-il inerte ?
 *
 * L'ATTRIBUT `disabled=""`, et non la sous-chaîne « disabled » : les
 * classes Tailwind du bouton portent déjà `disabled:opacity-50`, qui
 * ferait passer un bouton actif pour un bouton grisé.
 *
 * « Enregistrement… » ne contient pas « Enregistrer » : la recherche ne
 * peut pas tomber sur le libellé d'attente.
 */
function boutonInerte(html: string): boolean {
  const fin = html.indexOf("Enregistrer")
  expect(fin).toBeGreaterThan(-1)
  const balise = html.slice(html.lastIndexOf("<button", fin), fin)
  return / disabled(=""|>)/.test(balise)
}

function champ(html: string, id: string): string {
  const debut = html.indexOf(`id="${id}"`)
  expect(debut).toBeGreaterThan(-1)
  return html.slice(html.lastIndexOf("<input", debut), html.indexOf(">", debut))
}

test("le login est lisible, pas masqué", () => {
  const html = renderToStaticMarkup(<DataForSeoForm {...inerte} />)
  const login = champ(html, "dataforseo-login")
  expect(login).toContain('type="text"')
  expect(login).not.toContain('type="password"')
})

test("un login déjà posé est réaffiché tel quel", () => {
  const html = renderToStaticMarkup(
    <DataForSeoForm {...inerte} login="compte@exemple.fr" passwordPose />,
  )
  expect(champ(html, "dataforseo-login")).toContain('value="compte@exemple.fr"')
  expect(html).not.toContain("••••")
})

test("le mot de passe reste masqué et n'est jamais prérempli", () => {
  const html = renderToStaticMarkup(
    <DataForSeoForm {...inerte} login="compte@exemple.fr" passwordPose />,
  )
  const password = champ(html, "dataforseo-password")
  expect(password).toContain('type="password"')
  expect(password).toContain('value=""')
  expect(password).toContain('placeholder="******"')
  expect(password).not.toContain("Inchangé")
})

test("un seul Enregistrer, aucun bouton par champ", () => {
  const html = renderToStaticMarkup(<DataForSeoForm {...inerte} />)
  expect(html.split("Enregistrer").length - 1).toBe(1)
  expect(html).not.toContain("Vérifier et enregistrer")
  expect(html).not.toContain("Retirer")
})

// La panne d'origine, tenue par un test : login posé, mot de passe posé,
// et le bouton restait inerte — donc aucun moyen d'essayer la connexion.
test("login réaffiché et mot de passe déjà posé : le bouton peut essayer", () => {
  const html = renderToStaticMarkup(
    <DataForSeoForm {...inerte} login="compte@exemple.fr" passwordPose />,
  )
  expect(boutonInerte(html)).toBe(false)
})

test("sans login, le bouton dit en étant inerte qu'il n'y a rien à essayer", () => {
  const html = renderToStaticMarkup(<DataForSeoForm {...inerte} passwordPose />)
  expect(boutonInerte(html)).toBe(true)
})

test("aucun mot de passe posé et aucun saisi : rien à essayer", () => {
  const html = renderToStaticMarkup(
    <DataForSeoForm {...inerte} login="compte@exemple.fr" />,
  )
  expect(boutonInerte(html)).toBe(true)
})

test("laisser le mot de passe vide se dit à l'écran, il ne se devine pas", () => {
  const pose = renderToStaticMarkup(
    <DataForSeoForm {...inerte} login="compte@exemple.fr" passwordPose />,
  )
  expect(pose).toMatch(/laissez-le vide/i)
  const vide = renderToStaticMarkup(<DataForSeoForm {...inerte} />)
  expect(vide).not.toMatch(/laissez-le vide/i)
})

test("Effacer n'apparaît que si un identifiant existe, en lien et pas en CTA", () => {
  const vide = renderToStaticMarkup(<DataForSeoForm {...inerte} />)
  expect(vide).not.toContain("Effacer")
  const pose = renderToStaticMarkup(
    <DataForSeoForm {...inerte} login="compte@exemple.fr" passwordPose />,
  )
  expect(pose).toContain("Effacer")
  expect(pose).toMatch(/text-xs text-muted-foreground underline/)
})

test("un editor n'a ni bouton ni champ", () => {
  const html = renderToStaticMarkup(
    <DataForSeoForm {...inerte} canWrite={false} login="compte@exemple.fr" />,
  )
  expect(html).not.toContain("Enregistrer")
  expect(html).not.toContain("Effacer")
  expect(html).not.toMatch(/<input/)
})

test("Connecté à droite d'Enregistrer si déjà branché, sans pastille", () => {
  const pose = renderToStaticMarkup(
    <DataForSeoForm {...inerte} login="compte@exemple.fr" passwordPose />,
  )
  const fin = pose.indexOf("Enregistrer")
  expect(pose.slice(fin)).toContain("Connecté")
  expect(pose).toContain("text-emerald-600")
  expect(pose).not.toContain("rounded-full")
  const vide = renderToStaticMarkup(<DataForSeoForm {...inerte} />)
  expect(vide).not.toContain("Connecté")
})

test("succès vert, refus et réseau rouges", () => {
  const ok = renderToStaticMarkup(<FeedbackDataForSeo verdict="valide" />)
  expect(ok).toContain("Connecté")
  expect(ok).toContain("text-emerald-600")
  expect(ok).toContain('role="status"')

  const ko = renderToStaticMarkup(<FeedbackDataForSeo verdict="refuse" />)
  expect(ko).toContain("Identifiants refusés")
  expect(ko).toContain("text-destructive")
  expect(ko).toContain('role="alert"')

  const net = renderToStaticMarkup(<FeedbackDataForSeo verdict="injoignable" />)
  expect(net).toContain("injoignable")
  expect(net).toContain("text-destructive")
})

// La couleur seule ne porte pas le verdict : un daltonien lit les trois
// états, et un lecteur d'écran les annonce.
test("chaque verdict porte une icône et un texte, pas seulement une couleur", () => {
  for (const verdict of ["valide", "refuse", "injoignable"] as const) {
    const html = renderToStaticMarkup(<FeedbackDataForSeo verdict={verdict} />)
    expect(html).toMatch(/<svg/)
    expect(html).toContain('aria-hidden="true"')
  }
})
