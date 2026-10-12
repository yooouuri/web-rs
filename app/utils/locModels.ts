import { type Mesh, type MeshBasicMaterial, NoColorSpace, type Object3D, type Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Finds and caches loc models, like LocType's model caches in the client: the lookup table
// (public/models/index.json, written by tools/ModelExport.java) maps a loc id to its .glb, each
// file is loaded once, and every placement gets a clone that shares geometry, materials and
// textures with the loaded original. Where locs are placed comes from public/maps (tools/MapExport.java).

export interface LocModelEntry {
  name: string
  models: number[]
  /** LocType.sizeX / sizeZ in tiles */
  size: [number, number]
  file: string
}

/** [locId, x, z, level, kind, rotation] with x and z 0..63 within the map square */
export type LocPlacement = [number, number, number, number, number, number]

/** textures the client animates in Game.updateTextures */
const ANIMATED_TEXTURES = ['texture 17', 'texture 24', 'texture 34']

export class LocModels {
  private index?: Promise<Record<string, LocModelEntry>>
  private readonly loaded = new Map<number, Promise<Object3D | undefined>>()
  private readonly loader = new GLTFLoader()
  /** animated textures of every loaded model; shared by all clones, like Draw3D.textures */
  readonly animated: Texture[] = []

  constructor(private readonly baseUrl = '/models') {}

  /** The lookup table entry for a loc, or undefined if it hasn't been exported. */
  async entry(locId: number): Promise<LocModelEntry | undefined> {
    this.index ??= $fetch<Record<string, LocModelEntry>>(`${this.baseUrl}/index.json`)
    return (await this.index)[locId]
  }

  /** Map square placements (public/maps/<mx>_<mz>.json, tools/MapExport.java), or [] if not exported. */
  async mapSquare(mx: number, mz: number): Promise<LocPlacement[]> {
    try {
      // a missing file can come back as the app's HTML page instead of a 404
      const placements = await $fetch<LocPlacement[] | string>(`/maps/${mx}_${mz}.json`)
      return Array.isArray(placements) ? placements : []
    }
    catch {
      return []
    }
  }

  /** A new instance of the loc's model, or undefined if the loc isn't in the lookup table. */
  async get(locId: number): Promise<Object3D | undefined> {
    let original = this.loaded.get(locId)
    if (!original) {
      original = this.load(locId)
      this.loaded.set(locId, original)
    }
    return (await original)?.clone()
  }

  private async load(locId: number): Promise<Object3D | undefined> {
    const entry = await this.entry(locId)
    if (!entry) return undefined

    const gltf = await this.loader.loadAsync(`${this.baseUrl}/${entry.file}`)
    gltf.scene.name = `loc ${locId} (${entry.name})`
    gltf.scene.traverse((object) => {
      const material = (object as Mesh).material as MeshBasicMaterial | undefined
      if (!material?.map) return
      // the texels are the client's final colours; GLTFLoader would treat them as sRGB and darken them
      material.map.colorSpace = NoColorSpace
      // ModelExport names textured materials "texture <id>"
      if (ANIMATED_TEXTURES.includes(material.name)) this.animated.push(material.map)
    })
    return gltf.scene
  }

  /** Game.updateTexture: the texels move down 2 rows (of 128) per 20ms cycle, 100 rows a second. */
  animate(delta: number) {
    for (const map of this.animated) map.offset.y = (map.offset.y - (delta * 100) / 128) % 1
  }
}
