import { type Mesh, type MeshBasicMaterial, NoColorSpace, type Object3D, type Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Finds and caches loc models, like LocType's model caches in the client: the lookup table
// (public/models/index.json, written by tools/ModelExport.java) maps a loc id to the .glb of each
// model variant it is placed with, each file is loaded once, and every placement gets a clone that
// shares geometry, materials and textures with the loaded original. Where locs are placed comes
// from public/maps (tools/MapExport.java).

export interface LocModelEntry {
  name: string
  /** LocType.sizeX / sizeZ in tiles */
  size: [number, number]
  /** LocType.adjustToTerrain: the model is bent to the slope of the tile it is placed on */
  adjustToTerrain: boolean
  /**
   * "<modelKind>_<variant>" -> file: the model LocType.getModel(modelKind, variant) builds,
   * rotated (variant 0..3) or mirrored and rotated (4..7) and lit like the client does
   */
  models: Record<string, string>
}

/** [locId, x, z, level, kind, rotation] with x and z 0..63 within the map square */
export type LocPlacement = [number, number, number, number, number, number]

/** textures the client animates in Game.updateTextures */
const ANIMATED_TEXTURES = ['texture 17', 'texture 24', 'texture 34']

export class LocModels {
  private index?: Promise<Record<string, LocModelEntry>>
  private readonly loaded = new Map<string, Promise<Object3D | undefined>>()
  private readonly loader = new GLTFLoader()
  /** one texture per texture id for all models, like Draw3D.textures; ModelExport names the materials "texture <id>" */
  private readonly textures = new Map<string, Texture>()
  /** the animated ones of those */
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

  /** A new instance of a model variant of the loc, or undefined if it isn't in the lookup table. */
  async get(locId: number, modelKind: number, variant: number): Promise<Object3D | undefined> {
    const file = (await this.entry(locId))?.models[`${modelKind}_${variant}`]
    if (!file) return undefined
    let original = this.loaded.get(file)
    if (!original) {
      original = this.load(file)
      this.loaded.set(file, original)
    }
    return (await original)?.clone()
  }

  private async load(file: string): Promise<Object3D | undefined> {
    const gltf = await this.loader.loadAsync(`${this.baseUrl}/${file}`)
    gltf.scene.name = `loc ${file}`
    gltf.scene.traverse((object) => {
      const material = (object as Mesh).material as MeshBasicMaterial | undefined
      if (!material?.map) return
      const shared = this.textures.get(material.name)
      if (shared) {
        material.map.dispose()
        material.map = shared
        return
      }
      // the texels are the client's final colours; GLTFLoader would treat them as sRGB and darken them
      material.map.colorSpace = NoColorSpace
      this.textures.set(material.name, material.map)
      if (ANIMATED_TEXTURES.includes(material.name)) this.animated.push(material.map)
    })
    return gltf.scene
  }

  /** Game.updateTexture: the texels move down 2 rows (of 128) per 20ms cycle, 100 rows a second. */
  animate(delta: number) {
    for (const map of this.animated) map.offset.y = (map.offset.y - (delta * 100) / 128) % 1
  }
}
