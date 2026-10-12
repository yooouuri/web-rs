import { Socket } from 'node:net'

// Browsers can't open raw TCP sockets, so each WebSocket gets its own TCP connection to the
// game server and bytes are passed through untouched. The protocol lives in the client.

export default defineWebSocketHandler({
  open(peer) {
    const { gameServer } = useRuntimeConfig()
    const socket = new Socket()
    peer.context.socket = socket

    socket.on('data', (chunk: Buffer) => peer.send(chunk))
    socket.on('close', () => peer.close())
    socket.on('error', (err) => {
      console.error('game server socket error:', err.message)
      peer.close()
    })
    socket.connect(Number(gameServer.port), gameServer.host)
  },

  message(peer, message) {
    // writes made before the socket has connected are queued by node
    (peer.context.socket as Socket).write(message.uint8Array())
  },

  close(peer) {
    (peer.context.socket as Socket | undefined)?.destroy()
  },
})
