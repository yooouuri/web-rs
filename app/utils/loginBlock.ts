// Port of the second half of Game.login: the login block (type 16, or 18 when reconnecting)
// and the messages shown for each login response.

/** Byte writer with the same big-endian layout as the client's Buffer. */
class Writer {
  private readonly bytes: number[] = []

  get length() {
    return this.bytes.length
  }

  write8(v: number) {
    this.bytes.push(v & 0xff)
  }

  write16(v: number) {
    this.write8(v >> 8)
    this.write8(v)
  }

  write32(v: number) {
    this.write16(v >> 16)
    this.write16(v)
  }

  /** ISO-8859-1 bytes terminated by '\n', like Buffer.writeString. */
  writeString(s: string) {
    for (let i = 0; i < s.length; i++) this.write8(s.charCodeAt(i))
    this.write8(10)
  }

  writeBytes(bytes: ArrayLike<number>) {
    for (let i = 0; i < bytes.length; i++) this.write8(bytes[i]!)
  }

  toArray() {
    return Uint8Array.from(this.bytes)
  }
}

export interface LoginBlock {
  bytes: Uint8Array
  /** ISAAC seed; the client encrypts outgoing packet IDs with it, incoming with each part + 50 */
  isaacSeed: [number, number, number, number]
}

export function buildLoginBlock(username: string, password: string, serverSeed: Uint8Array, reconnect = false): LoginBlock {
  const server = new DataView(serverSeed.buffer, serverSeed.byteOffset, 8)
  const isaacSeed: LoginBlock['isaacSeed'] = [
    (Math.random() * 99999999) | 0,
    (Math.random() * 99999999) | 0,
    server.getInt32(0),
    server.getInt32(4),
  ]

  // The client RSA-encrypts this part, but RuneSource skips RSA decoding and reads it as-is,
  // so it is sent unencrypted with the same [length][bytes] framing.
  const secure = new Writer()
  secure.write8(10)
  for (const part of isaacSeed) secure.write32(part)
  secure.write32(0) // Signlink.uid
  secure.writeString(username)
  secure.writeString(password)

  const login = new Writer()
  login.write8(reconnect ? 18 : 16)
  login.write8(secure.length + 1 + 36 + 1 + 1 + 2)
  login.write8(255)
  login.write16(317)
  login.write8(0) // low memory
  for (let archive = 0; archive < 9; archive++) {
    login.write32(0) // archive checksums; the server doesn't check them and there is no cache here
  }
  login.write8(secure.length)
  login.writeBytes(secure.toArray())

  return { bytes: login.toArray(), isaacSeed }
}

/** loginMessage0 / loginMessage1 for each response code in Game.login. */
export const LOGIN_MESSAGES: Record<number, [string, string]> = {
  3: ['', 'Invalid username or password.'],
  4: ['Your account has been disabled.', 'Please check your message-centre for details.'],
  5: ['Your account is already logged in.', 'Try again in 60 secs...'],
  6: ['RuneScape has been updated!', 'Please reload this page.'],
  7: ['This world is full.', 'Please use a different world.'],
  8: ['Unable to connect.', 'Login server offline.'],
  9: ['Login limit exceeded.', 'Too many connections from your address.'],
  10: ['Unable to connect.', 'Bad session id.'],
  11: ['Login server rejected session.', 'Please try again.'],
  12: ['You need a members account to login to this world.', 'Please subscribe, or use a different world.'],
  13: ['Could not complete login.', 'Please try using a different world.'],
  14: ['The server is being updated.', 'Please wait 1 minute and try again.'],
  16: ['Login attempts exceeded.', 'Please wait 1 minute and try again.'],
  17: ['You are standing in a members-only area.', 'To play on this world move to a free area first'],
  20: ['Invalid loginserver requested', 'Please try using a different world.'],
}
