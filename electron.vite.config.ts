import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Two preload bundles: the main UI (index) and the desktop pet (pet).
        input: {
          index: resolve('src/preload/index.ts'),
          pet: resolve('src/preload/pet.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // Two renderer entries: the React app (index) and the plain-JS pet.
        input: {
          index: resolve('src/renderer/index.html'),
          pet: resolve('src/renderer/pet/index.html')
        }
      }
    }
  }
})
