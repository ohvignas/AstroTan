import { describe, expect, test } from "vitest"
import source from "./leads.tsx?raw"

describe("ouvrir une fiche la marque vue", () => {
  test("câble leads.marquerVu au clic, pas au chargement de la liste", () => {
    expect(source).toMatch(/useMutation\(api\.leads\.marquerVu\)/)
    expect(source).toMatch(/function ouvrirFiche/)
    expect(source).toMatch(/ouvrirFiche[\s\S]*setOpenLead\(lead\)[\s\S]*marquerVu\(\{\s*id:/)
    // Lire le tableau s'abonne à board ; ça n'écrit pas.
    expect(source).not.toMatch(/useEffect/)
  })

  test("l'ouverture ne dépend pas de marquerVu et ne dit pas déplacement", () => {
    const start = source.indexOf("function ouvrirFiche")
    const end = source.indexOf("function deposer")
    const ouvrir = source.slice(start, end)
    expect(ouvrir).toContain("setOpenLead(lead)")
    expect(ouvrir).toContain("marquerVu")
    expect(ouvrir).not.toContain("setErreur")
    expect(ouvrir).not.toContain("describeLeadError")
  })

  test("le dépôt et la suppression ont chacun leur phrase d'erreur", () => {
    expect(source).toMatch(/describeLeadError\(err,\s*"move"\)/)
    expect(source).toMatch(/describeLeadError\(err,\s*"remove"\)/)
  })

  test("ouvre le panneau de chat quand la fiche a un thread", () => {
    expect(source).toContain("LeadChatPanel")
    expect(source).toContain("lead.threadId")
  })

  test("la pastille Nouveau se pose sur les lignes et les cartes non vues", () => {
    expect(source).toMatch(/LeadNouveauPastille/)
    expect(source).toMatch(/seenAt=\{lead\.seenAt\}/)
  })

  test("la carte affiche la source, la geo, le drapeau et la présence", () => {
    expect(source).toMatch(/function ContenuCarte[\s\S]*LeadSourceIcon[\s\S]*leadHeadline/)
    expect(source).toMatch(/function ContenuCarte[\s\S]*origin === "chat"[\s\S]*LeadOnlineDot/)
    expect(source).toMatch(/formatLeadLocation/)
    expect(source).toMatch(/countryFlag/)
    expect(source).toMatch(/leadOrigin/)
  })

  test("une fiche sans e-mail s'affiche via leadHeadline, pas lead.email nu", () => {
    expect(source).toMatch(/leadHeadline\(lead\)/)
    expect(source).toMatch(/lead\.email \?/)
    expect(source).not.toMatch(/lead\.email\.toLowerCase\(\)/)
  })

  test("la fiche n'imbrique pas de <p> dans DialogDescription", () => {
    const start = source.indexOf("<DialogDescription>")
    const end = source.indexOf("</DialogDescription>", start)
    expect(source.slice(start, end)).not.toMatch(/<p[\s>]/)
  })

  test("sans fiche, le tableau garde ses colonnes et une phrase vide par statut", () => {
    expect(source).not.toMatch(/Personne n'a encore écrit/)
    expect(source).toMatch(/LEAD_STATUS_EMPTY/)
    expect(source).toMatch(/LEAD_STATUSES\.map\(\(status\) =>/)
  })
})
