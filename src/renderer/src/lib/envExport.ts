import type {
  ProjectExportEnvPayload,
  ProjectExportEnvResult,
} from '../../../shared/projectIpcContracts'

export async function exportEnvWithReplaceConfirmation(
  exporter: (payload: ProjectExportEnvPayload) => Promise<ProjectExportEnvResult>,
  payload: Omit<ProjectExportEnvPayload, 'overwriteExisting'>,
  confirmReplace: () => boolean,
): Promise<ProjectExportEnvResult> {
  const first = await exporter({ ...payload, overwriteExisting: false })
  if (!first.requiresOverwriteConfirmation) return first
  if (!confirmReplace()) return first
  return exporter({ ...payload, overwriteExisting: true })
}
