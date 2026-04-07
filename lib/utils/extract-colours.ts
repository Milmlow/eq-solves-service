/**
 * Extracts dominant colours from an image using canvas pixel sampling.
 * Returns 4 colours: primary, deep (darker), ice (lighter), ink (darkest).
 * Works client-side only.
 */
export async function extractColoursFromImage(imageUrl: string): Promise<{
  primary: string
  deep: string
  ice: string
  ink: string
} | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const size = 100 // sample at small size for speed
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }

        ctx.drawImage(img, 0, 0, size, size)
        const imageData = ctx.getImageData(0, 0, size, size)
        const pixels = imageData.data

        // Collect non-white, non-transparent pixels
        const colourCounts: Record<string, { r: number; g: number; b: number; count: number }> = {}

        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i]
          const g = pixels[i + 1]
          const b = pixels[i + 2]
          const a = pixels[i + 3]

          // Skip transparent or near-white/near-black background pixels
          if (a < 128) continue
          if (r > 240 && g > 240 && b > 240) continue // white bg

          // Quantise to reduce noise (bucket by 16)
          const qr = Math.round(r / 16) * 16
          const qg = Math.round(g / 16) * 16
          const qb = Math.round(b / 16) * 16
          const key = `${qr},${qg},${qb}`

          if (!colourCounts[key]) {
            colourCounts[key] = { r: qr, g: qg, b: qb, count: 0 }
          }
          colourCounts[key].count++
        }

        // Sort by frequency
        const sorted = Object.values(colourCounts).sort((a, b) => b.count - a.count)

        if (sorted.length === 0) { resolve(null); return }

        const primary = sorted[0]
        const toHex = (c: { r: number; g: number; b: number }) =>
          '#' + [c.r, c.g, c.b].map((v) => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('')

        // Generate palette from primary
        const darken = (c: { r: number; g: number; b: number }, factor: number) => ({
          r: Math.round(c.r * factor),
          g: Math.round(c.g * factor),
          b: Math.round(c.b * factor),
        })
        const lighten = (c: { r: number; g: number; b: number }, factor: number) => ({
          r: Math.round(c.r + (255 - c.r) * factor),
          g: Math.round(c.g + (255 - c.g) * factor),
          b: Math.round(c.b + (255 - c.b) * factor),
        })

        // Find a secondary distinct colour if available
        const deep = sorted.length > 1
          ? darken(sorted.find((s) => {
              // Find a colour that's reasonably different from primary
              const diff = Math.abs(s.r - primary.r) + Math.abs(s.g - primary.g) + Math.abs(s.b - primary.b)
              return diff > 48
            }) ?? primary, 0.75)
          : darken(primary, 0.75)

        resolve({
          primary: toHex(primary),
          deep: toHex(deep),
          ice: toHex(lighten(primary, 0.75)),
          ink: toHex(darken(primary, 0.3)),
        })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = imageUrl
  })
}
