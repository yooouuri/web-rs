<script setup lang="ts">
import { useLoop } from '@tresjs/core'
import {
  CanvasTexture,
  DataTexture,
  NearestFilter,
  RGBAFormat,
  Texture,
  UnsignedByteType,
} from 'three'
import type { TresPointerEvent } from '@tresjs/core'
import { FLAME_H, FLAME_W, type Flames } from '~/utils/flames'
import { BOX_H, BOX_W, BOX_X, BOX_Y, type TitleBox } from '~/utils/titleBox'

// Everything is laid out in the client's 765x503 pixel space: the orthographic camera maps
// x 0..765 and y 0..-503 onto the canvas, so a sprite at (x, y) is a plane at (x + w/2, -(y + h/2)).

const props = defineProps<{
  background: HTMLImageElement
  flames: Flames
  box: TitleBox
}>()

const TICK_MS = 20 // the client runs the title screen and flames at 50 fps

function nearest<T extends Texture>(texture: T): T {
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

const backgroundTexture = nearest(new Texture(props.background))

const flameTexture = (data: Uint8Array) => nearest(new DataTexture(data, FLAME_W, FLAME_H, RGBAFormat, UnsignedByteType))
const leftFlameTexture = flameTexture(props.flames.left)
const rightFlameTexture = flameTexture(props.flames.right)

const boxCanvas = document.createElement('canvas')
boxCanvas.width = BOX_W
boxCanvas.height = BOX_H
const boxContext = boxCanvas.getContext('2d', { willReadFrequently: true })!
const boxTexture = nearest(new CanvasTexture(boxCanvas))

const at = (x: number, y: number, w: number, h: number, z: number) => [x + w / 2, -(y + h / 2), z] as const

let loopCycle = 0
let pending = 0

function redraw() {
  props.flames.draw()
  leftFlameTexture.needsUpdate = true
  rightFlameTexture.needsUpdate = true
  props.box.draw(boxContext, loopCycle)
  boxTexture.needsUpdate = true
}
redraw()

const { onBeforeRender } = useLoop()

onBeforeRender(({ delta }) => {
  pending = Math.min(pending + delta * 1000, TICK_MS * 5)
  if (pending < TICK_MS) return

  while (pending >= TICK_MS) {
    pending -= TICK_MS
    loopCycle++
    props.flames.update(loopCycle)
  }
  redraw()
})

function onPointerDown(event: TresPointerEvent) {
  if (event.button !== 0) return
  props.box.click(Math.round(event.point.x), Math.round(-event.point.y))
  props.box.draw(boxContext, loopCycle)
  boxTexture.needsUpdate = true
}

onUnmounted(() => {
  for (const t of [backgroundTexture, leftFlameTexture, rightFlameTexture, boxTexture]) t.dispose()
})
</script>

<template>
  <TresOrthographicCamera :args="[0, 765, 0, -503, 0.1, 100]" :position="[0, 0, 10]" />

  <TresMesh :position="at(0, 0, 765, 503, 0)" @pointerdown="onPointerDown">
    <TresPlaneGeometry :args="[765, 503]" />
    <TresMeshBasicMaterial :map="backgroundTexture" />
  </TresMesh>

  <TresMesh :position="at(0, 0, FLAME_W, FLAME_H, 1)">
    <TresPlaneGeometry :args="[FLAME_W, FLAME_H]" />
    <TresMeshBasicMaterial :map="leftFlameTexture" transparent :depth-write="false" />
  </TresMesh>

  <TresMesh :position="at(637, 0, FLAME_W, FLAME_H, 1)">
    <TresPlaneGeometry :args="[FLAME_W, FLAME_H]" />
    <TresMeshBasicMaterial :map="rightFlameTexture" transparent :depth-write="false" />
  </TresMesh>

  <TresMesh :position="at(BOX_X, BOX_Y, BOX_W, BOX_H, 2)" @pointerdown="onPointerDown">
    <TresPlaneGeometry :args="[BOX_W, BOX_H]" />
    <TresMeshBasicMaterial :map="boxTexture" transparent :depth-write="false" />
  </TresMesh>
</template>
