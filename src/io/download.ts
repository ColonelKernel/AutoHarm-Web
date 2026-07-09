/** Trigger a browser download for a byte payload (used for .mid export). */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
