import { api } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { MUTATION_REGISTRY } from "../_registry"

type StorageCtx = { storage: { store: (b: Blob) => Promise<Id<"_storage">> } }

async function attachFixture(
  t: {
    run: (fn: (ctx: StorageCtx) => Promise<Id<"_storage">>) => Promise<Id<"_storage">>
    mutation: (ref: typeof api.agentKnowledge.attach, args: {
      storageId: Id<"_storage">
      filename: string
      mimeType: string
      size: number
    }) => Promise<Id<"agentKnowledgeFiles">>
  },
  filename: string,
) {
  const storageId = await t.run((ctx: StorageCtx) => ctx.storage.store(new Blob(["# registre"])))
  return t.mutation(api.agentKnowledge.attach, {
    storageId,
    filename,
    mimeType: "text/markdown",
    size: 10,
  })
}

MUTATION_REGISTRY.push(
  {
    name: "agentKnowledge.generateUploadUrl",
    allowedRoles: ["owner", "admin"],
    invoke: (t) => t.mutation(api.agentKnowledge.generateUploadUrl, {}),
  },
  {
    name: "agentKnowledge.attach",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => attachFixture(t, "registre.md"),
  },
  {
    name: "agentKnowledge.remove",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await attachFixture(t, "retire.md")
      return t.mutation(api.agentKnowledge.remove, { id })
    },
  },
  {
    name: "agentKnowledge.retryExtract",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await attachFixture(t, "retry.md")
      return t.mutation(api.agentKnowledge.retryExtract, { id })
    },
  },
  {
    name: "agentKnowledge.reindexFile",
    allowedRoles: ["owner", "admin"],
    invoke: async (t) => {
      const id = await attachFixture(t, "reindex.md")
      return t.mutation(api.agentKnowledge.reindexFile, { id })
    },
  },
)
