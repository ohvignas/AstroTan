export function urlTester(ouvert: boolean, adminUrl: string | null): string | null {
  if (!ouvert || !adminUrl) return null
  return `${adminUrl.replace(/\/+$/, "")}/demo-enter`
}
