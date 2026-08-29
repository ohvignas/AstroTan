import { createFileRoute, redirect } from "@tanstack/react-router"

// `/settings` n'affiche rien : il n'y a rien à y montrer que le menu ne
// dise déjà, et une page d'accueil de réglages qui se contenterait de
// répéter les sept entrées serait un clic de plus pour tout le monde.
//
// `beforeLoad` et non un composant qui redirige au montage : la
// redirection se décide avant le rendu, donc sans écran intermédiaire
// vide, et l'entrée `/settings` de la barre latérale mène directement à la
// première page.
export const Route = createFileRoute("/_authed/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/identite" })
  },
})
