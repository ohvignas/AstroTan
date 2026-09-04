#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = new Set();
let stopping = false;

function start(filter) {
  if (stopping) return;
  const child = spawn("pnpm", ["--filter", filter, "dev"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    console.log(`[${filter}] exit ${signal ?? code} — relance dans 2s`);
    setTimeout(() => start(filter), 2000);
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

start("@astrotan/web");
start("@astrotan/admin");
