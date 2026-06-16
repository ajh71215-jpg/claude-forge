import type { Forge } from './index'

declare global {
  interface Window {
    forge: Forge
  }
}
