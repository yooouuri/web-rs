import type { Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Finds and caches player models, like PlayerEntity.modelCache in the client: a look is exported
// as a whole by tools/ModelExport.java in player mode, so the kits, worn equipment and colours are
// merged and lit exactly like the client does. The file name is built from the look:
// public/models/players/<gender>_<12 slots>_<5 colours>.glb.
//
// The model is the base pose. Its geometry has a _label attribute (Model.vertexLabel), the vertex
// groups a SeqTransform frame moves, so animations can be applied to it later.

/** The appearance block of packet 81 (PlayerEntity.read) without the animations and name. */
export interface Appearance {
  gender: number
  /** 12 slots: 0 = empty, 256 + an identikit id, 512 + an obj id for worn equipment */
  appearances: number[]
  /** 5 indices, colors[i] into Game.designPartColor[i] */
  colors: number[]
}

/** RuneSource's default look; used until packet 81's appearance block is read. */
export const DEFAULT_APPEARANCE: Appearance = {
  gender: 0,
  appearances: [0, 0, 0, 0, 256 + 18, 0, 256 + 26, 256 + 36, 256 + 0, 256 + 33, 256 + 42, 256 + 10],
  colors: [7, 8, 9, 5, 0],
}

/** The model's name, the same as ModelExport.exportPlayer writes. */
export function appearanceKey({ gender, appearances, colors }: Appearance) {
  return `${gender}_${appearances.join('-')}_${colors.join('-')}`
}

export class PlayerModels {
  private readonly loaded = new Map<string, Promise<Object3D | undefined>>()
  private readonly loader = new GLTFLoader()

  constructor(private readonly baseUrl = '/models/players') {}

  /** A new instance of the look's model, or undefined if that look hasn't been exported. */
  async get(appearance: Appearance): Promise<Object3D | undefined> {
    const key = appearanceKey(appearance)
    let original = this.loaded.get(key)
    if (!original) {
      original = this.load(key)
      this.loaded.set(key, original)
    }
    return (await original)?.clone()
  }

  private async load(key: string): Promise<Object3D | undefined> {
    try {
      const gltf = await this.loader.loadAsync(`${this.baseUrl}/${key}.glb`)
      gltf.scene.name = `player ${key}`
      return gltf.scene
    }
    catch {
      // not exported (a missing file comes back as the app's HTML page, which fails to parse)
      return undefined
    }
  }
}
