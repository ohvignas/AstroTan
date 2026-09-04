import type { QueryCtx } from "../_generated/server"
import { ANON_LEAD_NAME } from "./chatLead"

export const DEFAULT_VISITOR_TIMEZONE = "Europe/Paris"
export const DEFAULT_SITE_LANGUAGE = "fr"

export type VisitorStreamFacts = {
  siteName: string | null
  language: string
  pageUrl: string | null
  country: string | null
  city: string | null
  ip: string | null
  latitude: number | null
  longitude: number | null
  timeZone: string | null
  leadEmail: string | null
  leadName: string | null
}

export type VisitorContextInput = VisitorStreamFacts & {
  nowMs: number
  calendarConnected: boolean
}

const emptyFacts: VisitorStreamFacts = {
  siteName: null,
  language: DEFAULT_SITE_LANGUAGE,
  pageUrl: null,
  country: null,
  city: null,
  ip: null,
  latitude: null,
  longitude: null,
  timeZone: null,
  leadEmail: null,
  leadName: null,
}

export function resolveVisitorTimeZone(raw: string | null | undefined): string {
  const candidate = raw?.trim() ?? ""
  if (candidate.length === 0) return DEFAULT_VISITOR_TIMEZONE
  try {
    Intl.DateTimeFormat("fr-FR", { timeZone: candidate }).format(new Date())
    return candidate
  } catch {
    return DEFAULT_VISITOR_TIMEZONE
  }
}

function isLoopbackIp(ip: string | null): boolean {
  if (!ip) return false
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost"
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function ymdInZone(ms: number, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms))
  const num = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { y: num("year"), m: num("month"), d: num("day") }
}

function addCalendarDays(ymd: { y: number; m: number; d: number }, days: number) {
  const date = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days))
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }
}

function isoDate(ymd: { y: number; m: number; d: number }): string {
  return `${ymd.y}-${pad2(ymd.m)}-${pad2(ymd.d)}`
}

function readableFrDate(ymd: { y: number; m: number; d: number }): string {
  const noon = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0)
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(noon))
}

function clockInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms))
}

function locationLine(input: VisitorContextInput): string {
  const city = input.city?.trim() ?? ""
  const country = input.country?.trim() ?? ""
  if (city.length > 0 && country.length > 0) return `${city}, ${country}`
  if (city.length > 0) return city
  if (country.length > 0) return country
  if (isLoopbackIp(input.ip) || !input.ip) return "local / inconnue"
  return "inconnue"
}

function visitorLine(input: VisitorContextInput): string | null {
  const email = input.leadEmail?.trim() ?? ""
  const name = input.leadName?.trim() ?? ""
  const named = name.length > 0 && name !== ANON_LEAD_NAME
  if (email.length > 0 && named) return `${name} (${email})`
  if (email.length > 0) return email
  if (named) return name
  return null
}

export function formatVisitorContextBlock(input: VisitorContextInput): string {
  const timeZone = resolveVisitorTimeZone(input.timeZone)
  const today = ymdInZone(input.nowMs, timeZone)
  const tomorrow = addCalendarDays(today, 1)
  const visitor = visitorLine(input)
  const lines = [
    "## Contexte système (faits déjà connus — ne pas les redemander)",
    `Date du jour : ${readableFrDate(today)} (${isoDate(today)})`,
    `Demain : ${readableFrDate(tomorrow)} (${isoDate(tomorrow)})`,
    `Heure actuelle : ${clockInZone(input.nowMs, timeZone)} (fuseau ${timeZone})`,
    `Localisation visiteur : ${locationLine(input)}`,
  ]
  if (input.ip && !isLoopbackIp(input.ip)) lines.push(`IP : ${input.ip}`)
  if (input.latitude != null && input.longitude != null) {
    lines.push(`Coordonnées : ${input.latitude}, ${input.longitude}`)
  }
  if (input.pageUrl) lines.push(`Page : ${input.pageUrl}`)
  if (input.siteName?.trim()) lines.push(`Site : ${input.siteName.trim()}`)
  lines.push(`Langue : ${input.language.trim() || DEFAULT_SITE_LANGUAGE}`)
  if (visitor) lines.push(`Visiteur : ${visitor}`)
  lines.push(`Agenda principal lié : ${input.calendarConnected ? "oui" : "non"}`)
  lines.push(
    "Pour « aujourd'hui », « demain » ou un moment de la journée, calcule toi-même les instants ISO dans ce fuseau avant d'appeler l'outil agenda. Ne demande pas la date au visiteur.",
  )
  return lines.join("\n")
}

export async function loadVisitorStreamFacts(
  ctx: QueryCtx,
  threadId: string,
): Promise<VisitorStreamFacts> {
  const settings = await ctx.db.query("settings").first()
  const lead = await ctx.db
    .query("leads")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .unique()
  return {
    siteName: settings?.siteName ?? null,
    language: DEFAULT_SITE_LANGUAGE,
    pageUrl: lead?.pageUrl ?? null,
    country: lead?.country ?? null,
    city: lead?.city ?? null,
    ip: lead?.ip ?? null,
    latitude: lead?.latitude ?? null,
    longitude: lead?.longitude ?? null,
    timeZone: lead?.timezone ?? null,
    leadEmail: lead?.email ?? null,
    leadName: lead?.name ?? null,
  }
}

export function emptyVisitorFacts(): VisitorStreamFacts {
  return { ...emptyFacts }
}
