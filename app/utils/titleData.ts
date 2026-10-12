import raw from '~/assets/title.json'

// title.json is exported from the original cache with tools/TitleExport.java.
// Masks are packed as one hex nibble per 4 pixels (bit set = pixel drawn).

export interface Mask {
  width: number
  height: number
  bits: Uint8Array
}

export interface Glyph extends Mask {
  offsetX: number
  offsetY: number
  advance: number
}

export interface FontData {
  height: number
  glyphs: Glyph[]
}

export interface RuneData extends Mask {
  cropX: number
  cropY: number
}

function unpack(hex: string, length: number): Uint8Array {
  const bits = new Uint8Array(length)

  for (let i = 0; i < length; i++) {
    const nibble = parseInt(hex[i >> 2]!, 16)
    bits[i] = (nibble >> (3 - (i & 3))) & 1
  }

  return bits
}

function loadFont(name: 'b12_full' | 'p11_full' | 'p12_full'): FontData {
  const font = raw.fonts[name]

  return {
    height: font.height,
    glyphs: font.glyphs.map((g) => {
      const [offsetX, offsetY, width, height, advance, hex] = g as [number, number, number, number, number, string]
      return { offsetX, offsetY, width, height, advance, bits: unpack(hex, width * height) }
    }),
  }
}

export const fontBold12 = loadFont('b12_full')
export const fontPlain11 = loadFont('p11_full')
export const fontPlain12 = loadFont('p12_full')

export const runes: RuneData[] = raw.runes.map(r => ({
  cropX: r.cropX,
  cropY: r.cropY,
  width: r.width,
  height: r.height,
  bits: unpack(r.mask, r.width * r.height),
}))
