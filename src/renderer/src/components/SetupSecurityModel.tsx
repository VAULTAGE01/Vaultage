import { HardDrive, KeyRound, UserRound } from 'lucide-react'

const securityFacts = [
  {
    icon: HardDrive,
    title: 'Local encryption',
    description: 'A random vault key encrypts your vault on this Mac.',
  },
  {
    icon: KeyRound,
    title: 'Password protection',
    description: 'Your master password derives a separate key that unlocks the vault key.',
  },
  {
    icon: UserRound,
    title: 'No password reset',
    description: 'Vaultage cannot recover or reset your master password.',
  },
] as const

export function SetupSecurityModel() {
  return (
    <section
      aria-labelledby="setup-security-model-title"
      className="liquid-card mb-3 rounded-2xl border border-border bg-surface/60 px-4 py-3"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="setup-security-model-title" className="text-xs font-semibold text-text">
          How your local vault works
        </h2>
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-accent">
          Local first
        </span>
      </div>

      <ul className="grid gap-2 min-[480px]:grid-cols-3">
        {securityFacts.map(({ icon: Icon, title, description }) => (
          <li key={title} className="flex min-w-0 gap-2">
            <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-none text-info" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium leading-4 text-text">{title}</p>
              <p className="text-[10px] leading-[1.35] text-text-secondary">{description}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
