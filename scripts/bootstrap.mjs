#!/usr/bin/env node
// scripts/bootstrap.mjs — mise en service du template (`pnpm bootstrap`).
//
// L'adoptant remplit UN fichier, `.env.deploy`. Ce script en distribue les
// valeurs vers les trois destinations qui ne peuvent pas se lire entre elles :
// le déploiement Convex, les secrets GitHub Actions, les `.env` de
// développement local — puis produit `.env.vps`, le bloc à copier sur le VPS.
//
// Le nom `bootstrap` n'est pas un choix de style : `pnpm setup` est une
// commande INTERNE de pnpm (elle installe le répertoire des binaires globaux)
// et un script `setup` du package.json ne serait jamais atteint.
//
// Aucune dépendance npm : quelqu'un qui va confier ses secrets à ce fichier
// doit pouvoir le lire en entier sans suivre d'import. Node 22, ESM, `node:*`.
//
// Règle tenue partout ci-dessous : AUCUNE valeur de secret n'est écrite sur
// stdout ou stderr, pas même tronquée. Un secret se décrit par son état
// (`posé`, `inchangé`, `manquant`), sa longueur, et une empreinte SHA-256
// courte — assez pour vérifier que les deux côtés d'une frontière HMAC
// portent bien la même clé, sans jamais rien révéler d'elle.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY_FILE = join(ROOT, ".env.deploy");
const DEPLOY_EXAMPLE = join(ROOT, ".env.deploy.example");
const VPS_FILE = join(ROOT, ".env.vps");
const BACKEND_DIR = join(ROOT, "packages", "backend");
// Le binaire que `pnpm --filter @astrotan/backend exec convex` résout, appelé
// directement : le script n'a alors besoin ni de pnpm ni de corepack sur le
// PATH, ce qui compte parce qu'il tourne avant que l'environnement de
// l'adoptant soit forcément en place.
const CONVEX_BIN = join(BACKEND_DIR, "node_modules", ".bin", "convex");

// ─── Sortie ─────────────────────────────────────────────────────────────────

const C = process.stdout.isTTY
  ? { r: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", grn: "\x1b[32m", ylw: "\x1b[33m", cyn: "\x1b[36m" }
  : { r: "", b: "", dim: "", red: "", grn: "", ylw: "", cyn: "" };

const out = (s = "") => process.stdout.write(`${s}\n`);
const title = (s) => out(`\n${C.b}${s}${C.r}`);
const ok = (s) => out(`  ${C.grn}✓${C.r} ${s}`);
const skip = (s) => out(`  ${C.ylw}—${C.r} ${s}`);
const info = (s) => out(`  ${C.dim}${s}${C.r}`);
const bad = (s) => out(`  ${C.red}✗${C.r} ${s}`);

/**
 * Empreinte publiable d'un secret. SHA-256 tronqué : non inversible, et
 * suffisant pour comparer une clé posée sur Convex avec celle du `.env` du
 * VPS sans jamais afficher ni l'une ni l'autre.
 */
const fingerprint = (v) => createHash("sha256").update(v, "utf8").digest("hex").slice(0, 8);

/** Description d'une valeur, sûre à afficher quel que soit son caractère secret. */
function describe(value, isSecret) {
  if (value === undefined || value === "") return `${C.dim}(vide)${C.r}`;
  if (!isSecret) return value;
  return `${C.dim}empreinte ${fingerprint(value)} · ${value.length} car.${C.r}`;
}

// ─── Lecture / écriture du fichier d'entrée ─────────────────────────────────

/** Parse un dotenv minimal. Pas de substitution, pas de multiligne : le seul
 *  producteur de ce fichier est un humain qui colle des valeurs plates. */
function parseEnv(text) {
  const map = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

/**
 * Réécrit `.env.deploy` en place, en préservant commentaires et ordre : ce
 * fichier est aussi de la documentation, et l'écraser par un dump de paires
 * la ferait disparaître à la première génération de secret.
 */
function writeBackGenerated(path, generated) {
  if (generated.size === 0) return;
  const lines = readFileSync(path, "utf8").split("\n");
  const appended = [];
  for (const [key, value] of generated) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(l));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else appended.push(`${key}=${value}`);
  }
  if (appended.length > 0) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push(
      "# ── Généré par `pnpm bootstrap` — ne pas modifier à la main ─────────────────",
      "# Clés HMAC, secret de session, clé maîtresse des jetons et secrets Umami,",
      "# générés une seule fois puis relus tels quels. Les régénérer casse, selon",
      "# la clé : la prévisualisation, l'invalidation de cache, le formulaire de",
      "# contact, le journal de consentement, toutes les sessions ouvertes du",
      "# dashboard, la connexion d'Umami à sa base — ou, pour SECRETS_KEY, la",
      "# lecture de TOUS les jetons déjà saisis depuis l'administration, qui",
      "# deviennent alors indéchiffrables et sont à ressaisir",
      "# (docker/README.md §6 et §13). Pour une rotation volontaire : vider la",
      "# ligne, relancer, et redéployer les trois côtés.",
      ...appended,
      "",
    );
  }
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
}

/**
 * Réécrit UNE valeur dans `.env.deploy`, seulement si sa ligne existe déjà.
 *
 * Distinct de `writeBackGenerated` : cette fonction-ci sert à mémoriser une
 * réponse donnée au terminal, et une réponse n'a rien à faire sous l'en-tête
 * « Généré par pnpm bootstrap — ne pas modifier à la main » que l'autre
 * ajoute. Rend `false` quand la clé est absente du fichier (un `.env.deploy`
 * créé avant que cette variable existe) : l'appelant le dit alors, plutôt
 * que d'écrire au mauvais endroit.
 */
function writeBackAnswer(path, key, value) {
  const lines = readFileSync(path, "utf8").split("\n");
  const i = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?${key}\\s*=`).test(l));
  if (i < 0) return false;
  lines[i] = `${key}=${value}`;
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
  return true;
}

/**
 * Une question posée au terminal — et JAMAIS un blocage.
 *
 * Ce script est lancé par des humains, mais aussi par des agents de code et
 * par des scripts (AGENTS.md le dit explicitement). Une question qui attend
 * sur stdin y serait une régression : elle bloquerait pour toujours, sans
 * rien afficher qui l'explique. D'où les trois portes de sortie —
 * `--dry-run`, pas de terminal, pas de `/dev/tty` — qui rendent `null`,
 * c'est-à-dire « garde le défaut, et dis-le ».
 *
 * Lit sur `/dev/tty` plutôt que sur le descripteur 0 : stdin peut être une
 * redirection (`< /dev/null`, un pipe) alors qu'un terminal reste attaché,
 * et c'est le terminal qu'on veut interroger, pas l'entrée du script.
 */
function demanderAuTerminal(question, defaut) {
  if (DRY || !process.stdin.isTTY) return null;
  let fd;
  try {
    fd = openSync("/dev/tty", "r");
  } catch {
    return null;
  }
  try {
    out(`  ${C.cyn}?${C.r} ${question}`);
    process.stdout.write(`    ${C.dim}[Entrée = ${defaut}]${C.r} `);
    const buffer = Buffer.alloc(512);
    let lu = "";
    while (!lu.includes("\n")) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      lu += buffer.toString("utf8", 0, n);
    }
    const reponse = (lu.split("\n")[0] ?? "").trim();
    return reponse === "" ? null : reponse;
  } finally {
    closeSync(fd);
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

// Les placeholders des `.env.example` du dépôt, « manifestement faux, exprès »
// (README). Les laisser passer donnerait un déploiement qui démarre et ment.
const PLACEHOLDERS = ["example.com", "your-github-username", "change-me", "you@example.com", "your-deployment"];

const isPlaceholder = (v) => PLACEHOLDERS.some((p) => v.toLowerCase().includes(p));

/**
 * Les champs saisis par l'humain. `check` rend un message d'erreur ou null.
 * `secret` ne pilote que l'affichage.
 */
const INPUT = [
  {
    key: "WEB_DOMAIN",
    check: (v) =>
      /^https?:\/\//i.test(v)
        ? "attendu un hôte nu, sans schéma (`example.com`, pas `https://example.com`) — le compose l'injecte dans une règle Traefik Host(`…`)"
        : v.includes("/")
          ? "attendu un hôte nu, sans chemin ni slash final"
          : null,
  },
  {
    key: "ADMIN_DOMAIN",
    check: (v) =>
      /^https?:\/\//i.test(v)
        ? "attendu un hôte nu, sans schéma"
        : v.includes("/")
          ? "attendu un hôte nu, sans chemin ni slash final"
          : null,
  },
  {
    key: "ACME_EMAIL",
    check: (v) =>
      !v.includes("@") || v.startsWith("@") || v.endsWith("@")
        ? "adresse email invalide — Let's Encrypt refuse l'enregistrement du compte, donc TOUS les certificats"
        : null,
  },
  {
    // Le compte `owner` du dashboard. Facultative : à défaut, `ACME_EMAIL`
    // sert, et le script demande confirmation quand il tourne dans un
    // terminal. Séparée d'`ACME_EMAIL` parce que ce sont deux rôles
    // différents — l'un reçoit les avis d'expiration de certificat, l'autre
    // détient le seul compte capable d'en créer d'autres.
    key: "ADMIN_EMAIL",
    optional: true,
    check: (v) =>
      !v.includes("@") || v.startsWith("@") || v.endsWith("@")
        ? "adresse email invalide — c'est elle qui recevra le lien du premier compte"
        : null,
  },
  {
    key: "GITHUB_REPOSITORY",
    check: (v) =>
      !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(v)
        ? "attendu `owner/nom` (c'est ce que `gh secret set --repo` consomme)"
        : null,
  },
  {
    key: "GHCR_OWNER",
    check: (v) => (v !== v.toLowerCase() ? "GHCR rejette les majuscules — mettre la valeur en minuscules" : null),
  },
  { key: "CONVEX_CLOUD_URL", check: (v) => checkUrl(v, ".convex.cloud") },
  { key: "CONVEX_SITE_URL", check: (v) => checkUrl(v, ".convex.site") },
  {
    key: "CONVEX_DEPLOY_KEY",
    secret: true,
    check: (v) => (v.length < 16 ? "trop courte pour une clé de déploiement Convex" : null),
  },
  {
    key: "VPS_HOST",
    check: (v) => (/^https?:\/\//i.test(v) ? "attendu un hôte ou une IP, sans schéma" : null),
  },
  { key: "VPS_USER", check: (v) => (v === "root" ? "le pipeline exige un utilisateur NON-root du groupe docker (docker/README.md §1)" : null) },
  { key: "VPS_SSH_KEY_PATH", check: checkSshKeyPath },
  // Optionnelles : une valeur vide est un choix documenté, pas un oubli.
  {
    // Le sous-domaine du tableau de bord Umami. Absente, elle est dérivée
    // en `stats.<WEB_DOMAIN>` plus bas — le compose l'exige en
    // `${UMAMI_DOMAIN:?}`, donc ne rien écrire ferait échouer le premier
    // `compose up` de l'adoptant sur une variable qu'aucun fichier ne lui
    // avait demandée. Un défaut dérivé vaut mieux qu'un trou.
    key: "UMAMI_DOMAIN",
    optional: true,
    check: (v) =>
      /^https?:\/\//i.test(v)
        ? "attendu un hôte nu, sans schéma — le compose l'injecte dans une règle Traefik Host(`…`)"
        : v.includes("/")
          ? "attendu un hôte nu, sans chemin ni slash final"
          : null,
  },
  { key: "RESEND_API_KEY", secret: true, optional: true },
  {
    key: "RESEND_TEST_MODE",
    optional: true,
    check: (v) =>
      v !== "true" && v !== "false"
        ? "attendu `true` ou `false` littéral — `invitations.ts` lit `!== \"false\"`, donc toute autre valeur garde le mode test"
        : null,
  },
];

function checkUrl(v, suffix) {
  if (!/^https:\/\//i.test(v)) return "attendu une URL `https://…` complète";
  if (v.endsWith("/")) return "retirer le slash final (elle est concaténée telle quelle)";
  if (!v.toLowerCase().includes(suffix)) return `avertissement: ne se termine pas par \`${suffix}\` — attendu seulement si votre Convex est auto-hébergé`;
  return null;
}

function checkSshKeyPath(v) {
  const p = expandHome(v);
  if (!existsSync(p)) return `fichier introuvable : ${p}`;
  if (p.endsWith(".pub")) return "c'est la clé PUBLIQUE — le secret VPS_SSH_KEY attend la clé privée";
  let head;
  try {
    head = readFileSync(p, "utf8").slice(0, 64);
  } catch (e) {
    return `illisible : ${e.code ?? e.message}`;
  }
  if (!head.startsWith("-----BEGIN")) return "ne commence pas par `-----BEGIN` — attendu une clé privée OpenSSH complète";
  if (head.includes("ENCRYPTED")) return "clé protégée par passphrase — un runner GitHub ne peut pas la déverrouiller, en générer une dédiée sans passphrase";
  return null;
}

const expandHome = (p) => (p.startsWith("~/") || p === "~" ? join(homedir(), p.slice(1)) : resolve(ROOT, p));

// Les secrets générés, avec la garde que le code applique de son côté.
//
// Tout ce qui est ici est produit une fois puis relu : la valeur est
// réécrite dans `.env.deploy`, et une exécution suivante la retrouve telle
// quelle. Ce sont donc des secrets qu'on n'a jamais à saisir ni à voir.
const GENERATED = [
  { key: "BETTER_AUTH_SECRET", gen: ["rand", "-base64", "32"], minLength: 32 },
  { key: "PREVIEW_SECRET", gen: ["rand", "-hex", "32"], minLength: 32 },
  { key: "REVALIDATE_SECRET", gen: ["rand", "-hex", "32"], minLength: 32 },
  // Les deux clés HMAC du site public. Même nature que les précédentes —
  // vérifiées des deux côtés d'une frontière, donc n'ayant de sens
  // qu'identiques sur Convex et dans le conteneur `web`.
  { key: "LEAD_SUBMIT_SECRET", gen: ["rand", "-hex", "32"], minLength: 32 },
  { key: "CONSENT_LOG_SECRET", gen: ["rand", "-hex", "32"], minLength: 32 },
  // La clé qui ouvre `routing.hotes` au service `routeur` — celui qui suit
  // le domaine déclaré et réécrit le routage de Traefik. Même nature que
  // les quatre précédentes : vérifiée des deux côtés d'une frontière, donc
  // n'ayant de sens qu'identique sur Convex et dans le conteneur.
  //
  // Générée ici plutôt que laissée à l'adoptant, comme les neuf autres :
  // sur un template, un secret à poser à la main est un secret que
  // plusieurs oublieront — et celui-ci s'oublie SANS symptôme. Le site
  // continue de servir, le routage reste simplement figé, et changer de
  // domaine depuis l'administration n'a plus aucun effet.
  { key: "ROUTING_SECRET", gen: ["rand", "-hex", "32"], minLength: 32 },
  // La clé maîtresse du chiffrement des jetons saisis depuis
  // l'administration (`convex/lib/secretsCrypto.ts`). Base64, pas
  // hexadécimal, et 44 caractères et non 32 : AES-256-GCM exige EXACTEMENT
  // 32 octets une fois décodés, ce que `rand -base64 32` produit sous forme
  // de 44 caractères. Une valeur plus courte est refusée par
  // `lireCleMaitresse` — distinctement de « absente », parce que le remède
  // n'est pas le même.
  //
  // Sans elle, `secrets.set` lève `SECRETS_KEY_MISSING` : le refus est
  // propre, mais toute la famille `secrets` est inerte et les sept jetons
  // ne se posent plus que par `convex env set`. `/settings/mesure` et
  // `/settings/ia` sont alors décoratifs sur un déploiement neuf.
  { key: "SECRETS_KEY", gen: ["rand", "-base64", "32"], minLength: 44 },
  // Umami. Ces trois-là ne partent PAS sur Convex : elles ne servent qu'aux
  // conteneurs `umami` et `umami-db`, et le compose les exige en
  // `${VAR:?}`. Les générer ici est ce qui évite qu'un adoptant découvre
  // leur existence à l'échec de son premier `compose up`.
  //
  // Hexadécimal pour le mot de passe Postgres, et ce n'est pas cosmétique :
  // il est inséré tel quel dans `postgresql://umami:<mdp>@umami-db:5432` —
  // un `@` ou un `/` non encodé couperait l'URL en silence.
  { key: "UMAMI_DB_PASSWORD", gen: ["rand", "-hex", "32"], minLength: 32 },
  { key: "UMAMI_APP_SECRET", gen: ["rand", "-hex", "32"], minLength: 32 },
  // Umami exige EXACTEMENT 64 caractères hexadécimaux ici (`rand -hex 32`
  // en produit 64). Trop courte, la 2FA refuse de s'activer — et la panne
  // n'apparaît que le jour où quelqu'un essaie, c'est-à-dire trop tard.
  { key: "UMAMI_TWO_FACTOR_ENCRYPTION_KEY", gen: ["rand", "-hex", "32"], minLength: 64 },
];

// ─── Exécution de commandes ─────────────────────────────────────────────────

/** Lance une commande en lui passant `input` sur stdin. Rien de secret ne
 *  transite jamais par argv : la ligne de commande d'un processus est lisible
 *  par tout utilisateur de la machine (`ps`) et atterrit dans l'historique. */
function run(cmd, args, { input, cwd, env } = {}) {
  const res = spawnSync(cmd, args, {
    input,
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: "utf8",
  });
  return {
    code: res.status,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim(),
    failed: res.error != null || res.status !== 0,
    error: res.error,
  };
}

const have = (cmd) => run("sh", ["-c", `command -v ${cmd}`]).code === 0;

// ─── Programme ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  out(`
${C.b}pnpm bootstrap${C.r} — distribue les valeurs de \`.env.deploy\` vers Convex,
les secrets GitHub, les \`.env\` locaux, et produit \`.env.vps\`.

  --dry-run        montre tout ce qui serait fait, n'écrit rien, n'appelle
                   ni gh ni convex. Recommandé au premier passage.
  --skip-convex    saute l'étape Convex (variables ET contenu initial)
  --skip-github    saute l'étape des secrets GitHub
  --skip-seed      saute la création du contenu initial. À n'utiliser que
                   sur un déploiement dont les lignes \`pages\` existent
                   déjà : sans elles, TOUTES les URL du site répondent 404.
  --skip-invite    saute l'invitation du premier compte. Sans elle, et sur
                   un déploiement neuf, PERSONNE ne peut entrer dans le
                   dashboard : l'accès est sur invitation seule.
  --help

Le fichier d'autorité sur l'exploitation reste \`docker/README.md\`.
`);
  process.exit(0);
}
const DRY = argv.includes("--dry-run");
const SKIP_CONVEX = argv.includes("--skip-convex");
const SKIP_GITHUB = argv.includes("--skip-github");
const SKIP_SEED = argv.includes("--skip-seed");
const SKIP_INVITE = argv.includes("--skip-invite");
for (const a of argv) {
  if (!["--dry-run", "--skip-convex", "--skip-github", "--skip-seed", "--skip-invite"].includes(a)) {
    bad(`option inconnue : ${a} — voir \`pnpm bootstrap --help\``);
    process.exit(2);
  }
}

out(`${C.b}AstroTan · mise en service${C.r}${DRY ? `  ${C.ylw}[--dry-run : rien ne sera écrit ni appelé]${C.r}` : ""}`);

// ── 0. Le fichier d'entrée ──────────────────────────────────────────────────

if (!existsSync(DEPLOY_FILE)) {
  if (!existsSync(DEPLOY_EXAMPLE)) {
    bad(`${DEPLOY_EXAMPLE} est absent du dépôt — clone incomplet ?`);
    process.exit(1);
  }
  title("0 · Fichier d'entrée");
  if (DRY) {
    skip(`.env.deploy absent — serait créé depuis .env.deploy.example (rien écrit en --dry-run)`);
    process.exit(1);
  }
  // 0600 : ce fichier va porter la clé de déploiement Convex et trois secrets.
  writeFileSync(DEPLOY_FILE, readFileSync(DEPLOY_EXAMPLE, "utf8"), { mode: 0o600 });
  ok(`.env.deploy créé depuis .env.deploy.example (mode 600, gitignoré)`);
  out(`
Remplissez-le, puis relancez. Ce qu'il attend :

  ${C.cyn}WEB_DOMAIN / ADMIN_DOMAIN${C.r}   vos deux domaines, hôtes nus
  ${C.cyn}ACME_EMAIL${C.r}                  votre adresse, pour le compte Let's Encrypt
  ${C.cyn}GITHUB_REPOSITORY${C.r}           owner/nom du dépôt qui porte les secrets Actions
  ${C.cyn}GHCR_OWNER${C.r}                  propriétaire des packages GHCR, en minuscules
  ${C.cyn}CONVEX_CLOUD_URL / _SITE_URL${C.r} les deux URLs du déploiement de production
  ${C.cyn}CONVEX_DEPLOY_KEY${C.r}           dashboard Convex → Settings → Deploy keys
  ${C.cyn}VPS_HOST / VPS_USER${C.r}         l'accès SSH, utilisateur non-root
  ${C.cyn}VPS_SSH_KEY_PATH${C.r}            chemin de la clé privée de déploiement
  ${C.cyn}RESEND_API_KEY${C.r}              facultative — vide = invitations sans email
  ${C.cyn}UMAMI_DOMAIN${C.r}                facultative — défaut \`stats.<WEB_DOMAIN>\`

Les secrets — clés HMAC, secret de session, clé maîtresse, Umami — générés au
prochain passage : ne les saisissez pas, et n'ajoutez pas leurs lignes. Le
script les écrira lui-même dans .env.deploy et les relira ensuite tels quels.
Premier passage conseillé : ${C.b}pnpm bootstrap --dry-run${C.r}.
`);
  process.exit(1);
}

const env = parseEnv(readFileSync(DEPLOY_FILE, "utf8"));

// ── 1. Validation — tout d'un coup, avant la moindre écriture ───────────────

title("1 · Validation de .env.deploy");

const errors = [];
const warnings = [];

for (const spec of INPUT) {
  const value = env.get(spec.key);
  if (value === undefined) {
    if (!spec.optional) errors.push([spec.key, "variable absente du fichier"]);
    continue;
  }
  if (value === "") {
    if (!spec.optional) errors.push([spec.key, "valeur vide"]);
    continue;
  }
  if (isPlaceholder(value)) {
    errors.push([spec.key, `valeur laissée au placeholder de l'exemple`]);
    continue;
  }
  const problem = spec.check?.(value);
  if (problem?.startsWith("avertissement:")) warnings.push([spec.key, problem.slice("avertissement:".length).trim()]);
  else if (problem) errors.push([spec.key, problem]);
}

// Les secrets générés : absents, ils seront produits ; présents, ils doivent
// déjà satisfaire la garde que le code applique côté Convex et côté web.
for (const spec of GENERATED) {
  const value = env.get(spec.key);
  if (value === undefined || value === "") continue;
  if (isPlaceholder(value)) errors.push([spec.key, "valeur laissée au placeholder — vider la ligne pour que le script en génère un"]);
  else if (value.length < spec.minLength)
    errors.push([spec.key, `${value.length} caractères, minimum ${spec.minLength} — la garde du code rejette plus court (échec au démarrage, pas dégradation)`]);
}

if (errors.length > 0) {
  out();
  bad(`${errors.length} problème${errors.length > 1 ? "s" : ""} dans ${DEPLOY_FILE} :`);
  out();
  for (const [key, msg] of errors) out(`    ${C.red}${key.padEnd(22)}${C.r} ${msg}`);
  for (const [key, msg] of warnings) out(`    ${C.ylw}${key.padEnd(22)}${C.r} ${msg}`);
  out(`
  Rien n'a été écrit, rien n'a été appelé. Corrigez tout ce qui précède, puis
  relancez. Chaque \`.env.example\` du dépôt documente sa variable en détail.
`);
  process.exit(1);
}

// Ce qui est réellement renseigné, pas la taille de `INPUT` : depuis que des
// champs facultatifs existent, annoncer `INPUT.length` reviendrait à déclarer
// « conformes » des lignes que personne n'a écrites.
const filled = INPUT.filter((s) => (env.get(s.key) ?? "") !== "").length;
ok(`${filled}/${INPUT.length} variables saisies, conformes${filled < INPUT.length ? ` — les ${INPUT.length - filled} autres sont facultatives et resteront à leur défaut` : ""}`);
for (const [key, msg] of warnings) out(`  ${C.ylw}!${C.r} ${key} : ${msg}`);
if (!env.get("RESEND_API_KEY")) info("RESEND_API_KEY vide — traitée plus bas, ce n'est pas une erreur");

// ── 2. Génération des secrets ───────────────────────────────────────────────

title("2 · Secrets générés");

if (!have("openssl")) {
  bad("openssl introuvable — c'est lui qui produit les trois secrets (mêmes commandes que la doc)");
  process.exit(1);
}

const generated = new Map();
for (const spec of GENERATED) {
  const existing = env.get(spec.key);
  if (existing) {
    ok(`${spec.key.padEnd(20)} inchangé · ${describe(existing, true)}`);
    continue;
  }
  if (DRY) {
    skip(`${spec.key.padEnd(20)} serait généré par \`openssl ${spec.gen.join(" ")}\` puis réécrit dans .env.deploy`);
    continue;
  }
  const res = run("openssl", spec.gen);
  if (res.failed || !res.stdout) {
    bad(`${spec.key} : \`openssl ${spec.gen.join(" ")}\` a échoué`);
    process.exit(1);
  }
  generated.set(spec.key, res.stdout);
  env.set(spec.key, res.stdout);
  ok(`${spec.key.padEnd(20)} généré  · ${describe(res.stdout, true)}`);
}

if (!DRY && generated.size > 0) {
  writeBackGenerated(DEPLOY_FILE, generated);
  info(`réécrits dans .env.deploy — les prochaines exécutions les reliront tels quels`);
}

// ── Valeurs dérivées ────────────────────────────────────────────────────────

const g = (k) => env.get(k) ?? "";
const WEB_ORIGIN = `https://${g("WEB_DOMAIN")}`;
const ADMIN_ORIGIN = `https://${g("ADMIN_DOMAIN")}`;
// Le compose exige `UMAMI_DOMAIN`, et l'adoptant n'a aucune raison d'y avoir
// pensé : `stats.<domaine du site>` est la convention du README §13. Un
// sous-domaine n'engage rien tant que son DNS ne pointe pas sur le VPS.
const UMAMI_DOMAIN = g("UMAMI_DOMAIN") || `stats.${g("WEB_DOMAIN")}`;

// Les variables de packages/backend/.env.example, dans son ordre.
const CONVEX_VARS = [
  { name: "BETTER_AUTH_SECRET", value: g("BETTER_AUTH_SECRET"), secret: true },
  { name: "SITE_URL", value: ADMIN_ORIGIN }, // le dashboard : c'est lui qui porte la session Better Auth
  { name: "PREVIEW_SECRET", value: g("PREVIEW_SECRET"), secret: true },
  { name: "REVALIDATE_SECRET", value: g("REVALIDATE_SECRET"), secret: true },
  { name: "WEB_SITE_URL", value: WEB_ORIGIN }, // le site public : cible des POST /api/revalidate
  // Les deux clés que `apps/web` présente à Convex depuis ses routes
  // d'API. Convex les compare en temps constant (`convex/leads.ts`,
  // `convex/consent.ts`) : une valeur posée d'un seul côté vaut une valeur
  // absente, et la route se contente de refuser.
  { name: "LEAD_SUBMIT_SECRET", value: g("LEAD_SUBMIT_SECRET"), secret: true },
  { name: "CONSENT_LOG_SECRET", value: g("CONSENT_LOG_SECRET"), secret: true },
  // Posée sur Convex et NULLE PART ailleurs : elle ne protège que ce qui
  // vit dans la base de ce déploiement. La poser sur le VPS ou en secret
  // GitHub reviendrait à ranger la clé à côté du coffre.
  { name: "SECRETS_KEY", value: g("SECRETS_KEY"), secret: true },
  { name: "RESEND_API_KEY", value: g("RESEND_API_KEY"), secret: true, optional: true },
  { name: "RESEND_TEST_MODE", value: g("RESEND_TEST_MODE") || "true" },
  // Le routage. `ROUTING_SECRET` ouvre `routing.hotes` au service
  // `routeur` ; les trois domaines sont le REPLI de cette query — ce
  // qu'elle rend tant que personne n'a déclaré de domaine depuis
  // `/settings/domaine`, c'est-à-dire l'état d'un déploiement neuf.
  //
  // Ils vivent sur CONVEX et non plus dans le compose : depuis que Traefik
  // lit un fichier au lieu de labels, aucun conteneur ne les interpole. Un
  // `WEB_DOMAIN` manquant ici ferait lever la query en `NOT_CONFIGURED`,
  // donc le service n'écrirait aucun routage — un site debout et injoignable
  // sur un déploiement pourtant vert.
  //
  // `UMAMI_DOMAIN` est le cas particulier : c'est sa PRÉSENCE qui dit qu'un
  // tableau de bord Umami est déployé. Posée pour un Umami absent, Traefik
  // demanderait un certificat pour un nom sans enregistrement DNS — et
  // chaque échec compte dans le quota Let's Encrypt.
  { name: "ROUTING_SECRET", value: g("ROUTING_SECRET"), secret: true },
  { name: "WEB_DOMAIN", value: g("WEB_DOMAIN") },
  { name: "ADMIN_DOMAIN", value: g("ADMIN_DOMAIN") },
  { name: "UMAMI_DOMAIN", value: UMAMI_DOMAIN },
];

// Les secrets de docker/README.md §7, dans son ordre.
//
// CINQ secrets référencés par `deploy.yml` ne sont PAS dans cette liste, et
// il faut les nommer tous les cinq — en annoncer trois donnait une liste
// qu'on croyait complète :
//
//   PUBLIC_UMAMI_URL, PUBLIC_UMAMI_WEBSITE_ID, PUBLIC_UMAMI_RECORDER,
//   PUBLIC_META_PIXEL_ID, PUBLIC_GOOGLE_TAG_ID
//
// Aucune de ces valeurs n'existe avant qu'un humain ait ouvert Umami ou la
// console de l'annonceur, donc ce script n'a rien à en dire. Elles se
// posent à la main (docker/README.md §7 et §13), et leur absence est sans
// conséquence pour le build : le site ne mesure alors rien et n'appelle
// aucun tiers. C'est le trou assumé que `check-env-wiring.mjs` documente
// aussi, sous « ce qu'il ne vérifie pas ».
const GITHUB_SECRETS = [
  { name: "CONVEX_DEPLOY_KEY", value: g("CONVEX_DEPLOY_KEY"), secret: true },
  { name: "PUBLIC_CONVEX_URL", value: g("CONVEX_CLOUD_URL") },
  { name: "VITE_CONVEX_URL", value: g("CONVEX_CLOUD_URL") },
  { name: "VITE_CONVEX_SITE_URL", value: g("CONVEX_SITE_URL") },
  { name: "VITE_WEB_SITE_URL", value: WEB_ORIGIN },
  // `WEB_DOMAIN` N'EST PLUS ICI : elle était un secret GitHub pour le seul
  // build-arg de l'image `web` (`security.allowedDomains`, figé au build).
  // La reconnaissance de l'hôte est passée au runtime
  // (apps/web/src/lib/allowedDomains.ts), `deploy.yml` ne la passe plus, et
  // un secret que personne ne lit est un secret qu'on croit à jour. Elle
  // reste posée sur le déploiement Convex, plus bas : c'est le repli de
  // `routing.hotes`.
  { name: "VPS_HOST", value: g("VPS_HOST") },
  { name: "VPS_USER", value: g("VPS_USER") },
  { name: "VPS_SSH_KEY", source: "fichier", secret: true },
  { name: "VPS_SSH_KNOWN_HOSTS", source: "ssh-keyscan", secret: true },
];

// La clé de déploiement suffit à désigner le déploiement visé : c'est
// exactement ce que fait `deploy.yml`. Aucun CONVEX_DEPLOYMENT local n'est
// requis, et aucune valeur ne passe par argv — `convex env set NAME` sans
// valeur lit son entrée sur stdin. Partagée par les étapes 3 et 7, qui
// visent le même déploiement avec les mêmes identifiants.
const convexEnv = { CONVEX_DEPLOY_KEY: g("CONVEX_DEPLOY_KEY") };

/**
 * Appelle une function Convex par la CLI, avec la clé de déploiement.
 *
 * Les arguments passent par argv, à la différence de `convex env set` juste
 * au-dessus : ce ne sont pas des secrets (un slug, une adresse email), et
 * `convex run` ne sait de toute façon pas les lire ailleurs.
 */
function convexRun(name, args) {
  return run(CONVEX_BIN, args === undefined ? ["run", name] : ["run", name, JSON.stringify(args)], {
    cwd: BACKEND_DIR,
    env: convexEnv,
  });
}

/**
 * Vrai quand l'échec dit « cette function n'existe pas sur le déploiement ».
 *
 * C'est le cas NORMAL d'une première exécution : `convex deploy` est la
 * première étape du workflow `Deploy`, et il n'a pas encore tourné. La
 * distinguer d'une vraie panne est ce qui permet à l'étape 7 de dire quoi
 * faire au lieu d'afficher une erreur qui ressemble à une casse.
 */
const functionsNotDeployed = (res) => /Could not find (public )?function/i.test(`${res.stderr}\n${res.stdout}`);

const summary = [];

// ── 3. Déploiement Convex ───────────────────────────────────────────────────

title("3 · Déploiement Convex — `convex env set`");

if (SKIP_CONVEX) {
  skip("sauté (--skip-convex)");
  summary.push(["Convex", "sauté"]);
} else if (!existsSync(CONVEX_BIN)) {
  skip(`binaire convex absent (${CONVEX_BIN}) — lancer \`pnpm install\` d'abord`);
  summary.push(["Convex", "sauté — dépendances non installées"]);
} else {
  let posed = 0;
  for (const v of CONVEX_VARS) {
    if (v.optional && !v.value) {
      skip(
        `${v.name.padEnd(20)} non posée (valeur vide). Conséquence documentée : les invitations sont bien créées, c'est l'envoi PROGRAMMÉ qui échoue — un job en échec dans le dashboard Convex, jamais un échec d'invitation.`,
      );
      continue;
    }
    const cmd = `${CONVEX_BIN} env set ${v.name}   ${C.dim}(valeur lue sur stdin)${C.r}`;
    if (DRY) {
      skip(`${v.name.padEnd(20)} ${cmd}`);
      continue;
    }
    // Relire avant d'écrire : le script doit pouvoir tourner deux fois sans
    // reposer inutilement une valeur identique, et sans rien afficher d'elle.
    const cur = run(CONVEX_BIN, ["env", "get", v.name], { cwd: BACKEND_DIR, env: convexEnv });
    if (!cur.failed && cur.stdout === v.value) {
      ok(`${v.name.padEnd(20)} inchangé · ${describe(v.value, v.secret)}`);
      posed += 1;
      continue;
    }
    const res = run(CONVEX_BIN, ["env", "set", v.name], { input: v.value, cwd: BACKEND_DIR, env: convexEnv });
    if (res.failed) {
      bad(`${v.name.padEnd(20)} échec — ${res.stderr.split("\n").at(-1) || res.error?.message || `code ${res.code}`}`);
      continue;
    }
    ok(`${v.name.padEnd(20)} posé     · ${describe(v.value, v.secret)}`);
    posed += 1;
  }
  summary.push(["Convex", DRY ? `${CONVEX_VARS.length} variables (dry-run)` : `${posed} variables posées`]);
}

// ── 4. Secrets GitHub Actions ───────────────────────────────────────────────

title("4 · Secrets GitHub Actions — `gh secret set`");

const repo = g("GITHUB_REPOSITORY");

if (SKIP_GITHUB) {
  skip("sauté (--skip-github)");
  summary.push(["GitHub", "sauté"]);
} else if (!have("gh")) {
  skip(`\`gh\` introuvable — installer GitHub CLI, ou poser les ${GITHUB_SECRETS.length} secrets à la main (docker/README.md §7)`);
  summary.push(["GitHub", "sauté — gh absent"]);
} else if (run("gh", ["auth", "status"]).failed) {
  skip("`gh` non authentifié — lancer `gh auth login`");
  summary.push(["GitHub", "sauté — gh non authentifié"]);
} else {
  // Le dépôt est nommé explicitement, toujours. Un clone du template n'a
  // souvent aucun remote git configuré : `gh secret set` sans `--repo`
  // échouerait alors sur « no git remote found », ce qui ressemble à une
  // panne de gh et n'en est pas une.
  const remotes = run("git", ["remote"], { cwd: ROOT });
  if (remotes.stdout === "") {
    info(`aucun remote git configuré ici — d'où \`--repo ${repo}\`, lu dans .env.deploy (GITHUB_REPOSITORY)`);
  }

  // Deux de ces secrets ne sont pas des valeurs saisies mais des fichiers.
  const keyPath = expandHome(g("VPS_SSH_KEY_PATH"));
  const byName = new Map(GITHUB_SECRETS.map((s) => [s.name, s]));
  byName.get("VPS_SSH_KEY").value = readFileSync(keyPath, "utf8");
  info(`VPS_SSH_KEY lu depuis ${keyPath} (${statSync(keyPath).size} octets) — jamais recopié ailleurs`);

  const host = g("VPS_HOST");
  if (DRY) {
    skip(`VPS_SSH_KNOWN_HOSTS serait produit par \`ssh-keyscan -H ${host}\` (une connexion sortante vers le VPS)`);
  } else {
    info(`VPS_SSH_KNOWN_HOSTS : appel de \`ssh-keyscan -H ${host}\`…`);
    const scan = run("ssh-keyscan", ["-H", host]);
    const lines = scan.stdout.split("\n").filter((l) => l && !l.startsWith("#"));
    if (scan.failed || lines.length === 0) {
      bad(`ssh-keyscan n'a rien rendu pour ${host} — le VPS répond-il en SSH ? Ce secret restera à poser à la main.`);
      byName.get("VPS_SSH_KNOWN_HOSTS").value = "";
    } else {
      byName.get("VPS_SSH_KNOWN_HOSTS").value = `${lines.join("\n")}\n`;
      info(`${lines.length} clé(s) d'hôte relevée(s)`);
    }
  }

  const existing = DRY ? "" : run("gh", ["secret", "list", "--repo", repo]).stdout;
  const alreadySet = new Set(existing.split("\n").map((l) => l.split(/\s/)[0]).filter(Boolean));

  let posed = 0;
  for (const s of GITHUB_SECRETS) {
    // En dry-run, `VPS_SSH_KNOWN_HOSTS` n'a volontairement pas de valeur :
    // la produire exigerait la connexion sortante qu'on s'interdit ici. Ne
    // pas la confondre avec une valeur réellement introuvable.
    const deferred = DRY && s.source === "ssh-keyscan";
    if (!s.value && !deferred) {
      bad(`${s.name.padEnd(22)} valeur indisponible — non posé`);
      continue;
    }
    if (DRY) {
      skip(
        `${s.name.padEnd(22)} gh secret set ${s.name} --repo ${repo}   ${C.dim}(valeur lue sur stdin${deferred ? ", après le ssh-keyscan ci-dessus" : ""})${C.r}`,
      );
      continue;
    }
    // stdin, jamais argv : `gh secret set NAME` sans `--body` lit son entrée
    // standard. Un `--body "$SECRET"` exposerait la valeur dans `ps` et dans
    // l'historique du shell appelant.
    const res = run("gh", ["secret", "set", s.name, "--repo", repo], { input: s.value });
    if (res.failed) {
      bad(`${s.name.padEnd(22)} échec — ${res.stderr.split("\n").at(-1) || `code ${res.code}`}`);
      continue;
    }
    ok(`${s.name.padEnd(22)} ${alreadySet.has(s.name) ? "remplacé" : "posé    "} · ${describe(s.value, s.secret)}`);
    posed += 1;
  }
  summary.push(["GitHub", DRY ? `${GITHUB_SECRETS.length} secrets vers ${repo} (dry-run)` : `${posed}/${GITHUB_SECRETS.length} secrets posés sur ${repo}`]);
}

// ── 5. `.env` de développement local ────────────────────────────────────────

title("5 · Développement local — apps/web/.env.local, apps/admin/.env.local");

/**
 * `.env.local` et non `.env` : c'est le nom que les deux `.env.example`
 * demandent de créer, et c'est celui que Vite et Astro chargent EN DERNIER,
 * donc en priorité. Écrire `.env` alors qu'un `.env.local` existe déjà — le
 * cas de quiconque a suivi l'en-tête de l'exemple avant de découvrir ce
 * script — produirait un fichier généré silencieusement masqué, et un
 * `PREVIEW_SECRET` qui ne correspond pas à celui de Convex sans que rien ne
 * le signale.
 *
 * Recopie un `.env.example` en `.env.local` en n'y substituant que les valeurs
 * dont
 * ce script dispose. Les commentaires sont conservés : ce sont eux qui
 * documentent chaque variable, et ils font autorité (README).
 *
 * Les URLs Convex restent au défaut LOCAL de l'exemple, délibérément : le
 * `.env.deploy` porte les URLs de PRODUCTION, et les pointer ici ferait
 * travailler `pnpm dev` contre le déploiement de production. Seuls les deux
 * secrets HMAC sont injectés — ce sont eux qu'AGENTS.md exige « byte-identical »
 * avec le déploiement Convex, parce qu'ils sont vérifiés des deux côtés d'une
 * frontière.
 */
function renderLocalEnv(examplePath, values) {
  const header = [
    "# Généré par `pnpm bootstrap` depuis .env.deploy et ce fichier .env.example.",
    "# Gitignoré. Les commentaires ci-dessous viennent de l'exemple et font foi.",
    "#",
    "# Les URLs Convex sont restées au défaut LOCAL : `.env.deploy` porte celles",
    "# de production, qui sont parties en secrets GitHub et dans .env.vps.",
    "# Remplacez-les par ce que `npx convex dev` affiche pour VOTRE déploiement.",
    "",
  ];
  const body = readFileSync(examplePath, "utf8")
    .split("\n")
    .map((line) => {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=/);
      if (!m || !(m[1] in values)) return line;
      return `${m[1]}=${values[m[1]]}`;
    });
  return [...header, ...body].join("\n");
}

const LOCAL_TARGETS = [
  {
    example: join(ROOT, "apps", "web", ".env.example"),
    target: join(ROOT, "apps", "web", ".env.local"),
    values: { PREVIEW_SECRET: g("PREVIEW_SECRET"), REVALIDATE_SECRET: g("REVALIDATE_SECRET") },
  },
  {
    example: join(ROOT, "apps", "admin", ".env.example"),
    target: join(ROOT, "apps", "admin", ".env.local"),
    values: {},
  },
];

for (const t of LOCAL_TARGETS) {
  const rel = t.target.slice(ROOT.length + 1);
  if (DRY) {
    const injected = Object.keys(t.values);
    skip(`${rel.padEnd(20)} serait écrit depuis ${t.example.slice(ROOT.length + 1)}${injected.length ? ` · injecté : ${injected.join(", ")}` : " · copie conforme (aucune valeur de production n'y a sa place)"}`);
    continue;
  }
  const content = renderLocalEnv(t.example, t.values);
  const unchanged = existsSync(t.target) && readFileSync(t.target, "utf8") === content;
  writeFileSync(t.target, content, { mode: 0o600 });
  ok(`${rel.padEnd(20)} ${unchanged ? "inchangé" : "écrit   "}`);
  for (const [k, v] of Object.entries(t.values)) info(`  ${k} · ${describe(v, true)}`);
}
summary.push(["Dev local", DRY ? "2 fichiers (dry-run)" : "apps/web/.env.local, apps/admin/.env.local"]);

info("rappel: `astro dev` ne charge PAS PREVIEW_SECRET/REVALIDATE_SECRET dans process.env — les exporter dans le shell (apps/web/.env.example, note de fin)");

// ── 6. Bloc pour le `.env` du VPS ───────────────────────────────────────────

title("6 · VPS — .env.vps, à copier à la main");

// Le script ne se connecte pas au VPS pour l'écrire : le `.env` de la machine
// est le seul fichier que le déploiement n'écrase jamais (`rsync --exclude`),
// et c'est ce qui en fait le point de vérité local. Le remplir depuis
// l'extérieur en ferait une copie d'ici, silencieusement périmée.
const vpsContent = `# Généré par \`pnpm bootstrap\` — à copier dans ~/astrotan/.env SUR LE VPS.
# Gitignoré, jamais commité, jamais poussé automatiquement.
# docker/.env.example reste la référence sur ce que chaque variable signifie.

GHCR_OWNER=${g("GHCR_OWNER")}

# La CI passe IMAGE_TAG=<sha> en tête de la commande compose, et une variable
# de commande l'emporte sur le .env : cette ligne ne sert qu'à un
# \`docker compose up\` lancé à la main sur la machine (docker/README.md §4).
IMAGE_TAG=latest

# Le domaine du site. Depuis que Traefik lit un fichier au lieu de labels,
# c'est la copie CONVEX de ces trois valeurs qui décide du routage (posée
# à l'étape 3 ci-dessus) ; celle-ci ne sert plus qu'au conteneur \`web\`,
# qui compare son domaine à celui figé dans son image.
WEB_DOMAIN=${g("WEB_DOMAIN")}
# Plus interpolée par le compose : elle est ici parce que docker/.env.example
# la documente et qu'un opérateur s'attend à la trouver à côté de l'autre.
ADMIN_DOMAIN=${g("ADMIN_DOMAIN")}
ACME_EMAIL=${g("ACME_EMAIL")}

# DÉCOMMENTER POUR LE PREMIER ESSAI (docker/README.md §5). La production
# Let's Encrypt plafonne à 5 certificats par 7 jours, sans remise à zéro
# possible : un premier démarrage raté sur le CA de production coûte une
# semaine sur ce domaine.
# ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory

VITE_CONVEX_URL=${g("CONVEX_CLOUD_URL")}
VITE_CONVEX_SITE_URL=${g("CONVEX_SITE_URL")}

# Clés HMAC, identiques à celles du déploiement Convex — c'est leur égalité
# qui fait fonctionner la prévisualisation, l'invalidation de cache, le
# formulaire de contact et le journal de consentement. Chacune est vérifiée
# des deux côtés d'une frontière : divergente, elle ne dégrade pas, elle
# refuse — en silence, du point de vue du visiteur.
PREVIEW_SECRET=${g("PREVIEW_SECRET")}
REVALIDATE_SECRET=${g("REVALIDATE_SECRET")}
LEAD_SUBMIT_SECRET=${g("LEAD_SUBMIT_SECRET")}
CONSENT_LOG_SECRET=${g("CONSENT_LOG_SECRET")}

# La clé du service \`routeur\`, qui suit le domaine déclaré et réécrit le
# routage de Traefik. Identique à celle posée sur Convex ci-dessus.
# Divergente, le routage reste figé : le site sert, mais changer de domaine
# depuis l'administration n'a plus aucun effet.
ROUTING_SECRET=${g("ROUTING_SECRET")}

# ── Umami ───────────────────────────────────────────────────────────────────
# Le sous-domaine du tableau de bord. Son DNS doit pointer sur ce VPS avant
# le premier démarrage, comme les deux autres (quota Let's Encrypt). Elle
# aussi est passée côté Convex : c'est sa présence là-bas qui dit à
# \`routing.hotes\` qu'un Umami est déployé.
UMAMI_DOMAIN=${UMAMI_DOMAIN}

# Secrets d'Umami : ils ne quittent jamais ce fichier — ni image, ni
# build-arg, ni déploiement Convex. Changer UMAMI_DB_PASSWORD APRÈS le
# premier démarrage ne change pas le mot de passe déjà écrit dans le volume
# (Postgres ne l'applique qu'à l'initialisation) : il faut alors un
# \`ALTER USER\` dans la base.
UMAMI_DB_PASSWORD=${g("UMAMI_DB_PASSWORD")}
UMAMI_APP_SECRET=${g("UMAMI_APP_SECRET")}
UMAMI_TWO_FACTOR_ENCRYPTION_KEY=${g("UMAMI_TWO_FACTOR_ENCRYPTION_KEY")}
`;

if (DRY) {
  skip(`.env.vps serait écrit — ACME_CA_SERVER laissée commentée`);
} else {
  const unchanged = existsSync(VPS_FILE) && readFileSync(VPS_FILE, "utf8") === vpsContent;
  writeFileSync(VPS_FILE, vpsContent, { mode: 0o600 });
  ok(`.env.vps ${unchanged ? "inchangé" : "écrit"} (mode 600, gitignoré)`);
  info(`PREVIEW_SECRET · ${describe(g("PREVIEW_SECRET"), true)}`);
  info(`REVALIDATE_SECRET · ${describe(g("REVALIDATE_SECRET"), true)}`);
}
summary.push(["VPS", DRY ? ".env.vps (dry-run)" : ".env.vps prêt à copier"]);

out(`
  Copie, telle quelle :

    ${C.cyn}ssh ${g("VPS_USER")}@${g("VPS_HOST")} 'mkdir -p ~/astrotan'${C.r}
    ${C.cyn}scp .env.vps ${g("VPS_USER")}@${g("VPS_HOST")}:~/astrotan/.env${C.r}
    ${C.cyn}ssh ${g("VPS_USER")}@${g("VPS_HOST")} 'chmod 600 ~/astrotan/.env'${C.r}
`);

// ── 7. Contenu initial et premier accès ─────────────────────────────────────

title("7 · Contenu initial et premier accès — `convex run`");

// Malgré son nom, `seed:demoContent` n'est pas de la décoration. C'est le
// SEUL code du dépôt qui crée des lignes `pages` — les sept slugs du
// template, dont les trois pages réglementaires — et la ligne `settings`
// qui porte `homePageSlug`.
//
// Une page est un couple : son fichier `.astro` ET sa ligne (invariant 5 de
// CLAUDE.md — l'administration décide qui doit trouver la page, jamais ce
// qu'elle contient). Sans les lignes, un déploiement dont le pipeline est
// vert et dont les conteneurs sont `healthy` sert `/` en corps 404 et
// répond 404 sur les sept autres URL. Rien, nulle part, ne dit que c'est
// un amorçage manquant plutôt qu'une panne : c'est précisément pour ça que
// cette étape est ici et non dans une ligne de README.
//
// Idempotent par slug : le relancer ne change rien et saute toute ligne
// existante, ce qui est ce qui rend ce script rejouable sans condition.

if (SKIP_CONVEX || SKIP_SEED) {
  skip(`sauté (${SKIP_CONVEX ? "--skip-convex" : "--skip-seed"}) — sans les lignes \`pages\`, toutes les URL du site répondent 404`);
  summary.push(["Contenu", "sauté"]);
} else if (!existsSync(CONVEX_BIN)) {
  skip(`binaire convex absent — lancer \`pnpm install\` d'abord`);
  summary.push(["Contenu", "sauté — dépendances non installées"]);
} else if (DRY) {
  skip(`seed:demoContent   ${CONVEX_BIN} run seed:demoContent   ${C.dim}(idempotent par slug)${C.r}`);
  summary.push(["Contenu", "seed:demoContent (dry-run)"]);
} else {
  const res = convexRun("seed:demoContent");
  if (res.failed && functionsNotDeployed(res)) {
    // Le seul ordre possible sur une installation neuve : ce script tourne
    // AVANT le premier déploiement, et `convex deploy` (première étape du
    // workflow `Deploy`) est ce qui met les functions sur le déploiement.
    // D'où le rappel n° 6 de l'épilogue, et d'où l'exigence que ce script
    // soit rejouable.
    skip("seed:demoContent n'est pas encore sur le déploiement — normal avant le premier `convex deploy`");
    info("relancez `pnpm bootstrap` après le premier déploiement : cette étape sera alors la seule qui reste");
    summary.push(["Contenu", "à refaire après le premier déploiement"]);
  } else if (res.failed) {
    bad(`seed:demoContent a échoué — ${res.stderr.split("\n").at(-1) || `code ${res.code}`}`);
    summary.push(["Contenu", "échec"]);
  } else {
    // La function rend `{tags, pages, posts, author}` : ce qu'elle a
    // RÉELLEMENT créé, zéro compris. Un « 0 page créée » sur un
    // déploiement déjà amorcé est la bonne nouvelle, pas un échec, et
    // l'afficher évite d'avoir à le deviner.
    let compte = null;
    try {
      compte = JSON.parse(res.stdout);
    } catch {
      /* La CLI a changé sa sortie : on garde le succès, on perd le détail. */
    }
    ok(
      compte
        ? `seed:demoContent  ${compte.pages} page(s), ${compte.posts} article(s), ${compte.tags} tag(s) créé(s)${compte.pages === 0 ? `  ${C.dim}— déjà amorcé, rien à faire${C.r}` : ""}`
        : "seed:demoContent  exécuté",
    );
    summary.push(["Contenu", compte ? `${compte.pages} page(s) créée(s)` : "exécuté"]);
  }
}

// L'accès au dashboard est sur INVITATION SEULE : `disableSignUp: true`,
// pas d'OAuth, et émettre une invitation exige d'être déjà owner ou admin.
// Sur un déploiement neuf, personne ne peut donc entrer — pas même celui
// qui vient de tout installer. `bootstrap:createInvitation` est la seule
// issue, et elle n'existait que dans une ligne de CLAUDE.md.
//
// `role: "owner"`, jamais `"admin"`, et ce n'est pas un détail de goût :
// `invitations.create` refuse `role: "owner"` à TOUT LE MONDE, et un admin
// ne peut ni inviter un autre admin, ni promouvoir, ni rétrograder, ni
// supprimer un admin. Un déploiement dont le premier compte est admin n'a
// donc jamais d'owner et reste plafonné à un seul administrateur, sans
// issue par l'interface. `convex/bootstrap.test.ts` épingle les deux
// moitiés du raisonnement.
//
// Aucun mot de passe ne transite : le script rend un lien, la personne
// choisit son mot de passe sur la page d'acceptation normale.

const ADMIN_EMAIL_DEFAUT = g("ADMIN_EMAIL") || g("ACME_EMAIL");

if (SKIP_CONVEX || SKIP_INVITE) {
  skip(`sauté (${SKIP_CONVEX ? "--skip-convex" : "--skip-invite"}) — sur un déploiement neuf, personne ne peut alors entrer dans le dashboard`);
  summary.push(["Accès", "sauté"]);
} else if (!existsSync(CONVEX_BIN)) {
  skip("binaire convex absent — voir ci-dessus");
  summary.push(["Accès", "sauté — dépendances non installées"]);
} else if (DRY) {
  skip(`bootstrap:owners       ${C.dim}(y a-t-il déjà un owner ? si oui, l'invitation est sautée)${C.r}`);
  skip(`bootstrap:createInvitation  {"email":"${ADMIN_EMAIL_DEFAUT}","role":"owner"}`);
  info(`l'adresse serait confirmée au terminal ; \`ADMIN_EMAIL\` dans .env.deploy la fige sans question`);
  summary.push(["Accès", "invitation owner (dry-run)"]);
} else {
  const dejaOwners = convexRun("bootstrap:owners");
  let owners = null;
  if (!dejaOwners.failed) {
    try {
      owners = JSON.parse(dejaOwners.stdout);
    } catch {
      /* Sortie inattendue : on retombe sur « je ne sais pas », traité plus bas. */
    }
  }

  if (dejaOwners.failed && functionsNotDeployed(dejaOwners)) {
    skip("bootstrap:createInvitation n'est pas encore sur le déploiement — même raison qu'au-dessus");
    summary.push(["Accès", "à refaire après le premier déploiement"]);
  } else if (Array.isArray(owners) && owners.length > 0) {
    // Le cas de la SECONDE exécution, et la raison pour laquelle il est
    // traité : `createInvitation` n'est pas idempotent. Relancé après
    // qu'un owner a accepté, il émettrait un lien de plus, valide en
    // apparence, que le garde-fou `owners > 0` d'`auth.ts` refusera au
    // moment de l'acceptation. Un lien mort distribué à chaque exécution
    // est pire que pas de lien du tout.
    ok(`un owner existe déjà (${owners.join(", ")}) — aucune invitation émise`);
    info("les comptes suivants s'invitent depuis le dashboard, plus jamais par cette commande");
    summary.push(["Accès", "déjà en place"]);
  } else {
    const saisie = demanderAuTerminal(
      "Adresse email du premier compte (rôle owner, le seul qui pourra en créer d'autres) :",
      ADMIN_EMAIL_DEFAUT,
    );
    const email = saisie ?? ADMIN_EMAIL_DEFAUT;
    if (saisie === null) {
      info(`adresse retenue : ${email}${g("ADMIN_EMAIL") ? " (ADMIN_EMAIL)" : " (ACME_EMAIL, faute d'ADMIN_EMAIL)"}`);
    } else if (!writeBackAnswer(DEPLOY_FILE, "ADMIN_EMAIL", email)) {
      info(`ajoutez \`ADMIN_EMAIL=${email}\` à .env.deploy pour ne plus avoir la question`);
    }

    const res = convexRun("bootstrap:createInvitation", { email, role: "owner" });
    if (res.failed && /ALREADY_INVITED/.test(res.stderr)) {
      // Refus délibéré de `createInvitation` : deux liens vivants pour un
      // même compte est une question à laquelle personne ne veut répondre
      // plus tard. Le jeton précédent n'est pas réaffichable — la base n'en
      // porte que le hash — et c'est la bonne propriété.
      ok(`une invitation est déjà en attente pour ${email} — le lien précédent reste valable 7 jours`);
      info("le jeton n'est pas réaffichable (seul son hash est stocké) : le récupérer demande de laisser expirer l'invitation, ou de l'accepter");
      summary.push(["Accès", "invitation déjà en attente"]);
    } else if (res.failed) {
      bad(`bootstrap:createInvitation a échoué — ${res.stderr.split("\n").at(-1) || `code ${res.code}`}`);
      summary.push(["Accès", "échec"]);
    } else {
      let invitation = null;
      try {
        invitation = JSON.parse(res.stdout);
      } catch {
        /* idem */
      }
      if (invitation?.token) {
        ok(`invitation owner émise pour ${email}`);
        // LA SEULE VALEUR SENSIBLE QUE CE SCRIPT AFFICHE, et l'exception
        // est assumée : un lien à usage unique, valable 7 jours, qui n'a
        // aucune utilité s'il n'atteint pas un humain. Il ne donne rien
        // de plus que ce que la clé de déploiement déjà en main permet.
        out(`
    ${C.cyn}${ADMIN_ORIGIN}/accept-invite?token=${invitation.token}${C.r}

    Ouvrez ce lien et choisissez votre mot de passe sur la page normale.
    ${C.dim}Aucun mot de passe ne passe par ce script ni par votre historique.${C.r}
`);
        summary.push(["Accès", `invitation owner pour ${email}`]);
      } else {
        bad("bootstrap:createInvitation n'a pas rendu de jeton — sortie inattendue de la CLI");
        summary.push(["Accès", "échec"]);
      }
    }
  }
}

// ── Récapitulatif ───────────────────────────────────────────────────────────

title(DRY ? "Récapitulatif — RIEN N'A ÉTÉ FAIT (--dry-run)" : "Récapitulatif");
for (const [where, what] of summary) out(`  ${C.b}${where.padEnd(10)}${C.r} ${what}`);

out(`
${C.b}Ce qui reste à votre charge${C.r} — le script ne peut pas le faire pour vous :

  1. ${C.cyn}GHCR${C.r} — les packages sont PRIVÉS par défaut. Les rendre publics, ou
     authentifier le VPS par un PAT \`read:packages\`. Prérequis bloquant,
     à trancher avant le premier déploiement.        ${C.dim}docker/README.md §2${C.r}
  2. ${C.cyn}DNS${C.r} — ${g("WEB_DOMAIN")} et ${g("ADMIN_DOMAIN")} en A/AAAA sur le VPS,
     AVANT tout démarrage. Attention au proxy Cloudflare (nuage orange) :
     il casse le challenge HTTP-01.                  ${C.dim}docker/README.md §3${C.r}
  3. ${C.cyn}.env du VPS${C.r} — copier .env.vps (commandes ci-dessus).
                                                     ${C.dim}docker/README.md §4${C.r}
  4. ${C.cyn}CA de staging${C.r} — décommenter ACME_CA_SERVER pour le premier essai,
     vérifier l'émetteur, puis repasser en production et supprimer le
     volume astrotan_acme.                           ${C.dim}docker/README.md §5${C.r}
  5. ${C.cyn}Premier déploiement${C.r} — pousser sur main et regarder le workflow
     Deploy.                                         ${C.dim}docker/README.md §8${C.r}
  6. ${C.cyn}Relancer \`pnpm bootstrap\`${C.r} — une fois, après ce premier
     déploiement. C'est \`convex deploy\` qui met les functions sur le
     déploiement ; avant lui, l'étape 7 ci-dessus n'a rien à appeler. Ce
     second passage ne repose aucun secret : il crée les lignes \`pages\`
     sans lesquelles TOUTES les URL du site répondent 404, et rend le lien
     du premier compte — sans lui, personne n'entre dans le dashboard.
                                                     ${C.dim}docker/README.md §8${C.r}
  7. ${C.cyn}Mesure d'audience${C.r}, facultative — cinq secrets GitHub que ce script ne
     pose pas, parce qu'aucune de leurs valeurs n'existe avant qu'un humain
     ait ouvert Umami ou la console d'un annonceur :
     PUBLIC_UMAMI_URL, PUBLIC_UMAMI_WEBSITE_ID, PUBLIC_UMAMI_RECORDER,
     PUBLIC_META_PIXEL_ID, PUBLIC_GOOGLE_TAG_ID. Absentes, le site ne mesure
     rien et n'appelle aucun tiers — c'est un défaut sûr, pas une panne.
                                                     ${C.dim}docker/README.md §7 et §13${C.r}
${DRY ? `\n${C.ylw}Relancez sans --dry-run pour appliquer.${C.r}` : ""}`);
