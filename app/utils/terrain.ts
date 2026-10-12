import { type Mesh, type MeshBasicMaterial, NoColorSpace, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Loads the ground of map squares, exported by tools/ModelExport.java in terrain mode:
// - public/terrain/<mx>_<mz>.json: the levels that have tiles and SceneBuilder.levelHeightmap
// - public/terrain/<mx>_<mz>_<level>.glb: the underlays and overlays of one level
// A square's models have their origin at its south-west corner, 1 unit per tile, north is -z.

/** Tile corners per side of a map square in the heightmap */
export const SQUARE_CORNERS = 65

export interface TerrainSquare {
  /** levels with an exported model */
  levels: number[]
  /** per level 65x65 corner heights in client units (negative is up), index z * 65 + x */
  heights: number[][]
}

export class Terrain {
  private readonly loader = new GLTFLoader()

  constructor(private readonly baseUrl = '/terrain') {}

  /** The square's levels and heightmap, or undefined if it hasn't been exported. */
  async square(mx: number, mz: number): Promise<TerrainSquare | undefined> {
    try {
      // a missing file can come back as the app's HTML page instead of a 404
      const square = await $fetch<TerrainSquare | string>(`${this.baseUrl}/${mx}_${mz}.json`)
      return typeof square === 'object' && Array.isArray(square.levels) ? square : undefined
    }
    catch {
      return undefined
    }
  }

  /** The ground model of one level of a square; not cached, each square is only in the scene once. */
  async model(mx: number, mz: number, level: number): Promise<Object3D> {
    const gltf = await this.loader.loadAsync(`${this.baseUrl}/${mx}_${mz}_${level}.glb`)
    gltf.scene.name = `terrain ${mx}_${mz} level ${level}`
    gltf.scene.traverse((object) => {
      const material = (object as Mesh).material as MeshBasicMaterial | undefined
      // the texels are the client's final colours; GLTFLoader would treat them as sRGB and darken them
      if (material?.map) material.map.colorSpace = NoColorSpace
    })
    return gltf.scene
  }
}
