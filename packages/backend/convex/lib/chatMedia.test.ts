import { ConvexError } from "convex/values"
import { expect, test } from "vitest"
import { MAX_CHAT_FILE_BYTES, MAX_FILENAME_LENGTH } from "../content"
import {
  assertChatFileMeta,
  assertChatFilename,
  buildChatUserContent,
  chatPromptFor,
  chatUserSaveArgs,
} from "./chatMedia"

test("500 Mo passe, 500 Mo + 1 octet refuse FILE_TOO_LARGE", () => {
  expect(assertChatFileMeta("image/png", MAX_CHAT_FILE_BYTES)).toEqual({
    mime: "image/png",
    size: MAX_CHAT_FILE_BYTES,
  })
  expect(() => assertChatFileMeta("image/png", MAX_CHAT_FILE_BYTES + 1)).toThrow(ConvexError)
  try {
    assertChatFileMeta("image/png", MAX_CHAT_FILE_BYTES + 1)
  } catch (error) {
    expect(error).toMatchObject({ data: { code: "FILE_TOO_LARGE", max: MAX_CHAT_FILE_BYTES } })
  }
})

test("SVG et type vide refusent UNSUPPORTED_MIME", () => {
  expect(() => assertChatFileMeta("image/svg+xml", 12)).toThrow(ConvexError)
  expect(() => assertChatFileMeta(undefined, 12)).toThrow(ConvexError)
  try {
    assertChatFileMeta("image/svg+xml", 12)
  } catch (error) {
    expect(error).toMatchObject({ data: { code: "UNSUPPORTED_MIME", mime: "image/svg+xml" } })
  }
})

test("filename : bornes et vide", () => {
  expect(assertChatFilename("photo.png")).toBe("photo.png")
  expect(() => assertChatFilename("")).toThrow(ConvexError)
  expect(() => assertChatFilename("x".repeat(MAX_FILENAME_LENGTH + 1))).toThrow(ConvexError)
})

test("un PNG au plafond passe ; un nom .svg ne donne pas un mime autorisé", () => {
  expect(assertChatFileMeta("image/jpeg", 1)).toEqual({ mime: "image/jpeg", size: 1 })
})

test("un fichier sans texte prend le nom comme prompt", () => {
  expect(chatPromptFor("", "photo.png")).toBe("photo.png")
  expect(chatPromptFor("bonjour", "photo.png")).toBe("bonjour")
})

test("sans image, le builder reste un prompt texte — même forme qu'avant", () => {
  expect(buildChatUserContent({ body: "bonjour" })).toBe("bonjour")
  expect(buildChatUserContent({ body: "", filename: "photo.png" })).toBe("photo.png")
  expect(chatUserSaveArgs("bonjour")).toEqual({ prompt: "bonjour" })
})

test("une image jointe devient une part vision OpenRouter (image + texte)", () => {
  const content = buildChatUserContent({
    body: "c'est quoi ?",
    filename: "photo.png",
    imageUrl: "https://example.com/photo.png",
    mime: "image/png",
  })
  expect(content).toEqual([
    { type: "text", text: "c'est quoi ?" },
    { type: "image", image: "https://example.com/photo.png", mediaType: "image/png" },
  ])
  expect(chatUserSaveArgs(content)).toEqual({
    message: { role: "user", content },
  })
})

test("image sans légende : le nom sert de texte, la part image est quand même là", () => {
  expect(
    buildChatUserContent({
      body: "",
      filename: "plan.jpg",
      imageUrl: "https://cdn.example/plan.jpg",
      mime: "image/jpeg",
    }),
  ).toEqual([
    { type: "text", text: "plan.jpg" },
    { type: "image", image: "https://cdn.example/plan.jpg", mediaType: "image/jpeg" },
  ])
})

test("URL vide ou mime hors image : on n'invente pas de part vision", () => {
  expect(
    buildChatUserContent({
      body: "voir",
      imageUrl: "",
      mime: "image/png",
    }),
  ).toBe("voir")
  expect(
    buildChatUserContent({
      body: "voir",
      imageUrl: "https://cdn.example/doc.pdf",
      mime: "application/pdf",
    }),
  ).toBe("voir")
})
