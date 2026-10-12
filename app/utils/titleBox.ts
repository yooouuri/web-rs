import { drawString, drawStringCenter } from './bitmapFont'
import { fontBold12, fontPlain11 } from './titleData'

// Port of Game.drawTitleScreen / updateTitle. The box is 360x200 and sits at (202, 171)
// on the 765x503 screen; hit tests use screen coordinates like the original.

export const BOX_X = 202
export const BOX_Y = 171
export const BOX_W = 360
export const BOX_H = 200

const SCREEN_W = 765
const SCREEN_H = 503

const VALID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!"£$%^&*()-_=+[{]};:\'@#~,<.>/?\\| '

export class TitleBox {
  state: 0 | 2 | 3 = 0
  loginField = 0
  username = ''
  password = ''
  loginMessage0 = ''
  loginMessage1 = ''
  hideButtons = false
  /** status line under the welcome text (ondemand.message in the client) */
  message = ''

  constructor(
    private readonly box: HTMLImageElement,
    private readonly button: HTMLImageElement,
    private readonly onLogin: (username: string, password: string) => void,
  ) {}

  private hit(mx: number, my: number, x: number, y: number) {
    return mx >= x - 75 && mx <= x + 75 && my >= y - 20 && my <= y + 20
  }

  click(mx: number, my: number) {
    const cx = (SCREEN_W / 2) | 0
    const cy = (SCREEN_H / 2) | 0

    if (this.state === 0) {
      const y = cy + 40
      if (this.hit(mx, my, cx - 80, y)) {
        this.state = 3
        this.loginField = 0
      }
      if (this.hit(mx, my, cx + 80, y)) {
        this.loginMessage0 = ''
        this.loginMessage1 = 'Enter your username & password.'
        this.state = 2
        this.loginField = 0
      }
    }
    else if (this.state === 2) {
      let fieldY = cy - 40 + 30 + 25
      if (my >= fieldY - 15 && my < fieldY) this.loginField = 0
      fieldY += 15
      if (my >= fieldY - 15 && my < fieldY) this.loginField = 1

      if (this.hideButtons) return
      const y = cy + 70
      if (this.hit(mx, my, cx - 80, y)) {
        this.onLogin(this.username, this.password)
      }
      if (this.hit(mx, my, cx + 80, y)) {
        this.state = 0
        this.username = ''
        this.password = ''
      }
    }
    else if (this.state === 3) {
      if (this.hit(mx, my, cx, cy + 70)) this.state = 0
    }
  }

  key(code: number) {
    if (this.state !== 2) return
    const valid = VALID_CHARS.includes(String.fromCharCode(code))
    const field = this.loginField === 0 ? 'username' : 'password'
    const max = this.loginField === 0 ? 12 : 20

    if (code === 8 && this[field].length > 0) this[field] = this[field].slice(0, -1)
    if (code === 9 || code === 10 || code === 13) this.loginField = this.loginField === 0 ? 1 : 0
    if (valid) this[field] = (this[field] + String.fromCharCode(code)).slice(0, max)
  }

  draw(ctx: CanvasRenderingContext2D, loopCycle: number) {
    const w = BOX_W
    const h = BOX_H
    const button = (x: number, y: number) => ctx.drawImage(this.button, x - 73, y - 20)

    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(this.box, 0, 0)

    const texts: [typeof fontBold12, string, number, number, number, boolean][] = []
    const center = (s: string, x: number, y: number, rgb: number, font = fontBold12) => texts.push([font, s, x, y, rgb, true])
    const left = (s: string, x: number, y: number, rgb: number) => texts.push([fontBold12, s, x, y, rgb, false])

    if (this.state === 0) {
      center(this.message, w / 2, h / 2 + 80, 0x75a9a9, fontPlain11)
      center('Welcome to RuneScape', w / 2, h / 2 - 20, 0xffff00)

      const y = h / 2 + 20
      button(w / 2 - 80, y)
      center('New User', w / 2 - 80, y + 5, 0xffffff)
      button(w / 2 + 80, y)
      center('Existing User', w / 2 + 80, y + 5, 0xffffff)
    }

    if (this.state === 2) {
      let y = h / 2 - 40
      if (this.loginMessage0.length > 0) {
        center(this.loginMessage0, w / 2, y - 15, 0xffff00)
        center(this.loginMessage1, w / 2, y, 0xffff00)
      }
      else {
        center(this.loginMessage1, w / 2, y - 7, 0xffff00)
      }
      y += 30

      const blink = loopCycle % 40 < 20
      left(`Username: ${this.username}${this.loginField === 0 && blink ? '@yel@|' : ''}`, w / 2 - 90, y, 0xffffff)
      y += 15
      left(`Password: ${'*'.repeat(this.password.length)}${this.loginField === 1 && blink ? '@yel@|' : ''}`, w / 2 - 88, y, 0xffffff)

      if (!this.hideButtons) {
        y = h / 2 + 50
        button(w / 2 - 80, y)
        center('Login', w / 2 - 80, y + 5, 0xffffff)
        button(w / 2 + 80, y)
        center('Cancel', w / 2 + 80, y + 5, 0xffffff)
      }
    }

    if (this.state === 3) {
      center('Create a free account', w / 2, h / 2 - 60, 0xffff00)
      let y = h / 2 - 35
      for (const line of [
        'To create a new account you need to',
        'go back to the main RuneScape webpage',
        'and choose the red \'create account\'',
        'button at the top right of that page.',
      ]) {
        center(line, w / 2, y, 0xffffff)
        y += 15
      }
      y = h / 2 + 50
      button(w / 2, y)
      center('Cancel', w / 2, y + 5, 0xffffff)
    }

    // the sprites are drawn with canvas, the text straight into the pixels
    const img = ctx.getImageData(0, 0, w, h)
    for (const [font, s, x, y, rgb, centered] of texts) {
      if (centered) drawStringCenter(img, font, s, x, y, rgb, true)
      else drawString(img, font, s, x, y, rgb, true)
    }
    ctx.putImageData(img, 0, 0)
  }
}
