import type { FontData } from './titleData'

// Port of BitmapFont.drawStringTaggable / stringWidthTaggable, drawing into RGBA pixels.

const TAGS: Record<string, number> = {
  red: 0xff0000, gre: 0xff00, blu: 0xff, yel: 0xffff00, cya: 0xffff, mag: 0xff00ff,
  whi: 0xffffff, bla: 0, lre: 0xff9040, dre: 0x800000, dbl: 0x80, or1: 0xffb000,
  or2: 0xff7000, or3: 0xff3000, gr1: 0xc0ff00, gr2: 0x80ff00, gr3: 0x40ff00,
}

const isTag = (s: string, i: number) => s[i] === '@' && i + 4 < s.length && s[i + 4] === '@'

export function stringWidth(font: FontData, s: string): number {
  let w = 0
  for (let i = 0; i < s.length; i++) {
    if (isTag(s, i)) i += 4
    else w += font.glyphs[s.charCodeAt(i) & 0xff]!.advance
  }
  return w
}

function fillMask(img: ImageData, font: FontData, code: number, x: number, y: number, rgb: number) {
  const g = font.glyphs[code]!
  const { data, width, height } = img
  let m = 0
  for (let gy = 0; gy < g.height; gy++) {
    for (let gx = 0; gx < g.width; gx++, m++) {
      if (!g.bits[m]) continue
      const px = x + g.offsetX + gx
      const py = y + g.offsetY + gy
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const i = (px + py * width) * 4
      data[i] = (rgb >> 16) & 0xff
      data[i + 1] = (rgb >> 8) & 0xff
      data[i + 2] = rgb & 0xff
      data[i + 3] = 255
    }
  }
}

export function drawString(img: ImageData, font: FontData, s: string, x: number, y: number, rgb: number, shadow = true) {
  y -= font.height
  for (let i = 0; i < s.length; i++) {
    if (isTag(s, i)) {
      const color = TAGS[s.substring(i + 1, i + 4)]
      if (color !== undefined) rgb = color
      i += 4
      continue
    }
    const code = s.charCodeAt(i) & 0xff
    if (s[i] !== ' ') {
      if (shadow) fillMask(img, font, code, x + 1, y + 1, 0)
      fillMask(img, font, code, x, y, rgb)
    }
    x += font.glyphs[code]!.advance
  }
}

export function drawStringCenter(img: ImageData, font: FontData, s: string, x: number, y: number, rgb: number, shadow = true) {
  drawString(img, font, s, x - ((stringWidth(font, s) / 2) | 0), y, rgb, shadow)
}
