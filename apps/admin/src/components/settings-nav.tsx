import type { ReactNode } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------
// Le sommaire des réglages : la liste des pages, le menu, l'en-tête d'une
// page.
//
// Une PAGE par entrée, et non une ancre dans un long défilement. Le
// premier essai empilait les huit sections sur un seul écran avec un
// sommaire à ancres, ce qui était illisible ; une route par page fait
// qu'on ne tombe jamais dans une section par accident en faisant défiler.
//
// UNE SEULE LISTE, à plat. Le deuxième essai rangeait ces pages en deux
// groupes nommés — « Le site » et « Le déploiement » — parce que trois
// d'entre elles ne faisaient que rendre compte de l'environnement sans
// rien pouvoir enregistrer. Ce n'est plus vrai : Domaine, Mesure et IA
// portent maintenant les champs de saisie des jetons (`settings-secrets`).
// Le critère qui justifiait la séparation ayant disparu, les intitulés de
// groupe ne classaient plus rien — ils ajoutaient deux lignes à lire pour
// une distinction qui n'existe plus.
//
// `SETTINGS_PAGES` est la source de vérité unique : le menu en tire ses
// libellés, l'en-tête de page son `h1` et sa phrase, et
// `settings-nav.test.tsx` vérifie qu'il existe bien un fichier de route
// pour chaque chemin déclaré ici.
// ---------------------------------------------------------------------

export type SettingsPath =
  | "/settings/identite"
  | "/settings/referencement"
  | "/settings/reseaux"
  | "/settings/webhook"
  | "/settings/domaine"
  | "/settings/mesure"
  | "/settings/ia"

export interface SettingsPageDef {
  to: SettingsPath
  /** Ce que le menu affiche. Court : la colonne est étroite. */
  label: string
  /**
   * Le `h1` de la page. Il commence toujours par le libellé du menu — on
   * doit pouvoir relier d'un coup d'œil l'entrée cliquée et la page
   * ouverte, sinon le menu ment sur l'endroit où l'on est.
   */
  title: string
  /** La phrase sous le `h1` : ce qu'on fait ici, pas ce que c'est. */
  description: string
}

export const SETTINGS_PAGES: readonly SettingsPageDef[] = [
  {
    to: "/settings/identite",
    label: "Identité",
    title: "Identité du site",
    description:
      "Le nom, le logo et l'icône repris sur chaque page du site public, et la page qu'il sert à la racine.",
  },
  {
    to: "/settings/referencement",
    label: "Référencement",
    title: "Référencement par défaut",
    description:
      "Ce sur quoi une page retombe quand elle ne définit aucune valeur qui lui soit propre. Une page qui remplit son propre champ l'emporte toujours sur celle-ci.",
  },
  {
    to: "/settings/reseaux",
    label: "Réseaux sociaux",
    title: "Réseaux sociaux",
    description: "Les liens repris dans le pied de page du site public.",
  },
  {
    to: "/settings/webhook",
    label: "Webhook",
    title: "Webhook des leads",
    description:
      "Chaque message reçu par le formulaire de contact déclenche un appel vers cette adresse — un scénario n8n, Make, ou tout service qui écoute une URL.",
  },
  {
    to: "/settings/domaine",
    label: "Domaine & emails",
    title: "Domaine et emails",
    description:
      "Le nom de domaine sur lequel ce déploiement doit répondre, et les enregistrements DNS que votre hébergeur attend — pour le site comme pour les emails.",
  },
  {
    to: "/settings/mesure",
    label: "Mesure & pixels",
    title: "Mesure et pixels",
    description:
      "Ce que le site compte sans rien demander, ce qui attend l'accord du visiteur, et les identifiants avec lesquels le dashboard lit les chiffres.",
  },
  {
    to: "/settings/ia",
    label: "IA",
    title: "IA : la clé OpenRouter",
    description:
      "La clé d'un fournisseur de modèles. Posée ici, elle est chiffrée avant d'entrer en base ; posée dans l'environnement Convex, elle n'y entre pas du tout — et c'est celle-là qui gagne.",
  },
]

/**
 * Correspondance EXACTE, pas un préfixe.
 *
 * `startsWith` aurait marché aujourd'hui et cassé au premier chemin
 * imbriqué : `/settings/reseaux` est un préfixe de `/settings/reseaux-x`,
 * et deux entrées se seraient allumées ensemble. La barre finale est
 * tolérée parce que le navigateur peut l'ajouter.
 */
export function isSettingsPathActive(pathname: string, to: string): boolean {
  return pathname === to || pathname === `${to}/`
}

export function findSettingsPage(pathname: string): SettingsPageDef | undefined {
  return SETTINGS_PAGES.find((page) => isSettingsPathActive(pathname, page.to))
}

// ---------------------------------------------------------------------
// Le menu
// ---------------------------------------------------------------------

/**
 * `<Link>` de TanStack Router, et non un `<a href>` : ce sont de vraies
 * navigations, et le routeur doit les voir — c'est lui qui les bloque
 * quand la page quittée a des modifications non enregistrées
 * (`useUnsavedChangesGuard`). Une ancre native passerait à travers ce
 * garde-fou sans rien signaler.
 *
 * Sur mobile, ce n'est pas un menu latéral rétréci mais une bande de
 * pastilles qui défile horizontalement. Pas de `sticky` en dessous de
 * `lg` : chaque page est courte, et une bande collée y mangerait de la
 * hauteur sans jamais servir.
 */
export function SettingsNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  return (
    <nav
      aria-label="Sections des réglages"
      className="lg:sticky lg:top-4 lg:w-56 lg:shrink-0 lg:self-start"
    >
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {SETTINGS_PAGES.map((page) => {
          const active = isSettingsPathActive(pathname, page.to)
          return (
            <li key={page.to} className="shrink-0 lg:shrink">
              <Link
                to={page.to}
                // `aria-current` seulement quand c'est vrai :
                // `false` s'annonce aussi, et six « non courant »
                // à la suite sont six annonces de trop.
                {...(active ? { "aria-current": "page" as const } : {})}
                className={cn(
                  "block cursor-pointer rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-150",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {page.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// ---------------------------------------------------------------------
// L'en-tête d'une page de réglages
// ---------------------------------------------------------------------

/**
 * Un `h1` par page, et un seul.
 *
 * L'écran d'avant écrivait « Réglages » en `h1` puis répétait le nom de
 * chaque section en titre de carte juste en dessous de son entrée de
 * menu : le même mot trois fois, et aucun des trois ne disait où l'on
 * était. Ici le `h1` porte le nom de la page, la phrase dit ce qu'on y
 * fait, et les cartes en dessous n'ont plus de titre du tout — sauf
 * quand une page a réellement plusieurs groupes de champs, auquel cas ce
 * sont des `h2` (`SettingsGroup`).
 *
 * Pas de fil d'Ariane : deux niveaux ne le justifient pas, la barre
 * latérale de l'application marque déjà « Réglages », et un troisième
 * repère au-dessus du titre serait un repère de plus à lire pour la même
 * information.
 */
export function SettingsPageHeader({
  page,
  canWrite,
}: {
  page: SettingsPageDef
  canWrite: boolean
}) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-xl font-medium">{page.title}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        {page.description}
      </p>
      {canWrite ? null : (
        <p className="max-w-prose rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Ces réglages s'appliquent à toutes les pages à la fois : seuls le
          propriétaire et les administrateurs peuvent les modifier. Vous
          pouvez les consulter.
        </p>
      )}
    </header>
  )
}

/**
 * Un groupe de champs à l'intérieur d'une page — son `h2` et son cadre.
 *
 * N'est utilisé que par les pages qui ont réellement PLUSIEURS groupes.
 * Une page à un seul groupe n'a pas de `h2` : il répéterait son `h1`, et
 * c'est exactement le doublon qu'on vient d'enlever.
 */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title?: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
      {title ? (
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base leading-snug font-medium">
            {title}
          </h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
