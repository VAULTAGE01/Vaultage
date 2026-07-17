import { describe, expect, it, vi } from 'vitest'
import { exportEnvWithReplaceConfirmation } from './envExport'

const payload = {
  projectId: 'project-1',
  environmentId: 'project-1:local',
}

describe('environment export replacement confirmation', () => {
  it('never requests overwrite when the first safe write succeeds', async () => {
    const exporter = vi.fn().mockResolvedValue({ success: true })
    const confirmReplace = vi.fn()
    await exportEnvWithReplaceConfirmation(exporter, payload, confirmReplace)
    expect(exporter).toHaveBeenCalledWith({ ...payload, overwriteExisting: false })
    expect(confirmReplace).not.toHaveBeenCalled()
  })

  it('sets overwrite only after a dedicated replacement confirmation', async () => {
    const exporter = vi.fn()
      .mockResolvedValueOnce({ success: false, requiresOverwriteConfirmation: true })
      .mockResolvedValueOnce({ success: true })
    await exportEnvWithReplaceConfirmation(exporter, payload, () => true)
    expect(exporter).toHaveBeenNthCalledWith(2, { ...payload, overwriteExisting: true })
  })

  it('leaves the file untouched when replacement is declined', async () => {
    const exporter = vi.fn().mockResolvedValue({ success: false, requiresOverwriteConfirmation: true })
    await exportEnvWithReplaceConfirmation(exporter, payload, () => false)
    expect(exporter).toHaveBeenCalledOnce()
  })
})
