import { describe, expect, test } from "vitest"
import { staffChatBubbles } from "./staffChatBubbles"

describe("staffChatBubbles", () => {
  test("deux parts texte assistant deviennent deux bulles", () => {
    const bubbles = staffChatBubbles([
      {
        key: "t-1-0",
        order: 1,
        stepOrder: 0,
        role: "assistant",
        parts: [
          { type: "text", text: "Que souhaitez-vous savoir ?" },
          { type: "text", text: "Vous avez besoins d'aide ?" },
        ],
      },
    ])
    expect(bubbles.map((bubble) => bubble.text)).toEqual([
      "Que souhaitez-vous savoir ?",
      "Vous avez besoins d'aide ?",
    ])
    expect(bubbles).toHaveLength(2)
    expect(bubbles[0]!.key).not.toBe(bubbles[1]!.key)
  })

  test("un fichier image voyage avec la bulle", () => {
    expect(
      staffChatBubbles([
        {
          key: "t-2-0",
          order: 2,
          stepOrder: 0,
          role: "user",
          parts: [{ type: "text", text: "photo.png" }],
          chatFile: { url: "https://cdn.example/p.png", filename: "photo.png", mime: "image/png" },
        },
      ]),
    ).toEqual([
      {
        key: "t-2-0",
        role: "user",
        text: "photo.png",
        streaming: false,
        file: { url: "https://cdn.example/p.png", filename: "photo.png", mime: "image/png" },
      },
    ])
  })

  test("une part fichier survit à la fusion assistant sans chatFile", () => {
    const file = { url: "https://cdn.example/plan.jpg", filename: "plan.jpg", mime: "image/jpeg" }
    expect(
      staffChatBubbles([
        {
          key: "t-3-0",
          order: 3,
          stepOrder: 0,
          role: "assistant",
          parts: [
            { type: "text", text: "Le bootcamp dure 8 semaines." },
            { type: "text", text: "voici le programme" },
            {
              type: "file",
              url: file.url,
              filename: file.filename,
              mediaType: file.mime,
            },
          ],
        },
      ]),
    ).toEqual([
      {
        key: "t-3-0",
        role: "assistant",
        text: "Le bootcamp dure 8 semaines.",
        streaming: false,
      },
      {
        key: "t-3-0-1",
        role: "assistant",
        text: "voici le programme",
        streaming: false,
        file,
      },
    ])
  })

  test("texte et image staff sur la même bulle, pas l'un ou l'autre", () => {
    expect(
      staffChatBubbles([
        {
          key: "t-4-0",
          order: 4,
          stepOrder: 0,
          role: "assistant",
          parts: [
            { type: "text", text: "voici le programme" },
            {
              type: "file",
              url: "https://cdn.example/plan.jpg",
              filename: "plan.jpg",
              mediaType: "image/jpeg",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        key: "t-4-0",
        role: "assistant",
        text: "voici le programme",
        streaming: false,
        file: { url: "https://cdn.example/plan.jpg", filename: "plan.jpg", mime: "image/jpeg" },
      },
    ])
  })

  test("une image visiteur sans chatFile vient de la part fichier", () => {
    expect(
      staffChatBubbles([
        {
          key: "t-5-0",
          order: 5,
          stepOrder: 0,
          role: "user",
          parts: [
            { type: "text", text: "regarde" },
            {
              type: "file",
              url: "https://cdn.example/photo.png",
              filename: "photo.png",
              mediaType: "image/png",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        key: "t-5-0",
        role: "user",
        text: "regarde",
        streaming: false,
        file: { url: "https://cdn.example/photo.png", filename: "photo.png", mime: "image/png" },
      },
    ])
  })

  test("un message visiteur reste une seule bulle", () => {
    expect(
      staffChatBubbles([
        {
          key: "t-0-0",
          order: 0,
          stepOrder: 0,
          role: "user",
          parts: [{ type: "text", text: "Bonjour" }],
        },
      ]),
    ).toEqual([
      { key: "t-0-0", role: "user", text: "Bonjour", streaming: false },
    ])
  })
})
