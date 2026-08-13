import { describe, expect, it } from 'vitest'
import { MAIN_WINDOW_GEOMETRY } from './windowGeometry'

describe('main window geometry', () => {
  it('opens at the shipped size while allowing the compact workspace composition', () => {
    expect(MAIN_WINDOW_GEOMETRY).toEqual({
      width: 1200,
      height: 800,
      minWidth: 640,
      minHeight: 640,
    })
  })
})
