// Destinataire des exemples envoyés sans session (`npx convex run`).
//
// `envoyerExemple` (bouton admin) part vers QUI CLIQUE. Ici, il n'y a
// personne : on prenait le premier owner Better Auth. Sur un déploiement
// amorcé, c'est encore `quelquun@domaine.test` — une boîte que personne
// n'ouvre — alors que le domaine déclaré et un compte staff sont déjà
// sur le vrai domaine. Resend accepte l'envoi ; rien n'arrive.
//
// On ne fabrique aucune adresse. On choisit parmi ce qui existe déjà :
// un compte staff dont l'hôte matche le domaine déclaré, sinon
// l'adresse d'`emailFrom` si ELLE aussi est sur ce domaine, sinon le
// premier staff hors TLD réservé, sinon le premier owner.

const TLD_RESERVES = new Set(["test", "example", "invalid", "localhost"])

export function extraireAdresse(valeur: string): string | null {
  const brut = valeur.trim()
  const adresse = brut.includes("<") ? (brut.split("<")[1]?.split(">")[0] ?? "").trim() : brut
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(adresse) ? adresse : null
}

function domaineDe(email: string): string {
  return (email.split("@")[1] ?? "").trim().toLowerCase().replace(/\.$/, "")
}

function normaliserHoteDeclare(hote: string): string {
  return hote.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "")
}

export function emailSurDomaineDeclare(email: string, declaredDomain: string | null): boolean {
  if (!declaredDomain) return false
  const declare = normaliserHoteDeclare(declaredDomain)
  if (!declare) return false
  const domaine = domaineDe(email)
  return domaine === declare || domaine.endsWith(`.${declare}`)
}

export function estTldReserve(email: string): boolean {
  const tld = domaineDe(email).split(".").pop() ?? ""
  return TLD_RESERVES.has(tld)
}

function uniques(adresses: readonly string[]): string[] {
  const vus = new Set<string>()
  const out: string[] = []
  for (const brut of adresses) {
    const email = extraireAdresse(brut)
    if (!email) continue
    const cle = email.toLowerCase()
    if (vus.has(cle)) continue
    vus.add(cle)
    out.push(email)
  }
  return out
}

export function choisirDestinataireInterne(input: {
  owners: readonly string[]
  staff: readonly string[]
  declaredDomain: string | null
  emailFrom: string | null
}): string | null {
  const staff = uniques(input.staff)
  const owners = uniques(input.owners)

  const surDomaine = staff.find((email) => emailSurDomaineDeclare(email, input.declaredDomain))
  if (surDomaine) return surDomaine

  const from = input.emailFrom ? extraireAdresse(input.emailFrom) : null
  if (from && emailSurDomaineDeclare(from, input.declaredDomain)) return from

  const horsReserve = staff.find((email) => !estTldReserve(email))
  if (horsReserve) return horsReserve

  return owners[0] ?? staff[0] ?? null
}
