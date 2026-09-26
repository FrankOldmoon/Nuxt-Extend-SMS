import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// `root` is pinned to this module so the include globs resolve inside the module
// regardless of the process working directory (the host test runner also picks
// these tests up through its own `modules/*/test/**` glob).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,spec}.{ts,js,mjs}'],
    testTimeout: 10000
  }
})
