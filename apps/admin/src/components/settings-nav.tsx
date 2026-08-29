import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------
// Le sommaire des réglages — la liste, le menu, et l'enveloppe d'une
// section.
//
// Les trois vivent dans le même fichier parce qu'ils partagent une seule
// source de vérité : `SETTINGS_SECTIONS`. Le menu en tire ses libellés,
// l'enveloppe en tire le titre de la carte et l'`id` de son ancre. Écrire
// le titre à la main dans l'écran et le libellé à la main dans le menu,
// c'est se donner rendez-vous avec le jour où les deux ne disent plus la
// même chose — et où le lien du menu ne mène nulle part parce que l'`id`
// a été renommé d'un seul côté.
// ---------------------------------------------------------------------

export type SettingsSectionId =
  | "site"
  | "seo"
  | "reseaux"
  | "leads"
  | "ia"
  | "emails"
  | "domaine"
  | "mesure"

export interface SettingsSectionDef {
  id: SettingsSectionId
  /** Ce que le menu affiche. Court : la colonne est étroite. */
  label: string
  /** La phrase sous le titre de la carte. */
  description: string
}

/**
 * L'ordre de l'écran, et donc celui du menu.
 *
 * Ce qu'on peut changer vient d'abord — l'identité du site, son
 * référencement, ses liens, ses leads. Ce qui se décrit sans se modifier
 * vient ensuite : ces quatre sections-là racontent l'environnement du
 * déploiement, et un opérateur n'y descend que pour vérifier ou
 * diagnostiquer.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = [
  {
    id: "site",
    label: "Site",
    description:
      "Ce que le visiteur voit en premier : le nom, le logo, l'icône, et la page servie à la racine.",
  },
  {
    id: "seo",
    label: "SEO par défaut",
    description:
      "Ce sur quoi une page retombe quand elle ne définit aucune valeur SEO qui lui soit propre. Une page qui remplit son propre champ l'emporte toujours sur celui-ci.",
  },
  {
    id: "reseaux",
    label: "Réseaux sociaux",
    description: "Les liens repris dans le pied de page du site.",
  },
  {
    id: "leads",
    label: "Leads & webhook",
    description:
      "Chaque message reçu déclenche un appel vers cette adresse — un scénario n8n, Make, ou tout service qui écoute une URL.",
  },
  {
    id: "ia",
    label: "IA",
    description:
      "La clé OpenRouter vit dans l'environnement Convex, jamais en base. Cet écran dit si elle est posée ; il ne peut ni la lire ni l'écrire.",
  },
  {
    id: "emails",
    label: "Emails",
    description:
      "Les invitations et les notifications de leads partent par Resend, avec des identifiants qui vivent sur le déploiement Convex.",
  },
  {
    id: "domaine",
    label: "Domaine",
    description:
      "Les deux origines que le déploiement connaît. Elles se règlent chez le DNS, dans Traefik et dans l'environnement Convex — pas ici.",
  },
  {
    id: "mesure",
    label: "Mesure & pixels",
    description:
      "Umami compte les pages vues ; les pixels Meta et Google attendent le consentement. Les trois sont des variables de build du site public.",
  },
]

// ---------------------------------------------------------------------
// Le menu
// ---------------------------------------------------------------------

/**
 * De vrais `<a href="#…">`, et rien d'autre.
 *
 * Un `<button onClick={scrollTo}>` aurait eu l'air identique et coûté
 * trois choses d'un coup : le lien ne se copie plus, ne s'ouvre plus dans
 * un onglet, et disparaît de la liste des liens qu'un lecteur d'écran
 * énumère. Le navigateur sait déjà déplacer une page vers une ancre, au
 * clavier comme à la souris ; `settings-nav.test.tsx` vérifie qu'on ne
 * s'est pas remis à l'écrire nous-mêmes.
 *
 * Sur mobile ce n'est pas un menu latéral rétréci mais une bande de
 * pastilles qui défile horizontalement, collée en haut : une colonne de
 * huit entrées au-dessus du formulaire repousserait le premier champ hors
 * de l'écran, et une colonne écrasée à côté de lui ne laisserait de place
 * ni à l'une ni à l'autre.
 */
export function SettingsNav({ current }: { current: string }) {
  return (
    <nav
      aria-label="Sections des réglages"
      className="sticky top-0 z-10 -mx-4 border-b bg-background px-4 py-2 lg:top-4 lg:mx-0 lg:w-56 lg:shrink-0 lg:self-start lg:border-b-0 lg:px-0 lg:py-0"
    >
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {SETTINGS_SECTIONS.map((section) => {
          const active = section.id === current
          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <a
                href={`#${section.id}`}
                // `aria-current` seulement quand c'est vrai : `false` est
                // une valeur qu'un lecteur d'écran annonce aussi, et huit
                // « non courant » à la suite sont huit annonces de trop.
                {...(active ? { "aria-current": "true" as const } : {})}
                className={cn(
                  "block rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {section.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// ---------------------------------------------------------------------
// L'enveloppe d'une section
// ---------------------------------------------------------------------

/**
 * Une section : son ancre, son titre, sa description, sa carte.
 *
 * `scroll-mt-20` n'est pas décoratif — sans lui, l'ancre amène le titre
 * exactement sous la bande de menu collée en haut sur mobile, et le
 * visiteur atterrit sur une section dont il ne voit pas le nom.
 */
export function SettingsSection({
  id,
  children,
}: {
  id: SettingsSectionId
  children: ReactNode
}) {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id)
  if (section === undefined) {
    throw new Error(`Section de réglages inconnue : ${id}`)
  }
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="scroll-mt-20">
      <Card>
        <CardHeader>
          <CardTitle id={`${id}-titre`}>{section.label}</CardTitle>
          <CardDescription>{section.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </section>
  )
}

// ---------------------------------------------------------------------
// Quelle section est sous les yeux
// ---------------------------------------------------------------------

/**
 * L'`id` de la section la plus haute actuellement visible.
 *
 * `IntersectionObserver` plutôt qu'un écouteur de `scroll` : le navigateur
 * fait le calcul hors du fil principal et ne nous réveille qu'aux
 * franchissements, là où un `scroll` déclencherait une mesure de position
 * à chaque pixel parcouru.
 *
 * `rootMargin` coupe les 55 % du bas de la fenêtre : sans cela, la
 * dernière section du haut resterait « courante » alors même que celle du
 * dessous occupe déjà tout l'écran. Les 88 px du haut laissent passer la
 * bande de menu collée.
 *
 * Rend toujours une valeur, y compris avant le premier rendu du
 * navigateur : le menu doit désigner quelque chose dès la première
 * peinture, sinon il clignote.
 */
export function useCurrentSection(): string {
  const [current, setCurrent] = useState<string>(SETTINGS_SECTIONS[0]?.id ?? "")

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return

    const elements = SETTINGS_SECTIONS.map((section) =>
      document.getElementById(section.id)
    ).filter((element): element is HTMLElement => element !== null)
    if (elements.length === 0) return

    const visible = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }
        // La première DANS L'ORDRE DU DOCUMENT, pas la plus visible : au
        // milieu d'un défilement, deux sections se partagent l'écran et
        // « la plus grande surface » saute de l'une à l'autre à chaque
        // pixel. Le haut de la fenêtre, lui, ne tremble pas.
        const first = SETTINGS_SECTIONS.find((section) => visible.has(section.id))
        if (first !== undefined) setCurrent(first.id)
      },
      { rootMargin: "-88px 0px -55% 0px", threshold: 0 }
    )
    for (const element of elements) observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return current
}
