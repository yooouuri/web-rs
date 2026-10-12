import { runes, type RuneData } from './titleData'

// Port of the title screen flames from Game.java (updateFlameBuffer, updateFlames, drawFlames).
// The simulation runs on a 128x256 intensity field; drawFlames() maps that field onto the two
// 128x265 side regions (imageTitle0 at x=0 and imageTitle1 at x=637).

export const FLAME_W = 128
export const FLAME_H = 265

const HEIGHT = 256

function buildGradient(fill: (i: number, band: number) => number): Int32Array {
  const g = new Int32Array(256)
  for (let band = 0; band < 4; band++) {
    for (let i = 0; i < 64; i++) g[band * 64 + i] = fill(i, band)
  }
  return g
}

// orange (default), green and blue palettes
const gradient0 = buildGradient((i, b) => [i * 0x40000, 0xff0000 + 0x400 * i, 0xffff00 + 0x4 * i, 0xffffff][b]!)
const gradient1 = buildGradient((i, b) => [i * 1024, 65280 + 4 * i, 65535 + 0x40000 * i, 0xffffff][b]!)
const gradient2 = buildGradient((i, b) => [i * 4, 255 + 0x40000 * i, 0xff00ff + 1024 * i, 0xffffff][b]!)

function mix(src: number, dst: number, alpha: number): number {
  const invAlpha = 256 - alpha
  const rb = ((src & 0xff00ff) * invAlpha + (dst & 0xff00ff) * alpha) & 0xff00ff00
  const g = ((src & 0xff00) * invAlpha + (dst & 0xff00) * alpha) & 0xff0000
  return (rb + g) >>> 8
}

export class Flames {
  /** RGBA overlays for the left and right regions, rows stored bottom-up for a DataTexture */
  readonly left = new Uint8Array(FLAME_W * FLAME_H * 4)
  readonly right = new Uint8Array(FLAME_W * FLAME_H * 4)

  private buffer0 = new Int32Array(32768)
  private buffer1 = new Int32Array(32768)
  private buffer2 = new Int32Array(32768)
  private buffer3 = new Int32Array(32768)
  private lineOffset = new Int32Array(256)
  private gradient = new Int32Array(256)
  private cycle0 = 0
  private gradientCycle0 = 0
  private gradientCycle1 = 0

  constructor(private readonly runeImages: RuneData[] = runes.slice(0, 12)) {
    this.updateFlameBuffer(null)
  }

  /** Noise used to dilute the fuel, with a rune shape carved out of it */
  private updateFlameBuffer(image: RuneData | null) {
    this.buffer0.fill(0)

    for (let i = 0; i < 5000; i++) {
      this.buffer0[Math.floor(Math.random() * 128 * 256)] = Math.floor(Math.random() * 256)
    }

    for (let i = 0; i < 20; i++) {
      for (let y = 1; y < 255; y++) {
        for (let x = 1; x < 127; x++) {
          const pos = x + (y << 7)
          this.buffer1[pos] = ((this.buffer0[pos - 1]! + this.buffer0[pos + 1]! + this.buffer0[pos - 128]! + this.buffer0[pos + 128]!) / 4) | 0
        }
      }
      const tmp = this.buffer0
      this.buffer0 = this.buffer1
      this.buffer1 = tmp
    }

    if (image) {
      let offset = 0
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (image.bits[offset++]) {
            this.buffer0[(x + 16 + image.cropX) + ((y + 16 + image.cropY) << 7)] = 0
          }
        }
      }
    }
  }

  update(loopCycle: number) {
    const b2 = this.buffer2
    const b3 = this.buffer3

    // add fuel to the bottom
    for (let x = 10; x < 117; x++) {
      if (Math.floor(Math.random() * 100) < 50) b3[x + ((HEIGHT - 2) << 7)] = 255
    }

    // add sparkles of fuel everywhere
    for (let i = 0; i < 100; i++) {
      const x = Math.floor(Math.random() * 124) + 2
      const y = Math.floor(Math.random() * 128) + 128
      b3[x + (y << 7)] = 192
    }

    // blur the fuel
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let x = 1; x < 127; x++) {
        const pos = x + (y << 7)
        b2[pos] = ((b3[pos - 1]! + b3[pos + 1]! + b3[pos - 128]! + b3[pos + 128]!) / 4) | 0
      }
    }

    this.cycle0 += 128
    if (this.cycle0 > this.buffer0.length) {
      this.cycle0 -= this.buffer0.length
      this.updateFlameBuffer(this.runeImages[Math.floor(Math.random() * this.runeImages.length)]!)
    }

    // move the fuel up a row while diluting it with the scrolling noise
    const b0 = this.buffer0
    const mask = b0.length - 1
    for (let y = 1; y < HEIGHT - 1; y++) {
      for (let x = 1; x < 127; x++) {
        const pos = x + (y << 7)
        const intensity = b2[pos + 128]! - ((b0[(pos + this.cycle0) & mask]! / 5) | 0)
        b3[pos] = intensity < 0 ? 0 : intensity
      }
    }

    this.lineOffset.copyWithin(0, 1)
    this.lineOffset[HEIGHT - 1] = Math.trunc(
      Math.sin(loopCycle / 14) * 16 + Math.sin(loopCycle / 15) * 14 + Math.sin(loopCycle / 16) * 12,
    )

    if (this.gradientCycle0 > 0) this.gradientCycle0 -= 4
    if (this.gradientCycle1 > 0) this.gradientCycle1 -= 4

    // occasionally fade to the green or blue palette
    if (this.gradientCycle0 === 0 && this.gradientCycle1 === 0) {
      const rng = Math.floor(Math.random() * 2000)
      if (rng === 0) this.gradientCycle0 = 1024
      else if (rng === 1) this.gradientCycle1 = 1024
    }
  }

  private updateGradient() {
    const cycle = this.gradientCycle0 > 0 ? this.gradientCycle0 : this.gradientCycle1
    const target = this.gradientCycle0 > 0 ? gradient1 : gradient2

    for (let i = 0; i < 256; i++) {
      if (cycle <= 0) this.gradient[i] = gradient0[i]!
      else if (cycle > 768) this.gradient[i] = mix(gradient0[i]!, target[i]!, 1024 - cycle)
      else if (cycle > 256) this.gradient[i] = target[i]!
      else this.gradient[i] = mix(target[i]!, gradient0[i]!, 256 - cycle)
    }
  }

  private plot(out: Uint8Array, dst: number, value: number) {
    if (dst < 0 || dst >= FLAME_W * FLAME_H) return
    const x = dst % FLAME_W
    const y = (dst / FLAME_W) | 0
    const i = (x + (FLAME_H - 1 - y) * FLAME_W) * 4
    const rgb = this.gradient[value]!
    out[i] = (rgb >> 16) & 0xff
    out[i + 1] = (rgb >> 8) & 0xff
    out[i + 2] = rgb & 0xff
    out[i + 3] = value
  }

  draw() {
    this.updateGradient()
    this.left.fill(0)
    this.right.fill(0)

    const b3 = this.buffer3

    // left side
    let src = 0
    let dst = 1152
    for (let y = 1; y < HEIGHT - 1; y++) {
      const offset = Math.trunc((this.lineOffset[y]! * (HEIGHT - y)) / HEIGHT)
      const step = Math.max(0, 22 + offset)
      src += step
      for (let x = step; x < 128; x++) {
        const value = b3[src++]!
        if (value !== 0) this.plot(this.left, dst, value)
        dst++
      }
      dst += step
    }

    // right side
    src = 0
    dst = 1176
    for (let y = 1; y < HEIGHT - 1; y++) {
      const offset = Math.trunc((this.lineOffset[y]! * (HEIGHT - y)) / HEIGHT)
      const step = 103 - offset
      dst += offset
      for (let i = 0; i < step; i++) {
        const value = b3[src++]!
        if (value !== 0) this.plot(this.right, dst, value)
        dst++
      }
      src += 128 - step
      dst += 128 - step - offset
    }
  }
}
