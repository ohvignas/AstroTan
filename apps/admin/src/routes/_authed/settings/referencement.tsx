import { createFileRoute, redirect } from "@tanstack/react-router"

// L'écran éditait titre, canonique et noindex site que le site public
// ne lisait pas. Le filet SEO par défaut (description + image) reste
// en base et dans `settings.get` — sans UI, les valeurs déjà saisies tiennent.
//
// La route reste pour ne pas 404 un bookmark : même `beforeLoad` que
// `/settings` → première page du menu.
export const Route = createFileRoute("/_authed/settings/referencement")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/identite" })
  },
})
