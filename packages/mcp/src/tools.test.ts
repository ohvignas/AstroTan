import { expect, test } from "vitest"
import { TOOL_NAMES } from "./tools"

test("les tools couvrent exactement les routes V1", () => {
  expect([...TOOL_NAMES].sort()).toEqual(
    [
      "create_post",
      "create_tag",
      "delete_post",
      "get_lead",
      "get_page",
      "get_post",
      "list_leads",
      "list_pages",
      "list_posts",
      "list_tags",
      "publish_post",
      "unpublish_post",
      "update_page",
      "update_post",
    ].sort(),
  )
})
