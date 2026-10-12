// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@tresjs/nuxt', '@vueuse/nuxt/module'],
  nitro: {
    experimental: { websocket: true },
  },
  runtimeConfig: {
    // override with NUXT_GAME_SERVER_HOST / NUXT_GAME_SERVER_PORT
    gameServer: {
      host: '127.0.0.1',
      port: 43594,
    },
  },
  app: {
    head: {
      title: 'RuneScape',
    },
  },
})
