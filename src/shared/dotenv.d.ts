export interface DotenvEntry {
  envKey: string
  value: string
}

export function formatDotenvValue(value: string): string
export function formatDotenvEntries(entries: DotenvEntry[], options?: { header?: string }): string
export function formatDotenv(env: Record<string, string>): string

declare const dotenv: {
  formatDotenvValue: typeof formatDotenvValue
  formatDotenvEntries: typeof formatDotenvEntries
  formatDotenv: typeof formatDotenv
}

export default dotenv
