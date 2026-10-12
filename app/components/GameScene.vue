<script setup lang="ts">
import { useLoop } from '@tresjs/core'
import type { TresPointerEvent } from '@tresjs/core'
import { CanvasTexture, NearestFilter, type WebGLRenderer } from 'three'
import { SCREEN_H, SCREEN_W, type GameScreen } from '~/utils/gameScreen'
import { VIEWPORT_H, VIEWPORT_W, VIEWPORT_X, VIEWPORT_Y } from '~/utils/worldView'

// Same 765x503 pixel space as TitleScene. The whole game frame is one canvas texture; it is
// only redrawn when something on it changes, like the client's redraw* flags.

const props = defineProps<{
  screen: GameScreen
}>()

const canvas = document.createElement('canvas')
canvas.width = SCREEN_W
canvas.height = SCREEN_H
const context = canvas.getContext('2d', { willReadFrequently: true })!
const texture = new CanvasTexture(canvas)
texture.magFilter = NearestFilter
texture.minFilter = NearestFilter
texture.generateMipmaps = false

// filled by the packet loop (packets 73 and 81) through screen.world
const world = props.screen.world

const { onBeforeRender } = useLoop()

onBeforeRender(({ renderer, delta }) => {
  world.render(renderer as WebGLRenderer, delta)

  if (!props.screen.redraw) return
  props.screen.redraw = false
  props.screen.draw(context)
  texture.needsUpdate = true
})

function onPointerDown(event: TresPointerEvent) {
  if (event.button !== 0) return
  props.screen.click(Math.round(event.point.x), Math.round(-event.point.y))
}

function onPointerMove(event: TresPointerEvent) {
  props.screen.hover(Math.round(event.point.x), Math.round(-event.point.y))
}

onUnmounted(() => {
  texture.dispose()
  world.dispose()
})
</script>

<template>
  <TresOrthographicCamera :args="[0, SCREEN_W, 0, -SCREEN_H, 0.1, 100]" :position="[0, 0, 10]" />

  <TresMesh
    :position="[SCREEN_W / 2, -SCREEN_H / 2, 0]"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerleave="screen.hover(-1, -1)"
  >
    <TresPlaneGeometry :args="[SCREEN_W, SCREEN_H]" />
    <TresMeshBasicMaterial :map="texture" />
  </TresMesh>

  <TresMesh :position="[VIEWPORT_X + VIEWPORT_W / 2, -(VIEWPORT_Y + VIEWPORT_H / 2), 1]">
    <TresPlaneGeometry :args="[VIEWPORT_W, VIEWPORT_H]" />
    <TresMeshBasicMaterial :map="world.target.texture" />
  </TresMesh>
</template>
