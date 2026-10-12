// Stand-in for the client's Connection class: a byte stream over the /ws/game relay with
// blocking-style reads, so the login code can be written the same way as Game.login.

export function useGameConnection() {
  const received = shallowRef(new Uint8Array(0))

  const { status, send, open, close } = useWebSocket(
    () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/game`,
    {
      immediate: false,
      autoConnect: false,
      onConnected(ws) {
        ws.binaryType = 'arraybuffer'
      },
      onMessage(_, event) {
        const chunk = new Uint8Array(event.data as ArrayBuffer)
        const merged = new Uint8Array(received.value.length + chunk.length)
        merged.set(received.value)
        merged.set(chunk, received.value.length)
        received.value = merged
      },
    },
  )

  /** Opens a fresh connection, or rejects if the relay can't be reached. */
  async function connect() {
    received.value = new Uint8Array(0)
    open()
    await until(status).not.toBe('CONNECTING')
    if (status.value !== 'OPEN') throw new Error('Error connecting to server.')
  }

  function write(bytes: ArrayLike<number>) {
    send(Uint8Array.from(bytes).buffer, false)
  }

  /** Waits until n bytes are available, or rejects if the connection closes first. */
  async function read(n: number): Promise<Uint8Array> {
    await until(() => received.value.length >= n || status.value === 'CLOSED').toBe(true)
    if (received.value.length < n) throw new Error('connection closed')
    const bytes = received.value.slice(0, n)
    received.value = received.value.slice(n)
    return bytes
  }

  return { status, connect, write, read, close }
}
