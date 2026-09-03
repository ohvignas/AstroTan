export function mcpSnippet(apiUrl: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        astrotan: {
          command: "pnpm",
          args: ["--filter", "@astrotan/mcp", "start"],
          env: {
            ASTROTAN_API_URL: apiUrl.replace(/\/+$/, ""),
            ASTROTAN_API_TOKEN: "<coller le jeton montré une fois>",
          },
        },
      },
    },
    null,
    2,
  )
}
