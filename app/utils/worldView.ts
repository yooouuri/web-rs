import { Color, DataTexture, Group, type Material, type Mesh, type MeshBasicMaterial, NearestFilter, type Object3D, PerspectiveCamera, RedFormat, Scene, WebGLRenderTarget, type WebGLRenderer } from 'three'
import { LocModels } from './locModels'
import { type Appearance, DEFAULT_APPEARANCE, PlayerModels } from './playerModels'
import { COS, DRAW_RADIUS, SIN, visibilityMap } from './sceneVisibility'
import { SQUARE_CORNERS, Terrain } from './terrain'

// The 3D game view (areaViewport, 512x334 at (4, 4)). It is rendered into its own render target,
// which GameScene shows over the black viewport.
//
// Like the client, the scene is the 104x104 tiles around the zone from packet 73, and the camera
// orbits the local player from packet 81. The ground comes from public/terrain and only locs with an
// exported model (public/models/index.json) are drawn. The local player is drawn in its base pose
// with the look from public/models/players (RuneSource's default until packet 81's appearance is read).
// Levels above the player's are hidden, like the client does indoors (roofs are not checked yet).
// Like Scene.draw, only the tiles near the camera that sceneVisibility marks visible are drawn: the
// ground is cut per tile in its shader and a loc is shown when one of its tiles is visible.
// The camera works in client units (128 per tile, y down) so it follows the client's integer maths.
//
// Units: 1 = 1 tile (128 client units), x is east and -z is north, both in scene tiles (0..103).

export const VIEWPORT_X = 4
export const VIEWPORT_Y = 4
export const VIEWPORT_W = 512
export const VIEWPORT_H = 334

const SCENE_SIZE = 104
/** tile corners per side of the scene heightmap (SceneBuilder.levelHeightmap is 4 x 105 x 105) */
const SCENE_CORNERS = SCENE_SIZE + 1

/** orbitCameraPitch at login; 2048 is a full turn */
const ORBIT_PITCH = 128
/** Game.updateOrbitCamera runs once per 20 ms client cycle */
const CYCLE = 0.02

export class WorldView {
  readonly target = new WebGLRenderTarget(VIEWPORT_W, VIEWPORT_H, {
    magFilter: NearestFilter,
    minFilter: NearestFilter,
  })

  private readonly scene = new Scene()
  private readonly ground = new Group()
  private readonly locs = new Group()
  /** levelHeightmap: per level the tile corner heights in client units (negative is up), index z * 105 + x */
  private heightmap = WorldView.emptyHeightmap()
  // Draw3D projects with a focal length of 512 px, so the vertical field of view is 2 * atan(167 / 512)
  private readonly camera = new PerspectiveCamera((2 * Math.atan(VIEWPORT_H / 2 / 512) * 180) / Math.PI, VIEWPORT_W / VIEWPORT_H, 0.1, 200)
  /** sceneCenterZoneX/Z; changes when a new region is loaded */
  private region?: { zoneX: number, zoneZ: number }
  /** local player tile in the scene (localPlayer.pathTileX/Z[0]) */
  private player?: { x: number, z: number, level: number }
  private appearance?: Appearance
  /** the local player's model, replaced when the appearance changes */
  private playerModel?: Object3D
  /** orbitCameraX/Z: the camera target, which follows the player, in client units */
  private orbit = { x: 0, z: 0 }
  /** cameraPitchClamp: raises the pitch when the ground around the camera target is higher */
  private pitchClamp = 0
  private cycleTime = 0
  /** tiles Scene.draw would draw, per level 104x104 at index (level * 104 + z) * 104 + x, as 0 or 255 */
  private readonly tileMask = new Uint8Array(4 * SCENE_SIZE * SCENE_SIZE)
  private readonly tileMaskTexture = new DataTexture(this.tileMask, SCENE_SIZE, 4 * SCENE_SIZE, RedFormat)

  constructor(
    private readonly models = new LocModels(),
    private readonly terrain = new Terrain(),
    private readonly playerModels = new PlayerModels(),
  ) {
    this.scene.background = new Color(0x000000)
    this.scene.add(this.ground, this.locs)
  }

  private static emptyHeightmap() {
    return Array.from({ length: 4 }, () => new Int32Array(SCENE_CORNERS * SCENE_CORNERS))
  }

  /** sceneBaseTileX/Z: the world tile at scene (0, 0) */
  get sceneBase() {
    return this.region ? { x: (this.region.zoneX - 6) * 8, z: (this.region.zoneZ - 6) * 8 } : undefined
  }

  /**
   * Game.readRebuildRegion + buildScene: loads the ground and the loc files of the map squares that
   * overlap the 104x104 scene and places every loc that has an exported model.
   */
  async setRegion(zoneX: number, zoneZ: number) {
    if (this.region?.zoneX === zoneX && this.region.zoneZ === zoneZ) return
    const region = this.region = { zoneX, zoneZ }
    this.locs.clear()
    for (const model of this.ground.children) disposeModel(model)
    this.ground.clear()
    this.heightmap = WorldView.emptyHeightmap()
    const base = this.sceneBase!

    // the map squares (64x64 tiles = 8x8 zones) the scene overlaps, like Game.readRebuildRegion
    const squares: [number, number][] = []
    for (let mx = Math.floor((zoneX - 6) / 8); mx <= Math.floor((zoneX + 6) / 8); mx++) {
      for (let mz = Math.floor((zoneZ - 6) / 8); mz <= Math.floor((zoneZ + 6) / 8); mz++) squares.push([mx, mz])
    }

    // the ground first, the locs are placed on its heightmap
    await Promise.all(squares.map(([mx, mz]) => this.addTerrain(mx, mz)))
    if (this.region !== region) return

    const placed: Promise<void>[] = []
    for (const [mx, mz] of squares) {
      for (const [locId, lx, lz, level, kind, rotation] of await this.models.mapSquare(mx, mz)) {
        const x = mx * 64 + lx - base.x
        const z = mz * 64 + lz - base.z
        // SceneBuilder.readLocs skips the scene's outer edge
        if (x <= 0 || z <= 0 || x >= SCENE_SIZE - 1 || z >= SCENE_SIZE - 1) continue
        // only centrepieces (10, and 11 = turned 45 degrees) for now; walls and decoration use other model kinds
        if (kind !== 10 && kind !== 11) continue
        placed.push(this.addLoc(locId, x, z, level, rotation, kind === 11))
      }
    }
    await Promise.all(placed)
  }

  /**
   * SceneBuilder.readTiles for one map square: copies its part of the heightmap into the scene's
   * and adds the ground model of each of its levels, placed at the square's south-west corner.
   */
  private async addTerrain(mx: number, mz: number) {
    const region = this.region
    const base = this.sceneBase!
    const square = await this.terrain.square(mx, mz)
    if (!square || this.region !== region) return

    const originX = mx * 64 - base.x
    const originZ = mz * 64 - base.z
    for (let level = 0; level < 4; level++) {
      const heights = square.heights[level]!
      for (let z = 0; z < SQUARE_CORNERS; z++) {
        for (let x = 0; x < SQUARE_CORNERS; x++) {
          const sx = originX + x
          const sz = originZ + z
          if (sx < 0 || sz < 0 || sx >= SCENE_CORNERS || sz >= SCENE_CORNERS) continue
          this.heightmap[level]![sz * SCENE_CORNERS + sx] = heights[z * SQUARE_CORNERS + x]!
        }
      }
    }

    await Promise.all(square.levels.map(async (level) => {
      const model = await this.terrain.model(mx, mz, level)
      if (this.region !== region) return disposeModel(model)
      model.position.set(originX, 0, -originZ)
      model.userData.level = level
      // levels above the player's are left out of tileMask, so the ground is always visible
      model.traverse(object => (object as Mesh).isMesh && this.clipToVisibleTiles((object as Mesh).material as Material, level))
      this.ground.add(model)
    }))
  }

  /**
   * Discards the fragments of ground tiles Scene.draw wouldn't draw: the tile comes from the world
   * position (x east, -z north, 1 per tile) and is looked up in tileMask.
   */
  private clipToVisibleTiles(material: Material, level: number) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.tileMask = { value: this.tileMaskTexture }
      shader.uniforms.tileLevel = { value: level }
      shader.vertexShader = 'varying vec3 vTileWorld;\n' + shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\nvTileWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = 'varying vec3 vTileWorld;\nuniform sampler2D tileMask;\nuniform float tileLevel;\n'
        + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          vec2 tile = floor(vec2(vTileWorld.x, -vTileWorld.z));
          if (any(lessThan(tile, vec2(0.0))) || any(greaterThan(tile, vec2(${SCENE_SIZE - 1}.0)))) discard;
          if (texture2D(tileMask, (tile + vec2(0.5, 0.5 + tileLevel * ${SCENE_SIZE}.0)) / vec2(${SCENE_SIZE}.0, ${4 * SCENE_SIZE}.0)).r < 0.5) discard;`)
    }
  }

  /** Game.getHeightmapY: the ground height at a scene position in client units, between the tile corners. */
  private heightmapY(level: number, sceneX: number, sceneZ: number) {
    const tileX = sceneX >> 7
    const tileZ = sceneZ >> 7
    if (tileX < 0 || tileZ < 0 || tileX > SCENE_SIZE - 1 || tileZ > SCENE_SIZE - 1) return 0
    const heights = this.heightmap[level]!
    const corner = (cx: number, cz: number) => heights[cz * SCENE_CORNERS + cx]!
    const fx = sceneX & 0x7f
    const fz = sceneZ & 0x7f
    const south = (corner(tileX, tileZ) * (128 - fx) + corner(tileX + 1, tileZ) * fx) >> 7
    const north = (corner(tileX, tileZ + 1) * (128 - fx) + corner(tileX + 1, tileZ + 1) * fx) >> 7
    return (south * (128 - fz) + north * fz) >> 7
  }

  /** localPlayer.x/z: the centre of the player's tile in client units */
  private get playerPosition() {
    return this.player && { x: this.player.x * 128 + 64, z: this.player.z * 128 + 64 }
  }

  /** Scene.draw draws the levels up to the top level, which is the player's level when the roofs are hidden. */
  private levelVisible(level: number) {
    return !this.player || level <= this.player.level
  }

  /**
   * The local player's look (the appearance block of packet 81). The model is swapped when the look
   * is exported (tools/ModelExport.java player); otherwise the current one stays.
   */
  async setAppearance(appearance: Appearance) {
    this.appearance = appearance
    const model = await this.playerModels.get(appearance)
    if (!model || this.appearance !== appearance) return
    if (this.playerModel) this.scene.remove(this.playerModel)
    this.playerModel = model
    this.scene.add(model)
  }

  /** Packet 81 placement or steps for the local player. */
  setPlayer(x: number, z: number, level: number) {
    if (!this.appearance) void this.setAppearance(DEFAULT_APPEARANCE)
    this.player = { x, z, level }
  }

  movePlayer(dx: number, dz: number) {
    if (this.player) this.setPlayer(this.player.x + dx, this.player.z + dz, this.player.level)
  }

  /**
   * SceneBuilder.addLoc + Scene.add for a centrepiece: the model is centred on the tiles it covers
   * (sizes swap when turned a quarter) and rotated by rotateY90 per rotation step.
   */
  private async addLoc(locId: number, x: number, z: number, level: number, rotation: number, diagonal: boolean) {
    const region = this.region
    const entry = await this.models.entry(locId)
    if (!entry) return
    const model = await this.models.get(locId)
    // skip it if the model isn't exported, or a new region was loaded meanwhile
    if (!model || this.region !== region) return

    const [sizeX, sizeZ] = entry.size
    const width = rotation === 1 || rotation === 3 ? sizeZ : sizeX
    const length = rotation === 1 || rotation === 3 ? sizeX : sizeZ
    // SceneBuilder.addLoc: the average height of the corners of the loc's south-west tile
    const heights = this.heightmap[level]!
    const corner = (cx: number, cz: number) => heights[cz * SCENE_CORNERS + cx]!
    const y = (corner(x, z) + corner(x + 1, z) + corner(x + 1, z + 1) + corner(x, z + 1)) >> 2
    model.position.set(x + width / 2, -y / 128, -(z + length / 2))
    // rotateY90 maps (x, z) to (z, -x); with north being -z that is -90 degrees around y
    model.rotation.y = -rotation * (Math.PI / 2) - (diagonal ? Math.PI / 4 : 0)
    model.userData.level = level
    model.userData.tiles = { x, z, width, length }
    model.visible = false
    this.locs.add(model)
  }

  /**
   * Like Game.addPlayers: the player stands on the centre of its tile at the ground height there
   * (getHeightmapY), facing south (yaw 0) as there are no turns yet.
   */
  private updatePlayer() {
    const position = this.playerPosition
    if (!position || !this.playerModel) return
    this.playerModel.position.set(position.x / 128, -this.heightmapY(this.player!.level, position.x, position.z) / 128, -position.z / 128)
  }

  /**
   * Game.updateOrbitCamera, once per client cycle (without the arrow keys): the camera target moves
   * 1/16 of the way to the player, and the pitch clamp eases towards the highest ground within 4
   * tiles of the target, so the camera looks down more steeply next to hills.
   */
  private cycle() {
    const position = this.playerPosition
    if (!position) return
    const orbit = this.orbit
    if (Math.abs(orbit.x - position.x) > 500 || Math.abs(orbit.z - position.z) > 500) {
      orbit.x = position.x
      orbit.z = position.z
    }
    orbit.x += Math.trunc((position.x - orbit.x) / 16)
    orbit.z += Math.trunc((position.z - orbit.z) / 16)

    const level = this.player!.level
    const tileX = orbit.x >> 7
    const tileZ = orbit.z >> 7
    const orbitY = this.heightmapY(level, orbit.x, orbit.z)
    let maxY = 0
    if (tileX > 3 && tileZ > 3 && tileX < 100 && tileZ < 100) {
      const heights = this.heightmap[level]!
      for (let x = tileX - 4; x <= tileX + 4; x++) {
        for (let z = tileZ - 4; z <= tileZ + 4; z++) maxY = Math.max(maxY, orbitY - heights[z * SCENE_CORNERS + x]!)
      }
    }
    const clamp = Math.min(Math.max(maxY * 192, 32768), 98048)
    if (clamp > this.pitchClamp) this.pitchClamp += Math.trunc((clamp - this.pitchClamp) / 24)
    else if (clamp < this.pitchClamp) this.pitchClamp += Math.trunc((clamp - this.pitchClamp) / 80)
  }

  /**
   * Game.drawScene + orbitCamera: the camera is 600 + pitch * 3 units from a point 50 units above the
   * ground under the player, at the orbit target's x and z. Returns the eye in client units.
   */
  private updateCamera() {
    const position = this.playerPosition
    if (!position) return
    const pitch = Math.max(ORBIT_PITCH, Math.trunc(this.pitchClamp / 256))
    const targetY = this.heightmapY(this.player!.level, position.x, position.z) - 50
    const distance = 600 + pitch * 3
    // (0, 0, distance) turned by the inverse pitch; with yaw 0 the camera is south of the target, looking north
    const invPitch = (2048 - pitch) & 0x7ff
    const offsetY = (-distance * SIN[invPitch]!) >> 16
    const offsetZ = (distance * COS[invPitch]!) >> 16
    const eye = { x: this.orbit.x, y: targetY - offsetY, z: this.orbit.z - offsetZ, pitch, yaw: 0 }
    this.camera.position.set(eye.x / 128, -eye.y / 128, -eye.z / 128)
    this.camera.lookAt(this.orbit.x / 128, -targetY / 128, -this.orbit.z / 128)
    return eye
  }

  /**
   * Scene.draw's tile selection: the tiles within 25 of the camera's tile that the visibility map for
   * its pitch and yaw marks, or whose ground is 2000 units below the camera; levels above the
   * player's are skipped. Locs are shown when one of the tiles they cover is drawn.
   */
  private updateVisibility(eye: { x: number, y: number, z: number, pitch: number, yaw: number }) {
    const map = visibilityMap(eye.pitch, eye.yaw)
    const eyeTileX = Math.min(Math.max(eye.x, 0), SCENE_SIZE * 128 - 1) >> 7
    const eyeTileZ = Math.min(Math.max(eye.z, 0), SCENE_SIZE * 128 - 1) >> 7
    this.tileMask.fill(0)
    for (let level = 0; level < 4; level++) {
      if (!this.levelVisible(level)) continue
      const heights = this.heightmap[level]!
      for (let x = Math.max(eyeTileX - DRAW_RADIUS, 0); x < Math.min(eyeTileX + DRAW_RADIUS, SCENE_SIZE); x++) {
        for (let z = Math.max(eyeTileZ - DRAW_RADIUS, 0); z < Math.min(eyeTileZ + DRAW_RADIUS, SCENE_SIZE); z++) {
          const visible = map[(x - eyeTileX + DRAW_RADIUS) * DRAW_RADIUS * 2 + z - eyeTileZ + DRAW_RADIUS]
            || heights[z * SCENE_CORNERS + x]! - eye.y >= 2000
          if (visible) this.tileMask[(level * SCENE_SIZE + z) * SCENE_SIZE + x] = 255
        }
      }
    }
    this.tileMaskTexture.needsUpdate = true

    for (const loc of this.locs.children) {
      const { x, z, width, length } = loc.userData.tiles
      const level = loc.userData.level
      loc.visible = false
      for (let tx = x; tx < x + width && !loc.visible; tx++) {
        for (let tz = z; tz < z + length && !loc.visible; tz++) {
          loc.visible = tx < SCENE_SIZE && tz < SCENE_SIZE && this.tileMask[(level * SCENE_SIZE + tz) * SCENE_SIZE + tx] === 255
        }
      }
    }
  }

  render(renderer: WebGLRenderer, delta: number) {
    this.models.animate(delta)
    // at most a second of cycles, so it doesn't catch up for long after the tab was in the background
    for (this.cycleTime = Math.min(this.cycleTime + delta, 50 * CYCLE); this.cycleTime >= CYCLE; this.cycleTime -= CYCLE) this.cycle()
    this.updatePlayer()
    const eye = this.updateCamera()
    if (eye) this.updateVisibility(eye)

    const previous = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(previous)
  }

  dispose() {
    this.target.dispose()
    this.tileMaskTexture.dispose()
  }
}

/** Frees a ground model's GPU resources; unlike loc models they aren't shared with a cache. */
function disposeModel(model: Object3D) {
  model.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const material = mesh.material as MeshBasicMaterial
    material.map?.dispose()
    material.dispose()
  })
}
