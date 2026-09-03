function assemblePdf(objects: string[]): Uint8Array {
  let body = "%PDF-1.4\n"
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(body.length)
    body += obj
  }
  const xrefStart = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  }
  return new TextEncoder().encode(
    `${body}${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  )
}

export function buildHelloPdf(text = "Hello AstroTan"): Uint8Array {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  return assemblePdf([
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ])
}

/** PDF sans calque texte — le cas Canva / scan d'Antoine. `pageCount` pour les lots OCR. */
export function buildEmptyTextPdf(pageCount = 1): Uint8Array {
  const count = Math.max(1, pageCount)
  const pageNums = Array.from({ length: count }, (_, i) => 3 + i)
  const kids = pageNums.map((n) => `${n} 0 R`).join(" ")
  return assemblePdf([
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${count} >>\nendobj\n`,
    ...pageNums.map(
      (n) =>
        `${n} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`,
    ),
  ])
}
