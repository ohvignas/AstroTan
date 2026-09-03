import type { StaffChatFile } from "@/lib/staffChatBubbles"

export function LeadChatMedia({ file }: { file: StaffChatFile }) {
  if (file.mime.startsWith("image/")) {
    return (
      <img
        src={file.url}
        alt={file.filename}
        className="mb-2 max-h-48 max-w-full rounded-md"
      />
    )
  }
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-2 block underline underline-offset-2"
    >
      {file.filename}
    </a>
  )
}
