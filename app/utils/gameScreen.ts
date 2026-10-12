import { drawString, drawStringCenter, stringWidth } from './bitmapFont'
import { INTERFACES, type IfComponent } from './interfaces'
import { fontBold12, fontPlain12 } from './titleData'
import { WorldView } from './worldView'

// Port of Game.drawGame and the parts it draws before a map has loaded (sceneState != 2):
// the frame, sidebar (drawSidebar), tab icons (drawSideicons), chat (drawChatback / drawChat)
// and the chat settings bar (drawPrivacySettings). The viewport, minimap and compass stay
// black like in the client until the scene is built.

export const SCREEN_W = 765
export const SCREEN_H = 503

const FRAME = [
  'backleft1', 'backleft2', 'backright1', 'backright2', 'backtop1', 'backvmid1', 'backvmid2',
  'backvmid3', 'backhmid1', 'backhmid2', 'backbase1', 'backbase2', 'chatback', 'invback',
  'mapback', 'redstone1', 'redstone2', 'redstone3', 'scrollbar_0', 'scrollbar_1',
] as const

type FrameImage = typeof FRAME[number]

// The extracted sprites are trimmed; these are the cropX/cropY offsets the client draws them at.
const SIDEICON_CROP: [number, number][] = [
  [4, 5], [3, 3], [4, 4], [0, 0], [3, 1], [3, 2], [3, 3], [3, 3], [3, 3], [2, 3], [2, 2], [7, 3], [6, 3],
]

/** Tab click boxes from Game.handleTabInput: [minX, maxX (inclusive), minY, maxY (exclusive)]. */
const TAB_HITBOXES: [number, number, number, number][] = [
  [539, 573, 169, 205], [569, 599, 168, 205], [597, 627, 168, 205], [625, 669, 168, 203],
  [666, 696, 168, 205], [694, 724, 168, 205], [722, 756, 169, 205],
  [540, 574, 466, 502], [572, 602, 466, 503], [599, 629, 466, 503], [627, 671, 467, 502],
  [669, 699, 466, 503], [696, 726, 466, 503], [724, 758, 466, 502],
]

/** areaSidebar's position; sidebar interfaces are drawn and hit-tested relative to it */
const SIDEBAR_X = 553
const SIDEBAR_Y = 205

const FONTS = { p12: fontPlain12, b12: fontBold12 }

const inside = (c: IfComponent, mx: number, my: number) =>
  mx >= SIDEBAR_X + c.x && my >= SIDEBAR_Y + c.y && mx < SIDEBAR_X + c.x + c.width && my < SIDEBAR_Y + c.y + c.height

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = reject
  img.src = src
})

/** Port of StringUtil.formatName. */
export function formatName(s: string) {
  return s
    .replace(/_([a-z])?/g, (_, c?: string) => ' ' + (c ? c.toUpperCase() : ''))
    .replace(/^[a-z]/, c => c.toUpperCase())
}

export class GameScreen {
  /** 0 = on, 1 = friends, 2 = off, 3 = hide (public only) */
  publicChatSetting = 0
  privateChatSetting = 0
  tradeChatSetting = 0
  selectedTab = 3
  /**
   * sidebar interface per tab, -1 = no tab. Hardcoded to what RuneSource sends after login
   * (Player.SIDEBAR_INTERFACE_IDS, tab 0 = unarmed combat) until packet 71 can be read.
   */
  tabInterfaceID = [5855, 3917, 638, 3213, 1644, 5608, 1151, -1, 5065, 5715, 2449, 4445, 147, 6299]
  /** plain (type 0) chat messages, newest first */
  messages: string[] = []
  chatTyped = ''
  /** set when anything on screen changed, like the client's redraw* flags */
  redraw = true
  /** sidebarHoveredInterfaceID */
  hoveredInterfaceID = -1
  /** the 3D view in the viewport; fed by packets 73 (region) and 81 (local player) */
  readonly world = new WorldView()

  private constructor(
    private readonly images: Record<FrameImage, HTMLImageElement>,
    private readonly sideicons: HTMLImageElement[],
    private readonly interfaceImages: Record<string, HTMLImageElement>,
    private readonly username: string,
    /** Game.useButton: sends the button click (packet 185) to the server */
    private readonly onButton: (id: number) => void,
  ) {}

  static async load(username: string, onButton: (id: number) => void) {
    const ifImages = Object.values(INTERFACES).flat().flatMap(c => (c.type === 'image' ? [c.image] : []))
    const [frame, sideicons, ifLoaded] = await Promise.all([
      Promise.all(FRAME.map(name => loadImage(`/game/${name}.png`))),
      Promise.all(SIDEICON_CROP.map((_, i) => loadImage(`/game/sideicons_${i}.png`))),
      Promise.all(ifImages.map(name => loadImage(`/game/${name}.png`))),
    ])
    const images = Object.fromEntries(FRAME.map((name, i) => [name, frame[i]!])) as Record<FrameImage, HTMLImageElement>
    const interfaceImages = Object.fromEntries(ifImages.map((name, i) => [name, ifLoaded[i]!]))
    return new GameScreen(images, sideicons, interfaceImages, username, onButton)
  }

  /** components of the open tab's interface, if it has been exported */
  private get sidebarComponents(): IfComponent[] {
    return INTERFACES[this.tabInterfaceID[this.selectedTab]!] ?? []
  }

  /** Hover part of Game.handleInterfaceInput: a component with a hover colour under the mouse. */
  hover(mx: number, my: number) {
    let hovered = -1
    for (const c of this.sidebarComponents) {
      if (c.type === 'text' && c.hoverColor !== 0 && inside(c, mx, my)) hovered = c.id
    }
    if (hovered !== this.hoveredInterfaceID) {
      this.hoveredInterfaceID = hovered
      this.redraw = true
    }
  }

  click(mx: number, my: number) {
    // Game.handleInterfaceInput + useButton: left click on a standard button
    for (const c of this.sidebarComponents) {
      if (c.type === 'text' && c.optionType === 1 && inside(c, mx, my)) this.onButton(c.id)
    }

    // Game.handleTabInput. The boxes overlap a little; like the client, the last match wins.
    TAB_HITBOXES.forEach(([x0, x1, y0, y1], tab) => {
      if (mx >= x0 && mx <= x1 && my >= y0 && my < y1 && this.tabInterfaceID[tab] !== -1) {
        this.selectedTab = tab
        this.redraw = true
      }
    })
    this.hover(mx, my)
  }

  /** Port of Game.handleInputChatKey. */
  key(code: number) {
    // 32 to 122 is all letters, numbers and symbols except {|}~
    if (code >= 32 && code <= 122 && this.chatTyped.length < 80) {
      this.chatTyped += String.fromCharCode(code)
      this.redraw = true
    }
    if (code === 8 && this.chatTyped.length > 0) {
      this.chatTyped = this.chatTyped.slice(0, -1)
      this.redraw = true
    }
    if ((code === 10 || code === 13) && this.chatTyped.length > 0) {
      // the client sends packet 4 here (compressed chat text); not ported yet, so the line is only cleared
      this.chatTyped = ''
      this.redraw = true
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const img = this.images
    const texts: (() => void)[] = []
    let pixels: ImageData

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H)

    // redrawTitleBackground: the static frame pieces
    ctx.drawImage(img.backleft1, 0, 4)
    ctx.drawImage(img.backleft2, 0, 357)
    ctx.drawImage(img.backright1, 722, 4)
    ctx.drawImage(img.backright2, 743, 205)
    ctx.drawImage(img.backtop1, 0, 0)
    ctx.drawImage(img.backvmid1, 516, 4)
    ctx.drawImage(img.backvmid2, 516, 205)
    ctx.drawImage(img.backvmid3, 496, 357)
    ctx.drawImage(img.backhmid2, 0, 338)
    // areaViewport (4, 4) is left black; areaMapback only holds mapback until the minimap is drawn
    ctx.drawImage(img.mapback, 550, 4)

    // drawSidebar: background plus the open tab's interface (drawParentInterface)
    ctx.drawImage(img.invback, SIDEBAR_X, SIDEBAR_Y)
    for (const c of this.sidebarComponents) {
      if (c.type === 'image') ctx.drawImage(this.interfaceImages[c.image]!, SIDEBAR_X + c.x, SIDEBAR_Y + c.y)
      else texts.push(() => this.drawInterfaceText(pixels, c))
    }

    this.drawSideicons(ctx)

    // drawChatback / drawChat, area at (17, 357)
    ctx.drawImage(img.chatback, 17, 357)
    this.drawScrollbar(ctx, 17 + 463, 357, 77, 78, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(17, 357 + 77, 479, 1) // Draw2D.drawLineX(0, 77, 479, 0)
    texts.push(() => this.drawChatText(pixels))

    // drawPrivacySettings, area at (0, 453)
    ctx.drawImage(img.backbase1, 0, 453)
    texts.push(() => this.drawPrivacyText(pixels))

    // sprites go through canvas, the text straight into the pixels like on the title screen
    pixels = ctx.getImageData(0, 0, SCREEN_W, SCREEN_H)
    for (const draw of texts) draw()
    ctx.putImageData(pixels, 0, 0)
  }

  private drawSideicons(ctx: CanvasRenderingContext2D) {
    const { redstone1, redstone2, redstone3 } = this.images
    const tab = this.selectedTab
    const has = (t: number) => this.tabInterfaceID[t] !== -1
    const icon = (i: number, x: number, y: number) => {
      const [cx, cy] = SIDEICON_CROP[i]!
      ctx.drawImage(this.sideicons[i]!, x + cx, y + cy)
    }

    // areaBackhmid1 at (516, 160): tabs 0-6
    const top = (image: HTMLImageElement, x: number, y: number, flipH = false) =>
      this.blit(ctx, image, 516 + x, 160 + y, flipH, false)
    ctx.drawImage(this.images.backhmid1, 516, 160)
    if (has(tab)) {
      if (tab === 0) top(redstone1, 22, 10)
      if (tab === 1) top(redstone2, 54, 8)
      if (tab === 2) top(redstone2, 82, 8)
      if (tab === 3) top(redstone3, 110, 8)
      if (tab === 4) top(redstone2, 153, 8, true)
      if (tab === 5) top(redstone2, 181, 8, true)
      if (tab === 6) top(redstone1, 209, 9, true)
    }
    const topIcons: [number, number][] = [[29, 13], [53, 11], [82, 11], [115, 12], [153, 13], [180, 11], [208, 13]]
    topIcons.forEach(([x, y], t) => has(t) && icon(t, 516 + x, 160 + y))

    // areaBackbase2 at (496, 466): tabs 7-13, drawn with vertically flipped stones
    const bottom = (image: HTMLImageElement, x: number, y: number, flipH = false) =>
      this.blit(ctx, image, 496 + x, 466 + y, flipH, true)
    ctx.drawImage(this.images.backbase2, 496, 466)
    if (has(tab)) {
      if (tab === 7) bottom(redstone1, 42, 0)
      if (tab === 8) bottom(redstone2, 74, 0)
      if (tab === 9) bottom(redstone2, 102, 0)
      if (tab === 10) bottom(redstone3, 130, 1)
      if (tab === 11) bottom(redstone2, 173, 0, true)
      if (tab === 12) bottom(redstone2, 201, 0, true)
      if (tab === 13) bottom(redstone1, 229, 0, true)
    }
    // tab 7 has no icon; sideicons 7-12 belong to tabs 8-13
    const bottomIcons: [number, number][] = [[74, 2], [102, 3], [137, 4], [174, 2], [201, 2], [226, 2]]
    bottomIcons.forEach(([x, y], i) => has(i + 8) && icon(i + 7, 496 + x, 466 + y))
  }

  /** Image8.blit with the flipHorizontally / flipVertically copies made at load. */
  private blit(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, flipH: boolean, flipV: boolean) {
    ctx.save()
    ctx.translate(x + (flipH ? image.width : 0), y + (flipV ? image.height : 0))
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    ctx.drawImage(image, 0, 0)
    ctx.restore()
  }

  /** Port of Game.drawScrollbar. */
  private drawScrollbar(ctx: CanvasRenderingContext2D, x: number, y: number, height: number, scrollHeight: number, scrollY: number) {
    const fill = (fx: number, fy: number, w: number, h: number, rgb: number) => {
      ctx.fillStyle = `#${rgb.toString(16).padStart(6, '0')}`
      ctx.fillRect(fx, fy, w, h)
    }
    ctx.drawImage(this.images.scrollbar_0, x, y)
    ctx.drawImage(this.images.scrollbar_1, x, y + height - 16)
    fill(x, y + 16, 16, height - 32, 0x23201b)
    const gripSize = Math.max(8, (((height - 32) * height) / scrollHeight) | 0)
    const gripY = scrollHeight > height ? (((height - 32 - gripSize) * scrollY) / (scrollHeight - height)) | 0 : 0
    fill(x, y + 16 + gripY, 16, gripSize, 0x4d4233)
    fill(x, y + 16 + gripY, 1, gripSize, 0x766654)
    fill(x + 1, y + 16 + gripY, 1, gripSize, 0x766654)
    fill(x, y + 16 + gripY, 16, 1, 0x766654)
    fill(x, y + 17 + gripY, 16, 1, 0x766654)
    fill(x + 15, y + 16 + gripY, 1, gripSize, 0x332d25)
    fill(x + 14, y + 17 + gripY, 1, gripSize - 1, 0x332d25)
    fill(x, y + 15 + gripY + gripSize, 16, 1, 0x332d25)
    fill(x + 1, y + 14 + gripY + gripSize, 15, 1, 0x332d25)
  }

  /** Port of Game.drawInterfaceText (without scripts and %-substitutions). */
  private drawInterfaceText(pixels: ImageData, c: Extract<IfComponent, { type: 'text' }>) {
    const font = FONTS[c.font]
    const rgb = c.hoverColor !== 0 && this.hoveredInterfaceID === c.id ? c.hoverColor : c.color
    const x = SIDEBAR_X + c.x
    let lineY = SIDEBAR_Y + c.y + font.height
    // a literal backslash-n in the cache text starts a new line
    for (const line of c.text.split('\\n')) {
      if (c.center) drawStringCenter(pixels, font, line, x + ((c.width / 2) | 0), lineY, rgb, c.shadow)
      else drawString(pixels, font, line, x, lineY, rgb, c.shadow)
      lineY += font.height
    }
  }

  private drawChatText(pixels: ImageData) {
    const x0 = 17
    const y0 = 357
    this.messages.slice(0, 5).forEach((text, line) => {
      drawString(pixels, fontPlain12, text, x0 + 4, y0 + 70 - line * 14, 0, false)
    })

    const name = formatName(this.username)
    drawString(pixels, fontPlain12, `${name}:`, x0 + 4, y0 + 90, 0, false)
    drawString(pixels, fontPlain12, `${this.chatTyped}*`, x0 + 6 + stringWidth(fontPlain12, `${name}: `), y0 + 90, 0x0000ff, false)
  }

  private drawPrivacyText(pixels: ImageData) {
    const y0 = 453
    const setting = (x: number, value: number) => {
      const [text, rgb] = ([['On', 0x00ff00], ['Friends', 0xffff00], ['Off', 0xff0000], ['Hide', 0x00ffff]] as const)[value]!
      drawStringCenter(pixels, fontPlain12, text, x, y0 + 41, rgb)
    }
    drawStringCenter(pixels, fontPlain12, 'Public chat', 55, y0 + 28, 0xffffff)
    setting(55, this.publicChatSetting)
    drawStringCenter(pixels, fontPlain12, 'Private chat', 184, y0 + 28, 0xffffff)
    setting(184, this.privateChatSetting)
    drawStringCenter(pixels, fontPlain12, 'Trade/compete', 324, y0 + 28, 0xffffff)
    setting(324, this.tradeChatSetting)
    drawStringCenter(pixels, fontPlain12, 'Report abuse', 458, y0 + 33, 0xffffff)
  }
}
