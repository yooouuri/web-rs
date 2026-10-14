// Port of the walking part of Game.tryMove: a breadth-first search over the scene's collision
// flags (Game.levelCollisionMap, exported per map square by tools/ModelExport.java terrain) from
// the player's tile to the clicked one. Walking to locs and NPCs (reachedLoc, reachedWall...)
// isn't ported yet.

/** the scene is 104x104 tiles; flags are indexed z * 104 + x */
export const SCENE_SIZE = 104

/** CollisionMap.reset: the scene's edge is closed, the rest blocked until a land file is read */
export const FLAG_CLOSED = 0xffffff
export const FLAG_UNINITIALIZED = 0x1000000

/** Game.bfsStepX.length: the queue wraps around after this many tiles */
const QUEUE_SIZE = 4000
/** the move packet carries at most 25 waypoints */
const MAX_WAYPOINTS = 25

/**
 * Searches a path from (srcX, srcZ) to (dstX, dstZ) in scene tiles. Like the client it walks the
 * 8 directions, a tile can't be entered when its flags block the side you come from, and a
 * diagonal step also needs both tiles beside it open. When the target can't be reached and
 * tryNearest is set, the cheapest reachable tile around it (3x3) is used instead.
 *
 * Returns the waypoints the client sends, the tiles where the path turns, from the first one after
 * the start to the destination (at most 25), or undefined when nothing is reachable. Clicking the
 * tile you stand on gives that tile, which the client sends too.
 */
export function findPath(flags: Int32Array, srcX: number, srcZ: number, dstX: number, dstZ: number, tryNearest: boolean): [number, number][] | undefined {
  // bfsDirection: how to step back towards the source, 0 = not visited; bfsCost: steps from the source
  const direction = new Int32Array(SCENE_SIZE * SCENE_SIZE)
  const cost = new Int32Array(SCENE_SIZE * SCENE_SIZE).fill(99999999)
  const at = (x: number, z: number) => x * SCENE_SIZE + z
  const flag = (x: number, z: number) => flags[z * SCENE_SIZE + x]!

  const queueX = new Int32Array(QUEUE_SIZE)
  const queueZ = new Int32Array(QUEUE_SIZE)
  let steps = 0
  let length = 0
  direction[at(srcX, srcZ)] = 99
  cost[at(srcX, srcZ)] = 0
  queueX[steps] = srcX
  queueZ[steps++] = srcZ

  let x = srcX
  let z = srcZ
  let arrived = false
  const visit = (nx: number, nz: number, dir: number, nextCost: number) => {
    queueX[steps] = nx
    queueZ[steps] = nz
    steps = (steps + 1) % QUEUE_SIZE
    direction[at(nx, nz)] = dir
    cost[at(nx, nz)] = nextCost
  }

  while (length !== steps) {
    x = queueX[length]!
    z = queueZ[length]!
    length = (length + 1) % QUEUE_SIZE
    if (x === dstX && z === dstZ) {
      arrived = true
      break
    }

    const nextCost = cost[at(x, z)]! + 1
    const open = (nx: number, nz: number) => direction[at(nx, nz)] === 0
    // west, east, south, north
    if (x > 0 && open(x - 1, z) && (flag(x - 1, z) & 0x1280108) === 0) visit(x - 1, z, 2, nextCost)
    if (x < SCENE_SIZE - 1 && open(x + 1, z) && (flag(x + 1, z) & 0x1280180) === 0) visit(x + 1, z, 8, nextCost)
    if (z > 0 && open(x, z - 1) && (flag(x, z - 1) & 0x1280102) === 0) visit(x, z - 1, 1, nextCost)
    if (z < SCENE_SIZE - 1 && open(x, z + 1) && (flag(x, z + 1) & 0x1280120) === 0) visit(x, z + 1, 4, nextCost)
    // south-west, south-east, north-west, north-east
    if (x > 0 && z > 0 && open(x - 1, z - 1) && (flag(x - 1, z - 1) & 0x128010e) === 0
      && (flag(x - 1, z) & 0x1280108) === 0 && (flag(x, z - 1) & 0x1280102) === 0) visit(x - 1, z - 1, 3, nextCost)
    if (x < SCENE_SIZE - 1 && z > 0 && open(x + 1, z - 1) && (flag(x + 1, z - 1) & 0x1280183) === 0
      && (flag(x + 1, z) & 0x1280180) === 0 && (flag(x, z - 1) & 0x1280102) === 0) visit(x + 1, z - 1, 9, nextCost)
    if (x > 0 && z < SCENE_SIZE - 1 && open(x - 1, z + 1) && (flag(x - 1, z + 1) & 0x1280138) === 0
      && (flag(x - 1, z) & 0x1280108) === 0 && (flag(x, z + 1) & 0x1280120) === 0) visit(x - 1, z + 1, 6, nextCost)
    if (x < SCENE_SIZE - 1 && z < SCENE_SIZE - 1 && open(x + 1, z + 1) && (flag(x + 1, z + 1) & 0x12801e0) === 0
      && (flag(x + 1, z) & 0x1280180) === 0 && (flag(x, z + 1) & 0x1280120) === 0) visit(x + 1, z + 1, 12, nextCost)
  }

  if (!arrived) {
    if (!tryNearest) return undefined
    // the client only ever looks one tile around the target (padding < 2)
    let min = 100
    for (let px = dstX - 1; px <= dstX + 1; px++) {
      for (let pz = dstZ - 1; pz <= dstZ + 1; pz++) {
        if (px >= 0 && pz >= 0 && px < SCENE_SIZE && pz < SCENE_SIZE && cost[at(px, pz)]! < min) {
          min = cost[at(px, pz)]!
          x = px
          z = pz
          arrived = true
        }
      }
    }
    if (!arrived) return undefined
  }

  // walk back from the destination to the source, keeping the tiles where the direction changes
  const path: [number, number][] = [[x, z]]
  let dir = direction[at(x, z)]!
  let next = dir
  while (x !== srcX || z !== srcZ) {
    if (next !== dir) {
      dir = next
      path.push([x, z])
    }
    if ((next & 2) !== 0) x++
    else if ((next & 8) !== 0) x--
    if ((next & 1) !== 0) z++
    else if ((next & 4) !== 0) z--
    next = direction[at(x, z)]!
  }

  // the client sends the waypoint nearest the source first and stops after 25
  return path.reverse().slice(0, MAX_WAYPOINTS)
}
