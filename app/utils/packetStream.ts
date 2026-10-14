import { Isaac } from './isaac'

// Game packets after login. Every opcode is offset by the next ISAAC value: outgoing with the
// login seed (Buffer.writeOp), incoming with each seed part + 50 (randomIn in Game.login).

/**
 * PacketIn.SIZE: payload length per incoming opcode, -1 = u8 length prefix, -2 = u16 length prefix.
 * Dumped from the client.
 */
const PACKET_SIZES = [
  0, 0, 0, 0, 6, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
  0, 0, -2, 4, 3, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 6, 0, 0, 9, 0, 0, -2, 0, 0, 0, 0, 0, 0, -2, 1, 0, 0,
  2, -2, 0, 0, 0, 0, 6, 3, 2, 4, 2, 4, 0, 0, 0, 4, 0, -2, 0, 0, 7, 2, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 2, 0, 1, 0, 2, 0, 0, -1, 4, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 15, 0, 0, 0, 4, 4, 0, 0, 0, -2, 0,
  0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 14, 0, 0, 0, 4, 0, 0, 0, 0, 3, 0, 0, 0,
  4, 0, 0, 0, 2, 0, 6, 0, 0, 0, 0, 3, 0, 0, 5, 0, 10, 6, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, -1, 0, 0, 0, 4, 0, 0, 0, 0, 0, 3, 0, 2, 0, 0, 0, 0, 0, -2, 7, 0, 0, 2, 0, 0, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, -2, 0, 0, 0, 0, 6, 0, 4, 3, 0, 0, 0, -1, 6, 0,
]

export const PacketIn = {
  REBUILD_REGION: 73,
  SYNC_PLAYERS: 81,
  LOGOUT: 109,
} as const

/** Game.readRebuildRegion (non-instanced): the zone (8x8 tiles) the scene is centred on. */
export function readRebuildRegion(data: Uint8Array) {
  return {
    zoneX: (data[0]! << 8) + ((data[1]! - 128) & 0xff), // readU16A
    zoneZ: (data[2]! << 8) + data[3]!, // readU16
  }
}

/** Direction deltas of PathingEntity.step, indexed by the 3-bit direction. */
const STEP_DX = [-1, 0, 1, -1, 1, -1, 0, 1]
const STEP_DZ = [1, 1, 1, 0, 0, -1, -1, -1]

export type LocalPlayerUpdate =
  | { type: 'none' }
  /** type 3: placed at scene tile (x, z), 0..103 */
  | { type: 'place', level: number, x: number, z: number }
  /** types 1 and 2: one (walk) or two (run) steps */
  | { type: 'steps', dx: number, dz: number }

/** Game.readLocalPlayer, the first bits of packet 81. The rest (other players, appearance) is ignored. */
export function readLocalPlayer(data: Uint8Array): LocalPlayerUpdate {
  let bit = 0
  // Buffer.readN: most significant bit first
  const readN = (n: number) => {
    let value = 0
    for (let i = 0; i < n; i++, bit++) value = (value << 1) | ((data[bit >> 3]! >> (7 - (bit & 7))) & 1)
    return value
  }

  if (readN(1) === 0) return { type: 'none' }
  const type = readN(2)
  if (type === 1 || type === 2) {
    let dx = 0
    let dz = 0
    for (let i = 0; i < type; i++) {
      const dir = readN(3)
      dx += STEP_DX[dir]!
      dz += STEP_DZ[dir]!
    }
    return { type: 'steps', dx, dz }
  }
  if (type === 3) {
    const level = readN(2)
    readN(1) // teleport
    readN(1) // has an appearance/mask update
    const z = readN(7)
    const x = readN(7)
    return { type: 'place', level, x, z }
  }
  return { type: 'none' } // type 0: only a mask update
}

export const PacketOut = {
  /** sent when nothing else was sent for a while; RuneSource drops clients silent for 5s */
  NO_TIMEOUT: 0,
  /** Game.tryMove type 0: walk here (98 walks to a loc or NPC, 248 comes from the minimap) */
  MOVE_GAMECLICK: 164,
  IF_BUTTON: 185,
} as const

/**
 * The payload Game.tryMove writes after the opcode: the length (a u8, the packet is variable
 * size), the first waypoint's world x (write16LEA: low byte + 128), the other waypoints as
 * signed bytes relative to the first, its world z (write16LE) and whether to run (write8C, negated).
 * Waypoints are scene tiles from findPath; base is the scene's world origin (sceneBaseTileX/Z).
 */
export function writeMove(waypoints: [number, number][], baseX: number, baseZ: number, run: boolean): number[] {
  const [startX, startZ] = waypoints[0]!
  const x = startX + baseX
  const z = startZ + baseZ
  const out = [waypoints.length * 2 + 3, (x + 128) & 0xff, (x >> 8) & 0xff]
  for (const [wx, wz] of waypoints.slice(1)) out.push((wx - startX) & 0xff, (wz - startZ) & 0xff)
  out.push(z & 0xff, (z >> 8) & 0xff, -Number(run) & 0xff)
  return out
}

type Connection = ReturnType<typeof useGameConnection>

export class PacketStream {
  private readonly encryptor: Isaac
  private readonly decryptor: Isaac
  /** Date.now() of the last packet sent, for the heartbeat (heartbeatTimer in the client) */
  lastSent = Date.now()

  constructor(private readonly connection: Connection, isaacSeed: readonly number[]) {
    this.encryptor = new Isaac(isaacSeed)
    this.decryptor = new Isaac(isaacSeed.map(part => (part + 50) | 0))
  }

  send(op: number, payload: ArrayLike<number> = []) {
    this.connection.write([(op + this.encryptor.next()) & 0xff, ...Array.from(payload)])
    this.lastSent = Date.now()
  }

  /** Game.updateNetwork: after ~50 client cycles (1s) without output, send opcode 0. */
  heartbeat() {
    if (Date.now() - this.lastSent > 1000) this.send(PacketOut.NO_TIMEOUT)
  }

  /** Reads the next packet; rejects when the connection closes. */
  async read(): Promise<{ op: number, data: Uint8Array }> {
    const op = ((await this.connection.read(1))[0]! - this.decryptor.next()) & 0xff
    let size = PACKET_SIZES[op]!
    if (size === -1) {
      size = (await this.connection.read(1))[0]!
    }
    else if (size === -2) {
      const [hi, lo] = await this.connection.read(2)
      size = (hi! << 8) | lo!
    }
    return { op, data: size > 0 ? await this.connection.read(size) : new Uint8Array(0) }
  }
}
