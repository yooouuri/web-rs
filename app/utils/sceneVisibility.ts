// Scene.initVisibilityMatrix / testPoint: which tiles around the camera Scene.draw may draw, for 8
// pitch and 32 yaw steps. A tile is visible when some point above it (from 500 below to 800 above
// the orbit height) projects into the 512x334 viewport between 50 and 3500 units in front of the
// camera; then every tile next to a visible one, or visible at the next pitch or yaw step, is too.
// Integer maths like the client, so the same tiles are drawn.

/** Draw3D.sin / cos: 2048 steps per turn, scaled by 65536 */
export const SIN = new Int32Array(2048)
export const COS = new Int32Array(2048)
for (let i = 0; i < 2048; i++) {
  SIN[i] = Math.trunc(65536 * Math.sin(i * 0.0030679615))
  COS[i] = Math.trunc(65536 * Math.cos(i * 0.0030679615))
}

/** tiles drawn in each direction from the camera's tile (Scene.draw's minDrawTileX = eyeTileX - 25) */
export const DRAW_RADIUS = 25
const SIZE = DRAW_RADIUS * 2
const VIEWPORT_W = 512
const VIEWPORT_H = 334

let matrix: Uint8Array | undefined

/** visibilityMatrix[pitchLevel][yawLevel] as 50x50 tiles, index (dx + 25) * 50 + (dz + 25) */
export function visibilityMap(pitch: number, yaw: number): Uint8Array {
  matrix ??= buildMatrix()
  const offset = (Math.trunc((pitch - 128) / 32) * 32 + Math.trunc(yaw / 64)) * SIZE * SIZE
  return matrix.subarray(offset, offset + SIZE * SIZE)
}

function buildMatrix() {
  const pitchDistance = new Int32Array(9)
  for (let pitchLevel = 0; pitchLevel < 9; pitchLevel++) {
    const angle = 128 + pitchLevel * 32 + 15
    pitchDistance[pitchLevel] = ((600 + angle * 3) * SIN[angle]!) >> 16
  }

  // 9 pitches x 32 yaws x 53 x 53 tiles, index ((p * 32 + y) * 53 + x + 26) * 53 + z + 26
  const raw = new Uint8Array(9 * 32 * 53 * 53)
  const at = (p: number, y: number, x: number, z: number) => ((p * 32 + y) * 53 + x + 26) * 53 + z + 26
  for (let pitch = 128; pitch <= 384; pitch += 32) {
    for (let yaw = 0; yaw < 2048; yaw += 64) {
      const sinPitch = SIN[pitch]!
      const cosPitch = COS[pitch]!
      const sinYaw = SIN[yaw]!
      const cosYaw = COS[yaw]!
      const pitchLevel = (pitch - 128) / 32
      for (let dx = -26; dx <= 26; dx++) {
        for (let dz = -26; dz <= 26; dz++) {
          for (let y = -500; y <= 800; y += 128) {
            if (testPoint(pitchDistance[pitchLevel]! + y, dz * 128, dx * 128, sinPitch, cosPitch, sinYaw, cosYaw)) {
              raw[at(pitchLevel, yaw / 64, dx, dz)] = 1
              break
            }
          }
        }
      }
    }
  }

  const out = new Uint8Array(8 * 32 * SIZE * SIZE)
  for (let p = 0; p < 8; p++) {
    for (let y = 0; y < 32; y++) {
      for (let x = -DRAW_RADIUS; x < DRAW_RADIUS; x++) {
        for (let z = -DRAW_RADIUS; z < DRAW_RADIUS; z++) {
          let visible = 0
          for (let dx = -1; dx <= 1 && !visible; dx++) {
            for (let dz = -1; dz <= 1 && !visible; dz++) {
              // (yaw + 1) % 31 like the client, so yaw step 30 checks step 0
              visible = raw[at(p, y, x + dx, z + dz)]! | raw[at(p, (y + 1) % 31, x + dx, z + dz)]!
                | raw[at(p + 1, y, x + dx, z + dz)]! | raw[at(p + 1, (y + 1) % 31, x + dx, z + dz)]!
            }
          }
          out[(p * 32 + y) * SIZE * SIZE + (x + DRAW_RADIUS) * SIZE + z + DRAW_RADIUS] = visible
        }
      }
    }
  }
  return out
}

function testPoint(y: number, z: number, x: number, sinPitch: number, cosPitch: number, sinYaw: number, cosYaw: number) {
  const px = (z * sinYaw + x * cosYaw) >> 16
  const tmp = (z * cosYaw - x * sinYaw) >> 16
  const pz = (y * sinPitch + tmp * cosPitch) >> 16
  const py = (y * cosPitch - tmp * sinPitch) >> 16
  if (pz < 50 || pz > 3500) return false
  const viewportX = VIEWPORT_W / 2 + Math.trunc((px << 9) / pz)
  const viewportY = Math.trunc(VIEWPORT_H / 2) + Math.trunc((py << 9) / pz)
  return viewportX >= 0 && viewportX <= VIEWPORT_W && viewportY >= 0 && viewportY <= VIEWPORT_H
}
