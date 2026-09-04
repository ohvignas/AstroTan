import { readFile, stat } from "node:fs/promises"
import path from "node:path"

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

/** Refuse path traversal; `root` must already be absolute and trailing-slashed. */
export function resolveClientPath(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes("\0")) return null
  const relative = decoded.replace(/^\/+/, "")
  if (relative.length === 0) return null
  const full = path.normalize(path.join(root, relative))
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (full !== root && !full.startsWith(prefix)) return null
  return full
}

export async function responseFromClientFile(root, pathname) {
  const full = resolveClientPath(root, pathname)
  if (full === null) return null
  try {
    const info = await stat(full)
    if (!info.isFile()) return null
    const body = await readFile(full)
    const ext = path.extname(full)
    return new Response(body, {
      headers: {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    })
  } catch {
    return null
  }
}
