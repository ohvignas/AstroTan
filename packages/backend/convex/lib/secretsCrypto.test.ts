import { describe, expect, test } from "vitest"
import {
  IV_LENGTH,
  KEY_LENGTH,
  SECRETS_KEY_VAR,
  chiffrer,
  dechiffrer,
  lireCleMaitresse,
} from "./secretsCrypto"

// Le chiffrement d'enveloppe, vérifié plutôt que supposé.
//
// Trois propriétés portent tout le dispositif, et chacune se casse en
// silence : un aller-retour fidèle, un IV qui change à chaque écriture, et
// l'authentification d'AES-GCM. Un IV figé, par exemple, ne fait échouer
// aucun test « ça se déchiffre bien » — il ne se voit qu'ici.

function cleAleatoire(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_LENGTH))
}

function base64(octets: Uint8Array): string {
  return btoa(String.fromCharCode(...octets))
}

describe("lireCleMaitresse", () => {
  test("absente et mal formée sont deux réponses différentes", () => {
    // Le remède n'est pas le même, et « je l'ai pourtant posée » est
    // exactement le moment où un message indistinct fait perdre une heure.
    expect(lireCleMaitresse({})).toEqual({ ok: false, raison: "MISSING" })
    expect(lireCleMaitresse({ [SECRETS_KEY_VAR]: "   " })).toEqual({
      ok: false,
      raison: "MISSING",
    })
    expect(lireCleMaitresse({ [SECRETS_KEY_VAR]: "pas du base64 !!" })).toEqual({
      ok: false,
      raison: "MALFORMED",
    })
  })

  test("refuse une clé de la mauvaise taille plutôt que de l'étirer", () => {
    // Une clé de 16 octets acceptée en silence donnerait de l'AES-128 là où
    // l'écran promet de l'AES-256.
    const trop_courte = base64(new Uint8Array(16))
    expect(lireCleMaitresse({ [SECRETS_KEY_VAR]: trop_courte })).toEqual({
      ok: false,
      raison: "MALFORMED",
    })
  })

  test("accepte une clé de 32 octets en base64, telle que la commande la produit", () => {
    const octets = cleAleatoire()
    const etat = lireCleMaitresse({ [SECRETS_KEY_VAR]: base64(octets) })
    expect(etat.ok).toBe(true)
    if (etat.ok) expect(Array.from(etat.octets)).toEqual(Array.from(octets))
  })
})

describe("chiffrer / dechiffrer", () => {
  test("un aller-retour rend l'original, accents compris", async () => {
    const cle = cleAleatoire()
    const clair = "sk-or-v1-clé-avec-des-accents-et-des-émojis-🔑"
    const { iv, chiffre } = await chiffrer(cle, clair)
    expect(await dechiffrer(cle, iv, chiffre)).toBe(clair)
  })

  test("l'IV fait 12 octets et change à chaque écriture", async () => {
    // LA propriété qui ne se voit nulle part ailleurs : un IV constant
    // laisserait tous les tests d'aller-retour au vert tout en cassant la
    // garantie d'AES-GCM.
    const cle = cleAleatoire()
    const a = await chiffrer(cle, "la même valeur")
    const b = await chiffrer(cle, "la même valeur")
    expect(a.iv.byteLength).toBe(IV_LENGTH)
    expect(new Uint8Array(a.iv)).not.toEqual(new Uint8Array(b.iv))
    // Et donc deux chiffrés différents pour la même valeur : une base
    // volée ne dit même pas que deux jetons sont identiques.
    expect(new Uint8Array(a.chiffre)).not.toEqual(new Uint8Array(b.chiffre))
  })

  test("un octet modifié fait échouer le déchiffrement", async () => {
    // AES-GCM est authentifié — on le vérifie au lieu de le supposer. Sans
    // cette propriété, un chiffré trafiqué rendrait des octets plausibles.
    const cle = cleAleatoire()
    const { iv, chiffre } = await chiffrer(cle, "valeur intacte")
    const abime = new Uint8Array(chiffre.slice(0))
    abime[0] = abime[0]! ^ 1
    await expect(
      dechiffrer(cle, iv, abime.buffer as ArrayBuffer)
    ).rejects.toThrow()
  })

  test("une autre clé ne déchiffre pas — c'est tout l'intérêt du dispositif", async () => {
    // Une copie de la base sans `SECRETS_KEY` ne donne rien.
    const { iv, chiffre } = await chiffrer(cleAleatoire(), "valeur")
    await expect(dechiffrer(cleAleatoire(), iv, chiffre)).rejects.toThrow()
  })

  test("un IV modifié fait échouer aussi", async () => {
    const cle = cleAleatoire()
    const { iv, chiffre } = await chiffrer(cle, "valeur")
    const autreIv = new Uint8Array(iv.slice(0))
    autreIv[0] = autreIv[0]! ^ 1
    await expect(
      dechiffrer(cle, autreIv.buffer as ArrayBuffer, chiffre)
    ).rejects.toThrow()
  })
})
