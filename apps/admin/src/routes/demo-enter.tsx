import { createFileRoute } from "@tanstack/react-router"
import { ConvexHttpClient } from "convex/browser"
import { anyApi } from "convex/server"
import { entrerDemo, secretPresent, type Ouvert } from "@/lib/demoEnter"

function notFound(): Response {
  return new Response("Not Found", { status: 404 })
}

function tropDeTentatives(): Response {
  return new Response("Trop de tentatives. Réessayez plus tard.", {
    status: 429,
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}

function firstForwardedHop(header: string | null): string | undefined {
  if (!header) return undefined
  const hop = header.split(",")[0]?.trim()
  return hop.length > 0 ? hop : undefined
}

function convexErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("data" in error)) {
    return undefined
  }
  const data = (error as { data?: unknown }).data
  if (typeof data !== "object" || data === null || !("code" in data)) {
    return undefined
  }
  const code = (data as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

async function handleGet(request: Request): Promise<Response> {
  const env = process.env
  if (!secretPresent(env)) return notFound()

  const convexUrl = process.env.VITE_CONVEX_URL
  if (!convexUrl) return notFound()

  const client = new ConvexHttpClient(convexUrl)
  const ouvert = (await client.query(anyApi.demo.ouvert, {})) as Ouvert
  if (entrerDemo({ ouvert, secretEnv: true }) === "404") return notFound()

  let credentials: { email: string; password: string }
  try {
    credentials = (await client.action(anyApi.demo.credentials, {
      secret: process.env.DEMO_ENTER_SECRET!,
      ip: firstForwardedHop(request.headers.get("x-forwarded-for")),
    })) as { email: string; password: string }
  } catch (error) {
    if (convexErrorCode(error) === "DEMO_RATE_LIMITED") {
      return tropDeTentatives()
    }
    return notFound()
  }

  const origin = new URL(request.url).origin
  const signIn = await fetch(new URL("/api/auth/sign-in/email", origin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    }),
  })
  if (!signIn.ok) return notFound()

  const headers = new Headers({ Location: "/" })
  for (const cookie of signIn.headers.getSetCookie()) {
    headers.append("Set-Cookie", cookie)
  }
  return new Response(null, { status: 302, headers })
}

export const Route = createFileRoute("/demo-enter")({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
    },
  },
})
