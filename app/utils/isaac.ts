// ISAAC as used for packet opcodes. The client uses Apache commons-math3's ISAACRandom seeded
// with 256 ints of which only the first 4 are set; this port follows RuneSource's ISAACCipher,
// which produces the same stream. All maths is 32-bit: `| 0` after every add, `>>>` for unsigned shifts.

const SIZE = 256
const MASK = (SIZE - 1) << 2
const RATIO = 0x9e3779b9 | 0

export class Isaac {
  private count = 0
  private readonly results = new Int32Array(SIZE)
  private readonly memory = new Int32Array(SIZE)
  private a = 0
  private b = 0
  private c = 0

  constructor(seed: ArrayLike<number>) {
    for (let i = 0; i < seed.length; i++) this.results[i] = seed[i]!
    this.init()
  }

  next(): number {
    if (this.count-- === 0) {
      this.isaac()
      this.count = SIZE - 1
    }
    return this.results[this.count]!
  }

  private isaac() {
    const mem = this.memory
    const res = this.results
    let { a, b } = this
    this.c = (this.c + 1) | 0
    b = (b + this.c) | 0

    const step = (i: number, j: number, mix: number) => {
      const x = mem[i]!
      a = (a ^ mix) | 0
      a = (a + mem[j]!) | 0
      const y = (mem[(x & MASK) >> 2]! + a + b) | 0
      mem[i] = y
      b = (mem[((y >> 8) & MASK) >> 2]! + x) | 0
      res[i] = b
    }

    for (let half = 0; half < 2; half++) {
      let i = half * (SIZE / 2)
      let j = half === 0 ? SIZE / 2 : 0
      const end = i + SIZE / 2
      while (i < end) {
        step(i++, j++, a << 13)
        step(i++, j++, a >>> 6)
        step(i++, j++, a << 2)
        step(i++, j++, a >>> 16)
      }
    }

    this.a = a
    this.b = b
  }

  private init() {
    let a = RATIO, b = RATIO, c = RATIO, d = RATIO, e = RATIO, f = RATIO, g = RATIO, h = RATIO
    const mix = () => {
      a ^= b << 11; d = (d + a) | 0; b = (b + c) | 0
      b ^= c >>> 2; e = (e + b) | 0; c = (c + d) | 0
      c ^= d << 8; f = (f + c) | 0; d = (d + e) | 0
      d ^= e >>> 16; g = (g + d) | 0; e = (e + f) | 0
      e ^= f << 10; h = (h + e) | 0; f = (f + g) | 0
      f ^= g >>> 4; a = (a + f) | 0; g = (g + h) | 0
      g ^= h << 8; b = (b + g) | 0; h = (h + a) | 0
      h ^= a >>> 9; c = (c + h) | 0; a = (a + b) | 0
    }

    for (let i = 0; i < 4; i++) mix()

    // first pass mixes in the seed (results), second pass the memory from the first
    const mem = this.memory
    for (const src of [this.results, mem]) {
      for (let i = 0; i < SIZE; i += 8) {
        a = (a + src[i]!) | 0; b = (b + src[i + 1]!) | 0; c = (c + src[i + 2]!) | 0; d = (d + src[i + 3]!) | 0
        e = (e + src[i + 4]!) | 0; f = (f + src[i + 5]!) | 0; g = (g + src[i + 6]!) | 0; h = (h + src[i + 7]!) | 0
        mix()
        mem[i] = a; mem[i + 1] = b; mem[i + 2] = c; mem[i + 3] = d
        mem[i + 4] = e; mem[i + 5] = f; mem[i + 6] = g; mem[i + 7] = h
      }
    }

    this.isaac()
    this.count = SIZE
  }
}
