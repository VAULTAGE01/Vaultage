import { describe, expect, it } from 'vitest'
import { MAIN_WINDOW_GEOMETRY } from './windowGeometry'

describe('main window geometry', () => {
  it('opens at the shipped size and does not resize below that composition', () => {
    expect(MAIN_WINDOW_GEOMETRY).toEqual({
      width: 1200,
      height: 800,
      minWidth: 1200,
      minHeight: 800,
    })
  })
})
