#!/usr/bin/env node
// scripts/admin-dev-link.mjs — lien d'accès local pour un agent (`pnpm admin:dev-link`).
//
// Les agents ouvrent `/login` et n'ont aucun mot de passe. Le produit n'a
// pas de backdoor : l'entrée reste l'invitation Better Auth
// (`disableSignUp: true`) → `/accept-invite?token=…`, mot de passe choisi
// dans le navigateur. Cette commande émet ce lien, l'écrit dans un fichier
// gitignoré (0600), et l'affiche. Aucun mot de passe ne transite.
//
// Un owner existe déjà ? Pas de second owner — invitation `editor` pour
// une adresse de test. Un compte existe déjà pour cette adresse ? Pas de
// jeton de reset exposé par `npx convex run` : le script pointe alors vers
// `.local/admin-storage.json` (storage Playwright, gitignoré).
//
// Aucune dépendance npm : Node 22, ESM, `node:*`. Même discipline que
// `bootstrap.mjs` : le jeton n'a d'utilité que s'il atteint un humain, et
// il ne donne rien de plus que la clé de déploiement déjà en main.

import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const BACKEND_DIR = join(ROOT, "packages", "backend")
const CONVEX_BIN = join(BACKEND_DIR, "node_modules", ".bin", "convex")
const LOCAL_DIR = join(ROOT, ".local")
const LINK_FILE = join(LOCAL_DIR, "admin-invite.url")
const STORAGE_FILE = join(LOCAL_DIR, "admin-storage.json")
const DEPLOY_FILE = join(ROOT, ".env.deploy")
const DEFAULT_EMAIL = "agent@localhost.test"
const DEFAULT_ORIGIN = "http://localhost:3001"

const C = process.stdout.isTTY
  ? { r: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", grn: "\x1b[32m", ylw: "\x1b[33m", cyn: "\x1b[36m" }
  : { r: "", b: "", dim: "", red: "", grn: "", ylw: "", cyn: "" }

const out = (s = "") => process.stdout.write(`${s}\n`)
const ok = (s) => out(`  ${C.grn}✓${C.r} ${s}`)
const info = (s) => out(`  ${C.dim}${s}${C.r}`)
const bad = (s) => out(`  ${C.red}✗${C.r} ${s}`)

function parseEnv(text) {
  const map = new Map()
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq < 1) continue
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim()
    let value = line.slice(eq + 1).trim()
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1)
    }
    map.set(key, value)
  }
  return map
}

function deployValue(key) {
  if (!existsSync(DEPLOY_FILE)) return ""
  return parseEnv(readFileSync(DEPLOY_FILE, "utf8")).get(key) ?? ""
}

function adminOrigin() {
  const fromEnv = process.env.ADMIN_DEV_ORIGIN?.trim()
  if (fromEnv) return fromEnv.replace(/\/$/, "")
  return DEFAULT_ORIGIN
}

function resolveEmail(owners) {
  const asked =
    process.env.ADMIN_EMAIL?.trim() ||
    deployValue("ADMIN_EMAIL").trim() ||
    deployValue("ACME_EMAIL").trim() ||
    DEFAULT_EMAIL
  const email = asked.toLowerCase()
  if (owners.includes(email)) {
    const domain = email.split("@")[1] || "localhost.test"
    return `agent@${domain}`
  }
  return email
}

function convexRun(name, args) {
  const argv = args === undefined ? ["run", name] : ["run", name, JSON.stringify(args)]
  const res = spawnSync(CONVEX_BIN, argv, {
    cwd: BACKEND_DIR,
    encoding: "utf8",
    env: process.env,
  })
  return {
    code: res.status ?? 1,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim(),
    failed: res.status !== 0,
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function writeLink(url) {
  mkdirSync(LOCAL_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(LINK_FILE, `${url}\n`, { mode: 0o600 })
  try {
    chmodSync(LINK_FILE, 0o600)
  } catch {
    /* Windows, ou un FS qui ignore le mode : le fichier reste gitignoré. */
  }
}

function printStorageHint() {
  out(`
${C.b}Session Playwright (après le premier login)${C.r}
  Sauver les cookies dans ${C.cyn}.local/admin-storage.json${C.r} (gitignoré) :
    storageState: ".local/admin-storage.json"
  Les agents suivants sautent alors le formulaire. Jamais de mot de passe dans le dépôt.
`)
}

if (!existsSync(CONVEX_BIN)) {
  bad(`binaire convex absent (${CONVEX_BIN}) — lancer \`pnpm install\` d'abord`)
  process.exit(1)
}

const ownersRes = convexRun("bootstrap:owners")
if (ownersRes.failed) {
  bad(`bootstrap:owners a échoué — ${ownersRes.stderr.split("\n").at(-1) || `code ${ownersRes.code}`}`)
  info("le déploiement Convex local doit être joignable (pas `convex dev` interactif depuis un agent)")
  process.exit(1)
}

const owners = parseJson(ownersRes.stdout)
if (!Array.isArray(owners)) {
  bad("bootstrap:owners n'a pas rendu une liste — sortie inattendue de la CLI")
  process.exit(1)
}

const email = resolveEmail(owners)
const origin = adminOrigin()

if (owners.length > 0) {
  ok(`owner déjà présent (${owners.join(", ")}) — invitation editor, pas un second owner`)
} else {
  ok("aucun owner — invitation owner (premier compte)")
}

const res = convexRun("bootstrap:devAccessLink", { email })
if (res.failed && /ACCOUNT_ALREADY_EXISTS/.test(`${res.stderr}\n${res.stdout}`)) {
  bad(`un compte existe déjà pour ${email} — l'invitation ne sert plus`)
  if (existsSync(STORAGE_FILE)) {
    ok(`session Playwright déjà là : ${STORAGE_FILE}`)
    info('lancer Playwright avec storageState: ".local/admin-storage.json"')
    process.exit(0)
  }
  out(`
  Pas de jeton de reset exposé par \`npx convex run\`. Deux issues, toutes locales :
    1. Accepter une invitation *nouvelle* adresse : ADMIN_EMAIL=autre@localhost.test pnpm admin:dev-link
    2. Après UN login réussi, sauver la session dans ${C.cyn}.local/admin-storage.json${C.r}
`)
  process.exit(1)
}

if (res.failed) {
  bad(`bootstrap:devAccessLink a échoué — ${res.stderr.split("\n").at(-1) || `code ${res.code}`}`)
  process.exit(1)
}

const link = parseJson(res.stdout)
if (!link?.token || !link.email || !link.role) {
  bad("bootstrap:devAccessLink n'a pas rendu de jeton — sortie inattendue de la CLI")
  process.exit(1)
}

const url = `${origin}/accept-invite?token=${encodeURIComponent(link.token)}`
writeLink(url)

ok(`lien ${link.role} pour ${link.email}`)
out(`
    ${C.cyn}${url}${C.r}

    Écrit dans ${C.dim}${LINK_FILE}${C.r} (0600, gitignoré).
    Ouvrez ce lien et choisissez un mot de passe sur la page normale.
    ${C.dim}Aucun mot de passe ne passe par ce script ni par le dépôt.${C.r}
`)
printStorageHint()
