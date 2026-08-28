// Le barillet des composants d'interface, porté d'`astro-emdash`.
//
// Il existe pour que les imports copiés du template (`import { Button, Card }
// from "../ui/index"`) fonctionnent tels quels. Le template en a sept, un par
// famille ; ici tout tient dans un fichier, parce que le catalogue est celui
// qu'on utilise vraiment et non celui d'une bibliothèque complète.
export { default as Button } from "./form/Button/Button.astro"
export { default as Card } from "./data-display/Card/Card.astro"
export { default as Badge } from "./data-display/Badge/Badge.astro"
export { default as Container } from "./layout/Container/Container.astro"
export { default as Grid } from "./layout/Grid/Grid.astro"
export { default as Section } from "./layout/Section/Section.astro"
export { default as Icon } from "./primitives/Icon/Icon.astro"
