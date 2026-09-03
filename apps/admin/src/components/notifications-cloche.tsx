import { useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery } from "convex/react"
import {
  BellIcon,
  EyeIcon,
  MailIcon,
  MessageCircleIcon,
  NewspaperIcon,
  type LucideIcon,
} from "lucide-react"
import { api } from "@astrotan/backend/convex/_generated/api"
import type { Id } from "@astrotan/backend/convex/_generated/dataModel"
import type { CleNotification } from "@astrotan/backend/convex/lib/notifier"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type LigneCloche = {
  _id: string
  cle: CleNotification
  titre: string
  leadId?: string
  postId?: string
  readAt?: number
  _creationTime: number
}

export function hrefDeNotification(ligne: {
  cle: CleNotification
  postId?: string
}): "/leads" | `/posts/${string}` {
  if (ligne.cle === "postPublished" && ligne.postId) return `/posts/${ligne.postId}`
  return "/leads"
}

export function aDesNonLues(nonLues: number): boolean {
  return nonLues > 0
}

export function dateRelativeCourte(ts: number, now = Date.now()): string {
  const delta = Math.max(0, now - ts)
  const min = Math.floor(delta / 60_000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const j = Math.floor(h / 24)
  return `${j} j`
}

export function iconeDeNotification(ligne: {
  cle: CleNotification
  titre: string
}): LucideIcon {
  if (ligne.cle === "postPublished") return NewspaperIcon
  if (ligne.titre.toLowerCase().includes("chat")) return MessageCircleIcon
  return MailIcon
}

function aLire(lignes: readonly LigneCloche[]): LigneCloche[] {
  return lignes.filter((ligne) => ligne.readAt === undefined)
}

export function ClochePanneau({
  lignes,
  onChoisir,
  onRetirer,
  onLireTous,
}: {
  lignes: readonly LigneCloche[]
  onChoisir: (ligne: LigneCloche) => void
  onRetirer: (ligne: LigneCloche) => void
  onLireTous: () => void
}) {
  const visibles = aLire(lignes)
  return (
    <div className="flex flex-col gap-2">
      {visibles.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">Aucune notification</p>
      ) : (
        <>
          {visibles.map((ligne) => {
            const Icone = iconeDeNotification(ligne)
            return (
              <Alert key={ligne._id}>
                <Icone />
                <button
                  type="button"
                  className="col-start-2 w-full text-left"
                  onClick={() => onChoisir(ligne)}
                >
                  <AlertTitle>{ligne.titre}</AlertTitle>
                  <AlertDescription>
                    {dateRelativeCourte(ligne._creationTime)}
                  </AlertDescription>
                </button>
                <AlertAction>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Marquer comme lue"
                    onClick={() => onRetirer(ligne)}
                  >
                    <EyeIcon />
                  </Button>
                </AlertAction>
              </Alert>
            )
          })}
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={onLireTous}>
            Lire tous
          </Button>
        </>
      )}
    </div>
  )
}

export function NotificationsClocheConnectee() {
  const navigate = useNavigate()
  const data = useQuery(api.notifications.liste)
  const marquerLu = useMutation(api.notifications.marquerLu)
  const marquerToutesLues = useMutation(api.notifications.marquerToutesLues)
  const lignes = data?.lignes ?? []
  const nonLues = data?.nonLues ?? 0

  async function choisir(ligne: LigneCloche) {
    await marquerLu({ id: ligne._id as Id<"notifications"> })
    const href = hrefDeNotification(ligne)
    if (href === "/leads") {
      await navigate({ to: "/leads" })
      return
    }
    await navigate({ to: "/posts/$postId", params: { postId: ligne.postId! } })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={aDesNonLues(nonLues) ? "Notifications non lues" : "Notifications"}
            className="relative"
          />
        }
      >
        <BellIcon />
        {aDesNonLues(nonLues) ? (
          <span
            className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive"
            aria-hidden="true"
          />
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-2">
        <ClochePanneau
          lignes={lignes}
          onChoisir={(ligne) => {
            void choisir(ligne)
          }}
          onRetirer={(ligne) => {
            void marquerLu({ id: ligne._id as Id<"notifications"> })
          }}
          onLireTous={() => {
            void marquerToutesLues({})
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
