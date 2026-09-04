type PathItem = Record<string, unknown>

export function openapiDocument(serverUrl: string): {
  openapi: string
  info: { title: string; version: string }
  servers: { url: string }[]
  components: { securitySchemes: { bearerAuth: { type: string; scheme: string } } }
  security: { bearerAuth: [] }[]
  paths: Record<string, PathItem>
} {
  const bearer = { security: [{ bearerAuth: [] }] }
  return {
    openapi: "3.0.3",
    info: { title: "AstroTan API", version: "1.0.0" },
    servers: [{ url: serverUrl.replace(/\/+$/, "") }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/v1/posts": {
        get: { ...bearer, summary: "Lister les articles" },
        post: { ...bearer, summary: "Créer un brouillon" },
      },
      "/api/v1/posts/{id}": {
        get: { ...bearer, summary: "Lire un article" },
        patch: { ...bearer, summary: "Modifier un article (published → workingCopy)" },
        delete: { ...bearer, summary: "Supprimer un article" },
      },
      "/api/v1/posts/{id}/publish": {
        post: { ...bearer, summary: "Publier un article" },
      },
      "/api/v1/posts/{id}/unpublish": {
        post: { ...bearer, summary: "Dépublier un article" },
      },
      "/api/v1/leads": {
        get: { ...bearer, summary: "Lister les fiches de contact" },
      },
      "/api/v1/leads/{id}": {
        get: { ...bearer, summary: "Lire une fiche" },
      },
      "/api/v1/pages": {
        get: { ...bearer, summary: "Lister les pages (méta)" },
      },
      "/api/v1/pages/{id}": {
        get: { ...bearer, summary: "Lire les méta d'une page" },
        patch: { ...bearer, summary: "Modifier titre / SEO / GEO" },
      },
      "/api/v1/tags": {
        get: { ...bearer, summary: "Lister les tags" },
        post: { ...bearer, summary: "Créer un tag" },
      },
    },
  }
}
