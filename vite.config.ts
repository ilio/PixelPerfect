import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), 'VITE_')

  return {
    base: '/PixelPerfect/',
    plugins: [react()]
  }
})
