import type { ReactElement } from 'react'
import { SurfaceHero } from '../ui2026/primitives/hero'
import '../ui2026/ui2026.css'

const PROJECTS_HERO_ART = new URL(
  '../ui2026/assets/projects-hero.png',
  import.meta.url,
).href

export function CommunityProjectsGuidanceHero({
  onDismiss,
}: {
  readonly onDismiss: () => void
}): ReactElement {
  return (
    <div className="projects-guidance-hero">
      <SurfaceHero
        title="Turn a local folder into a reviewed .env export"
        description="Scan a folder, map saved Vault fields to environment keys, and confirm the plaintext export only when you are ready."
        facts={[
          { label: 'Scan a local folder', value: 'Find environment keys without uploading project data.' },
          { label: 'Map Vault fields', value: 'Choose the exact saved field for each key.' },
          { label: 'Confirm every export', value: 'Review the destination before writing plaintext.' },
        ]}
        tone="guided"
        onDismiss={onDismiss}
        dismissLabel="Dismiss project guidance"
        visual={<img className="projects-guidance-hero-art" src={PROJECTS_HERO_ART} alt="" />}
      />
    </div>
  )
}
