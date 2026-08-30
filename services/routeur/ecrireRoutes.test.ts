import { describe, expect, test } from "vitest"
import { composerRoutes } from "./ecrireRoutes"

const HOTES = { web: "exemple.fr", admin: "admin.exemple.fr", umami: null }

describe("chaque hôte devient une route", () => {
  test("chaque hôte produit un routeur, un service et un certificat", () => {
    const yaml = composerRoutes(HOTES, [])
    expect(yaml).toContain("Host(`exemple.fr`)")
    expect(yaml).toContain("Host(`admin.exemple.fr`)")
    // Le brief écrivait `certresolver:`, la casse des labels Docker que ce
    // fichier remplace. Traefik documente `certResolver` pour la
    // configuration dynamique ; son décodeur reconnaît les deux, mais un
    // fichier qui n'a que la forme documentée se relit sans avoir à le
    // savoir. L'assertion insensible à la casse dit l'exigence, celle qui
    // suit fixe l'orthographe.
    expect(yaml.toLowerCase()).toContain("certresolver: letsencrypt")
    expect(yaml).toContain("certResolver: letsencrypt")
    // Le service reste déclaré par les labels Docker — c'est là que vit le
    // port du conteneur. Un routeur du provider FICHIER qui vise un
    // service du provider DOCKER doit le nommer avec son fournisseur,
    // sinon Traefik cherche `web@file`, ne le trouve pas, et la route ne
    // sert rien.
    expect(yaml).toContain("service: web@docker")
    expect(yaml).toContain("service: admin@docker")
  })

  test("sans umami, aucun routeur umami n'est écrit", () => {
    // `umami: null` est ordinaire. Écrire quand même `stats.<domaine>`
    // ferait demander à Traefik un certificat pour un nom sans
    // enregistrement DNS, et chaque échec compte dans le quota
    // hebdomadaire de Let's Encrypt.
    const yaml = composerRoutes(HOTES, [])
    expect(yaml).not.toContain("umami")
  })

  test("avec umami, son routeur est écrit comme les deux autres", () => {
    const yaml = composerRoutes({ ...HOTES, umami: "stats.exemple.fr" }, [])
    expect(yaml).toContain("Host(`stats.exemple.fr`)")
    expect(yaml).toContain("service: umami@docker")
  })

  test("les trois routeurs écoutent l'entrypoint TLS, et lui seul", () => {
    // `web` est l'entrypoint :80, et il ne fait que rediriger vers
    // `websecure` (docker-compose.yml). Un routeur qui l'écouterait
    // servirait le site en clair.
    const yaml = composerRoutes({ ...HOTES, umami: "stats.exemple.fr" }, [])
    expect(yaml.match(/- websecure/g)).toHaveLength(3)
    expect(yaml).not.toContain("- web\n")
  })
})

describe("le changement de domaine ne verrouille personne dehors", () => {
  test("les anciens hôtes RESTENT routés", () => {
    // Le piège numéro un : retirer l'ancien hôte pendant que le certificat
    // du nouveau s'émet rend l'administration injoignable sur les DEUX
    // domaines — et il n'existe alors plus aucun moyen de revenir en
    // arrière sans SSH.
    const yaml = composerRoutes(
      { web: "neuf.fr", admin: "admin.neuf.fr", umami: null },
      ["vieux.fr", "admin.vieux.fr"],
    )
    expect(yaml).toContain("Host(`neuf.fr`)")
    expect(yaml).toContain("Host(`vieux.fr`)")
    expect(yaml).toContain("Host(`admin.neuf.fr`)")
    expect(yaml).toContain("Host(`admin.vieux.fr`)")
  })

  test("un ancien hôte d'administration reste sur l'ADMINISTRATION", () => {
    // Le garder routé ne suffit pas : le garder routé vers le site public
    // laisserait le dashboard injoignable, ce que cette précaution existe
    // précisément pour empêcher.
    const yaml = composerRoutes(
      { web: "neuf.fr", admin: "admin.neuf.fr", umami: "stats.neuf.fr" },
      ["vieux.fr", "admin.vieux.fr", "stats.vieux.fr"],
    )
    const routeurs = Object.fromEntries(
      yaml
        .split(/^    (?=\S)/m)
        .slice(1)
        .map((bloc) => [bloc.slice(0, bloc.indexOf(":")), bloc] as const),
    )
    expect(routeurs.admin).toContain("Host(`admin.vieux.fr`)")
    expect(routeurs.web).not.toContain("admin.vieux.fr")
    expect(routeurs.umami).toContain("Host(`stats.vieux.fr`)")
  })

  test("un ancien hôte au préfixe choisi par l'opérateur suit son service", () => {
    // La convention `admin.<domaine>` est une déduction, pas une loi :
    // `ADMIN_DOMAIN` peut valoir `console.exemple.fr`. Quand seul le
    // domaine de base change, le préfixe courant reconnaît son ancien.
    const yaml = composerRoutes(
      { web: "neuf.fr", admin: "console.neuf.fr", umami: null },
      ["vieux.fr", "console.vieux.fr"],
    )
    const bloc = yaml.slice(yaml.indexOf("    admin:"))
    expect(bloc).toContain("Host(`console.vieux.fr`)")
  })

  test("un ancien hôte déjà courant n'est pas écrit deux fois", () => {
    // Le service relit les anciens hôtes depuis le fichier qu'il a écrit :
    // à la passe qui suit un changement, le nouvel hôte est aussi dans la
    // liste des anciens. Deux `Host()` identiques dans une même règle est
    // du bruit que Traefik accepte, et que personne ne relit.
    const yaml = composerRoutes(HOTES, ["exemple.fr", "admin.exemple.fr"])
    expect(yaml.match(/Host\(`exemple\.fr`\)/g)).toHaveLength(1)
  })
})

describe("rien de douteux n'atteint le YAML", () => {
  test("un hôte qui n'est pas un hôte nu ne sort jamais", () => {
    // Défense en profondeur : la query valide déjà, mais ce YAML est du
    // routage — une seconde barrière à l'endroit où le texte est composé.
    expect(() =>
      composerRoutes({ web: "a`) || Host(`b", admin: "x.fr", umami: null }, []),
    ).toThrow()
  })

  test("chacun des cinq emplacements est gardé, pas seulement le premier", () => {
    // Une barrière posée sur le seul champ auquel on a pensé est une
    // barrière qu'on croit avoir.
    const douteux = "a`) || Host(`pirate.fr"
    expect(() => composerRoutes({ ...HOTES, admin: douteux }, [])).toThrow()
    expect(() => composerRoutes({ ...HOTES, umami: douteux }, [])).toThrow()
    expect(() => composerRoutes(HOTES, [douteux])).toThrow()
    expect(() => composerRoutes(HOTES, ["vieux.fr", douteux])).toThrow()
  })

  test("les formes refusées sont les mêmes que partout ailleurs", () => {
    // Même liste que `apps/web/src/lib/allowedDomains.test.ts` et que
    // `lib/hoteNu.ts` côté backend : une URL, un chemin, un port. La règle
    // est importée, pas recopiée — c'est ce qui garantit que les trois
    // barrières refusent la même chose.
    for (const forme of ["https://exemple.fr", "exemple.fr/blog", "exemple.fr:4321", ""]) {
      expect(() => composerRoutes({ ...HOTES, web: forme }, [])).toThrow()
    }
  })

  test("le message de refus nomme l'hôte, pour qu'on sache lequel", () => {
    // Ce refus n'est pas une réponse à un inconnu : il est lu par
    // l'opérateur dans les journaux du service. Taire la valeur ferait
    // chercher longtemps.
    expect(() => composerRoutes({ ...HOTES, web: "pas un hôte" }, [])).toThrow(/pas un hôte/)
  })
})
