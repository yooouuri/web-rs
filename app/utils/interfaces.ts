// Sidebar interfaces, exported from the cache with tools/InterfaceExport.java. Positions are
// relative to the parent (child x/y plus the component's own x/y), like drawParentInterface
// adds them up. Only the components the game screen draws so far are here.

export interface IfText {
  id: number
  type: 'text'
  x: number
  y: number
  width: number
  height: number
  text: string
  font: 'p12' | 'b12'
  color: number
  /** 0 = no hover colour */
  hoverColor: number
  shadow: boolean
  center: boolean
  /** IfType.OPTION_TYPE_*: 1 = standard button (menu option `option`) */
  optionType: number
  option?: string
}

export interface IfImage {
  id: number
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  /** /game/<image>.png, exported at full size with the crop offsets applied */
  image: string
}

export type IfComponent = IfText | IfImage

export const INTERFACES: Record<number, IfComponent[]> = {
  // logout tab
  2449: [
    { id: 2450, type: 'text', x: 7, y: 55, width: 179, height: 14, text: 'When you have finished playing', font: 'p12', color: 0xffff00, hoverColor: 0, shadow: true, center: false, optionType: 0 },
    { id: 2451, type: 'text', x: 20, y: 73, width: 152, height: 14, text: 'RuneScape, always use the', font: 'p12', color: 0xffff00, hoverColor: 0, shadow: true, center: false, optionType: 0 },
    { id: 2452, type: 'text', x: 10, y: 91, width: 169, height: 14, text: 'button below to logout safely.', font: 'p12', color: 0xffff00, hoverColor: 0, shadow: true, center: false, optionType: 0 },
    { id: 2453, type: 'image', x: 74, y: 153, width: 36, height: 36, image: 'if_2453' },
    { id: 2454, type: 'image', x: 48, y: 153, width: 36, height: 36, image: 'if_2454' },
    { id: 2455, type: 'image', x: 22, y: 153, width: 36, height: 36, image: 'if_2455' },
    { id: 2456, type: 'image', x: 104, y: 153, width: 36, height: 36, image: 'if_2456' },
    { id: 2457, type: 'image', x: 130, y: 153, width: 36, height: 36, image: 'if_2457' },
    // contentType 205: the client also sets idleTimeout so a dropped connection logs out instead of reconnecting
    { id: 2458, type: 'text', x: 30, y: 163, width: 128, height: 14, text: 'Click here to logout', font: 'b12', color: 0xffffff, hoverColor: 0xff0000, shadow: true, center: false, optionType: 1, option: 'Ok' },
  ],
}
