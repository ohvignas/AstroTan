import { Link } from "@tanstack/react-router"
import {
  FileTextIcon,
  ImageIcon,
  InboxIcon,
  NewspaperIcon
  
} from "lucide-react"
import type {LucideIcon} from "lucide-react";
import type { DashboardOverview } from "@astrotan/backend/convex/dashboard"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { compte, nombre, pluriel, poids } from "@/lib/dashboardFormat"
import { alerteLeadsNouveaux } from "@/lib/leadVu"

// Ce que contient le site, en quatre tuiles.
//
// Chacune répond à une question qu'on se pose vraiment devant cet écran, et
// mène à l'endroit où l'on agit. Une tuile qui affiche un nombre sans
// mener nulle part oblige à retrouver l'écran correspondant dans le menu —
// et le nombre n'aura servi qu'à faire joli.
//
// Le second niveau de chaque tuile n'est pas une répétition du premier : il
// porte ce qui appelle une action. « 7 pages » puis « 2 brouillons » se lit
// en une fois ; « 7 pages » puis « 5 publiées » demande une soustraction.

function Tuile({
  titre,
  valeur,
  detail,
  alerte,
  icone: Icone,
  vers,
}: {
  titre: string
  valeur: string
  detail: string
  /** Ce qui demande une attention. Absent quand il n'y a rien à faire. */
  alerte?: string
  icone: LucideIcon
  vers: string
}) {
  return (
    <Card className="transition-colors hover:border-foreground/20">
      <CardContent className="flex flex-col gap-1 p-4">
        <Link to={vers} className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {titre}
          </span>
          <Icone aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </Link>
        {/* `tabular-nums` : quatre tuiles côte à côte, les chiffres doivent
            s'aligner d'une carte à l'autre au lieu de danser. */}
        <span className="text-2xl font-semibold tabular-nums">{valeur}</span>
        <span className="text-xs text-muted-foreground">{detail}</span>
        {alerte && (
          <Badge variant="secondary" className="mt-1 w-fit">
            {alerte}
          </Badge>
        )}
      </CardContent>
    </Card>
  )
}

export function TuilesContenu({ overview }: { overview: DashboardOverview | undefined }) {
  if (overview === undefined) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[132px] rounded-xl" />
        ))}
      </div>
    )
  }

  const { pages, posts, leads, media } = overview
  const brouillonsPages = pages.draft.count
  const brouillonsPosts = posts.draft.count

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tuile
        titre="Pages"
        valeur={compte(pages.published)}
        detail={`${pluriel(pages.published.count, "publiée", "publiées")} sur le site`}
        alerte={
          brouillonsPages > 0
            ? `${nombre(brouillonsPages)} ${pluriel(brouillonsPages, "brouillon", "brouillons")}`
            : undefined
        }
        icone={FileTextIcon}
        vers="/pages"
      />
      <Tuile
        titre="Articles"
        valeur={compte(posts.published)}
        detail={`${pluriel(posts.published.count, "publié", "publiés")} au blog`}
        alerte={
          brouillonsPosts > 0
            ? `${nombre(brouillonsPosts)} ${pluriel(brouillonsPosts, "brouillon", "brouillons")}`
            : undefined
        }
        icone={NewspaperIcon}
        vers="/posts"
      />
      <Tuile
        titre="Leads"
        valeur={compte(leads.total)}
        detail={`${pluriel(leads.total.count, "personne a écrit", "personnes ont écrit")}`}
        alerte={alerteLeadsNouveaux(leads.unseen?.count ?? 0)}
        icone={InboxIcon}
        vers="/leads"
      />
      <Tuile
        titre="Médiathèque"
        valeur={compte(media.files)}
        detail={`${pluriel(media.files.count, "fichier", "fichiers")} · ${poids(media.bytes)}${
          // Le poids devient un minimum dès que le compte est plafonné : la
          // somme s'arrête aux mêmes lignes que le compte.
          media.files.capped ? " au moins" : ""
        }`}
        icone={ImageIcon}
        vers="/media"
      />
    </div>
  )
}
