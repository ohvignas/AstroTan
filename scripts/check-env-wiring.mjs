#!/usr/bin/env node
// scripts/check-env-wiring.mjs — les deux moitiés d'une variable
// d'environnement doivent exister toutes les deux.
//
// POURQUOI CE FICHIER EXISTE
//
// Une variable d'environnement a toujours deux moitiés : l'endroit qui la
// LIT (du code, dans `apps/`) et l'endroit qui la POSE (un `environment:` de
// compose, un `ARG` de Dockerfile, un `build-args` de workflow). Écrire la
// première sans la seconde est le défaut le plus répété de ce dépôt, et le
// plus coûteux, parce qu'il ne casse rien en développement — où le `.env`
// local porte tout — et qu'il produit en production une panne SILENCIEUSE :
//
//   · `PUBLIC_UMAMI_*` lues par `Analytics.astro`, jamais passées en
//     build-arg (25b0b43) — le site ne mesurait rien, sans erreur ;
//   · `LEAD_SUBMIT_SECRET` lue par `pages/api/contact.ts`, absente du
//     compose — le formulaire de contact refusait CHAQUE envoi ;
//   · `CONSENT_LOG_SECRET` lue par `pages/api/consent.ts`, absente du
//     compose — le journal de consentement répondait 204 sans rien écrire ;
//   · `PUBLIC_META_PIXEL_ID` / `PUBLIC_GOOGLE_TAG_ID` lues par le bandeau,
//     ni `ARG` ni build-arg — le parcours de consentement entier était
//     inatteignable, et son absence ressemble au comportement normal d'un
//     site sans traceur ;
//   · les quatre `UMAMI_*` exigées par le compose en `${VAR:?}`, absentes
//     du `.env.vps` que produit `pnpm bootstrap` — et absentes de l'étape
//     de validation compose de la CI, qui échouait donc pour de bon.
//
// Aucun de ces cinq écarts n'était visible à la relecture, parce que chaque
// moitié, prise seule, avait l'air complète. Ce script les met face à face.
//
// CE QU'IL VÉRIFIE — trois écarts, chacun dérivé des fichiers eux-mêmes,
// jamais d'une liste tenue à la main (une liste à la main est un troisième
// endroit à oublier) :
//
//   1. RUNTIME  — tout `process.env.X` lu par du code servi doit être
//      déclaré pour le conteneur : `environment:` du service dans
//      docker-compose.yml, ou `ENV` de l'étape `runtime` du Dockerfile.
//   2. BUILD    — tout `import.meta.env.PUBLIC_*` / `VITE_*` doit être un
//      `ARG` du Dockerfile ET un `build-args` de deploy.yml. Les deux : un
//      `ARG` sans build-arg vaut la chaîne vide, exactement comme un `ARG`
//      absent.
//   3. AMORÇAGE — toute variable que le compose exige en `${VAR:?}` doit
//      être documentée dans docker/.env.example ET écrite par
//      `pnpm bootstrap` dans `.env.vps`, sans quoi le premier `compose up`
//      d'un adoptant échoue.
//
// CE QU'IL NE VÉRIFIE PAS, et qu'il ne faut donc pas croire vérifié :
//
//   · qu'une valeur soit JUSTE. Il compare des noms, pas des contenus : un
//     `PREVIEW_SECRET` posé des deux côtés mais différent passe ce contrôle
//     et casse la prévisualisation ;
//   · le côté Convex. `packages/backend/convex/*.ts` lit ses propres
//     `process.env` (`LEAD_SUBMIT_SECRET`, `CONSENT_LOG_SECRET`,
//     `UMAMI_API_*`…) que `convex env set` pose, hors de toute image et hors
//     de ce dépôt de fichiers. Un secret partagé posé sur le VPS mais pas
//     sur Convex reste invisible ici ;
//   · les lectures dynamiques. Seul `process.env.NOM` littéral est reconnu ;
//     un `process.env[nom]` calculé échappe à l'analyse ;
//   · qu'un secret GitHub existe réellement dans les réglages du dépôt. Un
//     `build-args: X=${{ secrets.X }}` avec un secret non posé vaut la
//     chaîne vide et le build reste vert — c'est ce qui rend les variables
//     facultatives réellement facultatives, et c'est le trou assumé.
//
// Usage :
//   node scripts/check-env-wiring.mjs              audit, sort 1 sur écart
//   node scripts/check-env-wiring.mjs --compose-required
//                                                  les `${VAR:?}` du compose
//   node scripts/check-env-wiring.mjs --compose-env
//                                                  un .env bidon pour
//                                                  `docker compose config`
//
// Aucune dépendance npm, et volontairement aucun parseur YAML : ce script
// doit tourner avant `pnpm install`, et sur une machine d'adoptant.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = join(ROOT, "docker", "docker-compose.yml");
const ENV_EXAMPLE = join(ROOT, "docker", ".env.example");
const BOOTSTRAP = join(ROOT, "scripts", "bootstrap.mjs");
const DEPLOY_WORKFLOW = join(ROOT, ".github", "workflows", "deploy.yml");

// Les deux applications servies, et les trois fichiers qui posent leurs
// variables. C'est la SEULE table écrite à la main du script, et elle ne
// contient aucun nom de variable — seulement des chemins.
const APPS = [
  {
    name: "apps/web",
    // `src/` seulement : `astro.config.mjs` et les scripts de build tournent
    // sur le runner ou le poste de dev, pas dans le conteneur.
    sources: ["apps/web/src"],
    dockerfile: "docker/web.Dockerfile",
    service: "web",
  },
  {
    name: "apps/admin",
    // `serve.mjs` est le vrai point d'entrée du conteneur (voir le `CMD` de
    // docker/admin.Dockerfile) : ses `process.env` sont des lectures runtime
    // au même titre que celles de `src/`.
    sources: ["apps/admin/src", "apps/admin/serve.mjs"],
    dockerfile: "docker/admin.Dockerfile",
    service: "admin",
  },
];

/**
 * Variables fournies par la plateforme, jamais par nous.
 *
 * `DEV`/`PROD`/`MODE`/`SSR`/`BASE_URL`/`SITE` sont injectées par Vite et
 * Astro dans `import.meta.env`. `NODE_ENV` l'est par Node et par le
 * `ENV NODE_ENV=production` des deux images. Les exiger quelque part serait
 * demander de déclarer ce que le framework garantit.
 */
const PLATFORM = new Set(["DEV", "PROD", "MODE", "SSR", "BASE_URL", "SITE", "ASSETS_PREFIX", "NODE_ENV"]);

// ─── Utilitaires ────────────────────────────────────────────────────────────

const read = (p) => readFileSync(p, "utf8");

/** Fichiers de test : ils posent leurs propres variables, dans leur propre
 *  processus. Les inclure exigerait de déclarer dans le compose des clés que
 *  seul vitest utilise. */
const isTest = (p) => /(^|\/)(_tests|__tests__)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

function walk(abs, acc = []) {
  if (!existsSync(abs)) return acc;
  if (!statSync(abs).isDirectory()) {
    acc.push(abs);
    return acc;
  }
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    walk(join(abs, entry.name), acc);
  }
  return acc;
}

/**
 * Les lectures d'environnement d'un arbre de sources, par type d'accès.
 *
 * `process.env.X` est lu par le processus qui tourne dans le conteneur.
 * `import.meta.env.X` est REMPLACÉ par Vite/Astro à la compilation : sa
 * valeur est celle du build, et rien au démarrage ne peut plus la changer.
 * Confondre les deux est précisément l'erreur que ce script attrape.
 */
function readsOf(app) {
  const runtime = new Map(); // nom → [fichier:ligne, …]
  const build = new Map();
  for (const src of app.sources) {
    for (const file of walk(join(ROOT, src))) {
      const rel = relative(ROOT, file);
      if (isTest(rel)) continue;
      if (!/\.(astro|[cm]?[jt]sx?)$/.test(rel)) continue;
      const lines = read(file).split("\n");
      lines.forEach((line, i) => {
        for (const [re, target] of [
          [/process\.env\.([A-Z][A-Z0-9_]*)/g, runtime],
          [/import\.meta\.env\.([A-Z][A-Z0-9_]*)/g, build],
        ]) {
          for (const m of line.matchAll(re)) {
            if (PLATFORM.has(m[1])) continue;
            if (!target.has(m[1])) target.set(m[1], []);
            target.get(m[1]).push(`${rel}:${i + 1}`);
          }
        }
      });
    }
  }
  return { runtime, build };
}

/**
 * `ARG` et `ENV` d'un Dockerfile, en tenant compte des continuations `\`.
 * Les deux images en usent (`ENV NODE_ENV=production \` … ), et un parseur
 * ligne à ligne les manquerait sans rien dire.
 */
function dockerfileDecls(path) {
  const args = new Set();
  const envs = new Set();
  const text = read(join(ROOT, path)).replace(/\\\n/g, " ");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(ARG|ENV)\s+(.*)$/i);
    if (!m) continue;
    const target = m[1].toUpperCase() === "ARG" ? args : envs;
    for (const n of m[2].matchAll(/([A-Z][A-Z0-9_]*)\s*(?:=|$|\s)/g)) target.add(n[1]);
  }
  return { args, envs };
}

/**
 * Les clés `environment:` de chaque service du compose.
 *
 * Analyse par indentation plutôt que par parseur YAML — le fichier est écrit
 * à la main, avec une mise en forme stable. Le prix de ce raccourci est un
 * parseur qui pourrait cesser de reconnaître le fichier sans le dire : c'est
 * pourquoi `main()` échoue si la moisson est vide. Un garde-fou qui passe en
 * silence est le défaut qu'il prétend attraper.
 */
function composeServiceEnv() {
  const services = new Map();
  const lines = read(COMPOSE).split("\n");
  let inServices = false;
  let service = null;
  let inEnv = false;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^\S/.test(line)) break; // `networks:` / `volumes:` — fin du bloc
    const svc = line.match(/^ {2}([A-Za-z0-9._-]+):\s*$/);
    if (svc) {
      service = svc[1];
      services.set(service, new Set());
      inEnv = false;
      continue;
    }
    if (!service) continue;
    if (/^ {4}environment:\s*$/.test(line)) {
      inEnv = true;
      continue;
    }
    if (/^ {4}\S/.test(line)) inEnv = false; // une autre clé du service
    if (!inEnv) continue;
    const kv = line.match(/^ {6}([A-Z][A-Z0-9_]*):/);
    if (kv) services.get(service).add(kv[1]);
  }
  return services;
}

/** Les variables que le compose exige : `${VAR:?…}`, la forme qui refuse de
 *  démarrer plutôt que d'appliquer un défaut silencieux. */
function composeRequired() {
  return [...new Set([...read(COMPOSE).matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((m) => m[1]))].sort();
}

/**
 * Les `build-args` de deploy.yml, indexés par Dockerfile.
 *
 * Un `build-args:` est un bloc littéral YAML (`|`) : on suit l'indentation.
 * Le `file:` de la même étape identifie l'image, ce qui évite d'avoir à
 * connaître l'ordre des étapes.
 */
function workflowBuildArgs(path) {
  const byFile = new Map();
  const lines = read(path).split("\n");
  let currentFile = null;
  for (let i = 0; i < lines.length; i += 1) {
    const f = lines[i].match(/^\s*file:\s*(\S+)\s*$/);
    if (f) currentFile = f[1];
    const b = lines[i].match(/^(\s*)build-args:\s*\|\s*$/);
    if (!b || !currentFile) continue;
    const indent = b[1].length;
    const set = byFile.get(currentFile) ?? new Set();
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === "") continue;
      const lead = lines[j].match(/^\s*/)[0].length;
      if (lead <= indent) break;
      const name = lines[j].trim().match(/^([A-Z][A-Z0-9_]*)=/);
      if (name) set.add(name[1]);
    }
    byFile.set(currentFile, set);
  }
  return byFile;
}

/** Les variables que `pnpm bootstrap` écrit dans `.env.vps`, lues dans le
 *  gabarit du script lui-même. Une ligne commentée compte : `ACME_CA_SERVER`
 *  y est délibérément proposée sans être posée. */
function bootstrapVpsVars() {
  const text = read(BOOTSTRAP);
  const start = text.indexOf("const vpsContent = `");
  if (start < 0) return null;
  const body = text.slice(start + "const vpsContent = `".length);
  const end = body.indexOf("\n`;");
  if (end < 0) return null;
  return new Set([...body.slice(0, end).matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

/** Les variables documentées par docker/.env.example, commentées comprises. */
function envExampleVars() {
  return new Set([...read(ENV_EXAMPLE).matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

// ─── Modes annexes ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  // L'en-tête de ce fichier EST son aide : le bloc de commentaires qui suit
  // le shebang, jusqu'à la première ligne qui n'en est pas un. Pas de numéro
  // de ligne en dur — ce serait, à l'échelle d'un fichier, exactement le
  // genre de constante recopiée que ce script existe pour traquer.
  const lines = read(fileURLToPath(import.meta.url)).split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  process.stdout.write(lines.slice(0, end).join("\n").replace(/^\/\/ ?/gm, "") + "\n");
  process.exit(0);
}

if (argv.includes("--compose-required")) {
  process.stdout.write(composeRequired().join("\n") + "\n");
  process.exit(0);
}

if (argv.includes("--compose-env")) {
  // Un `.env` de validation, pour `docker compose config`. Aucune valeur
  // n'est plausible, et c'est le point : ce fichier ne doit jamais pouvoir
  // servir à autre chose qu'à prouver que l'interpolation aboutit. Il est
  // dérivé du compose, donc il ne peut plus prendre de retard sur lui — la
  // liste écrite à la main dans ci.yml, elle, en avait pris.
  const lines = [
    "# Généré par `node scripts/check-env-wiring.mjs --compose-env`.",
    "# Valeurs bidon, pour `docker compose config` UNIQUEMENT. Ne jamais",
    "# copier sur une machine : rien ici n'est un secret ni ne fonctionne.",
    ...composeRequired().map((name) => `${name}=ci-not-a-real-value`),
  ];
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(0);
}

if (argv.length > 0) {
  process.stderr.write(`option inconnue : ${argv.join(" ")} — voir --help\n`);
  process.exit(2);
}

// ─── Audit ──────────────────────────────────────────────────────────────────

const C = process.stdout.isTTY
  ? { r: "\x1b[0m", b: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", grn: "\x1b[32m" }
  : { r: "", b: "", dim: "", red: "", grn: "" };

const problems = [];
const notes = [];

const services = composeServiceEnv();
const workflowArgs = workflowBuildArgs(DEPLOY_WORKFLOW);
const required = composeRequired();
const vpsVars = bootstrapVpsVars();
const exampleVars = envExampleVars();

// Garde-fou du garde-fou : si l'un des parseurs ne reconnaît plus son
// fichier, il rendrait un ensemble vide et TOUT passerait. Mieux vaut un
// échec bruyant sur le script que le retour silencieux du défaut.
if (services.size === 0) problems.push(["parseur", "aucun service trouvé dans docker-compose.yml — la mise en forme a changé, corriger `composeServiceEnv()`"]);
if (required.length === 0) problems.push(["parseur", "aucun `${VAR:?}` trouvé dans docker-compose.yml — corriger `composeRequired()`"]);
if (workflowArgs.size === 0) problems.push(["parseur", "aucun `build-args:` trouvé dans deploy.yml — corriger `workflowBuildArgs()`"]);
if (vpsVars === null) problems.push(["parseur", "gabarit `.env.vps` introuvable dans scripts/bootstrap.mjs — corriger `bootstrapVpsVars()`"]);

for (const app of APPS) {
  const { runtime, build } = readsOf(app);
  const { args, envs } = dockerfileDecls(app.dockerfile);
  const serviceEnv = services.get(app.service) ?? new Set();
  const buildArgs = workflowArgs.get(app.dockerfile) ?? new Set();

  if (runtime.size === 0 && build.size === 0) {
    problems.push(["parseur", `aucune lecture d'environnement trouvée dans ${app.name} — les chemins de \`APPS\` sont-ils encore justes ?`]);
  }

  // 1. RUNTIME
  for (const [name, where] of runtime) {
    if (serviceEnv.has(name) || envs.has(name)) continue;
    problems.push([
      "runtime",
      `${name} — lue par ${where[0]}${where.length > 1 ? ` (+${where.length - 1})` : ""}, absente de \`services.${app.service}.environment\` (${relative(ROOT, COMPOSE)}) et des \`ENV\` de ${app.dockerfile}. Le conteneur la verra vide.`,
    ]);
  }

  // 2. BUILD
  for (const [name, where] of build) {
    if (!/^(PUBLIC_|VITE_)/.test(name)) continue;
    const missing = [];
    if (!args.has(name)) missing.push(`\`ARG\` dans ${app.dockerfile}`);
    if (!buildArgs.has(name)) missing.push("`build-args` de deploy.yml");
    if (missing.length === 0) continue;
    problems.push([
      "build",
      `${name} — lue par ${where[0]}${where.length > 1 ? ` (+${where.length - 1})` : ""}, manque : ${missing.join(" et ")}. Figée à la chaîne vide dans le bundle, sans erreur au build.`,
    ]);
  }

  // Sens inverse : déclarée, jamais lue. Sans danger, donc pas un échec —
  // mais c'est de la configuration morte, et personne ne la retrouve seul.
  for (const name of buildArgs) {
    if (build.has(name) || runtime.has(name)) continue;
    notes.push(`${name} passée en build-arg à ${app.dockerfile}, lue nulle part dans ${app.name}`);
  }
}

// 3. AMORÇAGE
for (const name of required) {
  if (!exampleVars.has(name)) {
    problems.push(["amorçage", `${name} — exigée par le compose en \`\${${name}:?}\`, non documentée dans docker/.env.example. L'adoptant ne peut pas deviner ce qu'elle vaut.`]);
  }
  if (vpsVars && !vpsVars.has(name)) {
    problems.push(["amorçage", `${name} — exigée par le compose en \`\${${name}:?}\`, absente du \`.env.vps\` que produit \`pnpm bootstrap\`. Premier \`compose up\` en échec.`]);
  }
}

// ─── Rapport ────────────────────────────────────────────────────────────────

if (problems.length === 0) {
  const counted = APPS.map((a) => {
    const { runtime, build } = readsOf(a);
    return `${a.name} : ${runtime.size} runtime, ${[...build.keys()].filter((n) => /^(PUBLIC_|VITE_)/.test(n)).length} build`;
  });
  process.stdout.write(`${C.grn}✓${C.r} branchement des variables cohérent — ${counted.join(" · ")} · ${required.length} exigées par le compose\n`);
  for (const n of notes) process.stdout.write(`  ${C.dim}note : ${n}${C.r}\n`);
  process.exit(0);
}

process.stderr.write(`\n${C.red}✗${C.r} ${C.b}${problems.length} variable${problems.length > 1 ? "s" : ""} à moitié branchée${problems.length > 1 ? "s" : ""}${C.r}\n\n`);
for (const [kind, msg] of problems) process.stderr.write(`  ${C.red}${kind.padEnd(9)}${C.r} ${msg}\n`);
for (const n of notes) process.stderr.write(`  ${C.dim}note      ${n}${C.r}\n`);
process.stderr.write(`
  Une variable lue par le code et posée nulle part vaut la chaîne vide en
  production. Selon le lecteur, cela donne une fonctionnalité muette ou un
  refus systématique — jamais un message d'erreur. Poser la moitié manquante,
  ou retirer la lecture.
`);
process.exit(1);
