<script setup lang="ts">
import { LinearSRGBColorSpace, NoToneMapping } from 'three'
import { Flames } from '~/utils/flames'
import { GameScreen } from '~/utils/gameScreen'
import { TitleBox } from '~/utils/titleBox'

// The client blends in raw sRGB values, so colour management and tone mapping are turned off
// to keep the pixels identical to the original.

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = reject
  img.src = src
})

const assets = shallowRef<{ background: HTMLImageElement, flames: Flames, box: TitleBox }>()

// set once logged in; plays the role of the client's ingame flag
const game = shallowRef<GameScreen>()

// closed automatically when the component unmounts
const connection = useGameConnection()

// Port of Game.login: request type 14 plus the name hash, then the server's 8 ignored bytes and
// a response byte. On 0 the server seed follows, the login block goes out and the real login
// response comes back.
async function login(box: TitleBox) {
  box.loginMessage0 = ''
  box.loginMessage1 = 'Connecting to server...'
  box.hideButtons = true

  try {
    await connection.connect()

    const namePart = Number((toBase37(box.username) >> 16n) & 31n)
    connection.write([14, namePart])

    await connection.read(8)
    let response = (await connection.read(1))[0]!

    if (response === 0) {
      const serverSeed = await connection.read(8)
      const { bytes, isaacSeed } = buildLoginBlock(box.username, box.password, serverSeed)
      connection.write(bytes)
      response = (await connection.read(1))[0]!

      if (response === 2) {
        const [rights, flagged] = await connection.read(2)
        console.info('logged in', { rights, flagged: flagged === 1 })
        const stream = new PacketStream(connection, isaacSeed)
        game.value = await GameScreen.load(box.username, (op, payload) => stream.send(op, payload))
        box.hideButtons = false
        readPackets(stream, game.value)
        return
      }
    }

    const [message0, message1] = LOGIN_MESSAGES[response] ?? ['Unexpected server response', 'Please try using a different world.']
    box.loginMessage0 = message0
    box.loginMessage1 = message1
    connection.close()
  }
  catch {
    box.loginMessage0 = ''
    box.loginMessage1 = 'Error connecting to server.'
  }
  box.hideButtons = false
}

let packets: PacketStream | undefined

// checks the heartbeat a few times per second, like the client's per-cycle check
const heartbeat = useIntervalFn(() => packets?.heartbeat(), 250, { immediate: false })

// Game.read: handles incoming packets while this game screen is the active one. Handled so far:
// the region (73) and the local player's position (81) for the 3D view, and logout (109);
// everything else is read and skipped.
async function readPackets(stream: PacketStream, screen: GameScreen) {
  packets = stream
  heartbeat.resume()
  try {
    while (game.value === screen) {
      const { op, data } = await stream.read()
      if (op === PacketIn.LOGOUT) break

      if (op === PacketIn.REBUILD_REGION) {
        const { zoneX, zoneZ } = readRebuildRegion(data)
        screen.world.setRegion(zoneX, zoneZ)
      }
      else if (op === PacketIn.SYNC_PLAYERS) {
        const update = readLocalPlayer(data)
        if (update.type === 'place') screen.world.setPlayer(update.x, update.z, update.level)
        else if (update.type === 'steps') screen.world.movePlayer(update.dx, update.dz)
      }
    }
  }
  catch {
    // connection closed; the client tries to reconnect here, this goes straight back to the title
  }
  if (game.value === screen) logout()
}

// Port of Game.logout: drop the connection and go back to the title screen's welcome box.
function logout() {
  heartbeat.pause()
  packets = undefined
  connection.close()
  game.value = undefined
  const box = assets.value?.box
  if (box) {
    box.state = 0
    box.username = ''
    box.password = ''
  }
}

function onKeyDown(event: KeyboardEvent) {
  const box = assets.value?.box
  if (!box || event.metaKey || event.ctrlKey || event.altKey) return

  let code = -1
  if (event.key === 'Backspace') code = 8
  else if (event.key === 'Tab') code = 9
  else if (event.key === 'Enter') code = 13
  else if (event.key.length === 1) code = event.key.charCodeAt(0)
  if (code === -1) return

  if (game.value) {
    event.preventDefault()
    game.value.key(code)
    return
  }

  if (box.state === 2) event.preventDefault()
  box.key(code)
}

onMounted(async () => {
  const [background, titlebox, titlebutton] = await Promise.all([
    loadImage('/title/background.png'),
    loadImage('/title/titlebox.png'),
    loadImage('/title/titlebutton.png'),
  ])
  const box: TitleBox = new TitleBox(titlebox, titlebutton, () => login(box))
  assets.value = { background, flames: new Flames(), box }
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="title-screen">
    <ClientOnly>
      <TresCanvas
        v-if="assets"
        clear-color="#000000"
        :antialias="false"
        :tone-mapping="NoToneMapping"
        :output-color-space="LinearSRGBColorSpace"
      >
        <GameScene v-if="game" :screen="game" />
        <TitleScene v-else :background="assets.background" :flames="assets.flames" :box="assets.box" />
      </TresCanvas>
    </ClientOnly>
  </div>
</template>

<style scoped>
/* The 765x503 game scaled to fit the window. The size comes from the window only: the canvas is
   taken out of the flow, so its old size can't hold the box open when the window shrinks. */
.title-screen {
  position: relative;
  width: min(100vw, 100vh * 765 / 503);
  height: min(100vh, 100vw * 503 / 765);
  background: #000;
}

.title-screen :deep(canvas) {
  position: absolute !important;
  inset: 0;
  image-rendering: pixelated;
}
</style>
