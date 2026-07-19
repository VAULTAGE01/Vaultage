import { defineConfig, mergeConfig } from 'vitest/config'
import baseConfig from './vitest.config'

export default mergeConfig(baseConfig, defineConfig({
  test: {
    fileParallelism: false,
    include: ['src/main/*.e2e.ts'],
  },
}))
