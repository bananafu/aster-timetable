import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/aster-timetable/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, 'tests/browser/**'],
  },
})
