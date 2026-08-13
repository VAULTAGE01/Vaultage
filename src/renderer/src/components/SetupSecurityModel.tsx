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
      className="ui26-onboarding-security"
    >
      <div className="ui26-onboarding-security-header">
        <h2 id="setup-security-model-title">
          How your local vault works
        </h2>
        <span className="ui26-onboarding-overline">
          Local first
        </span>
      </div>

      <ul className="ui26-onboarding-security-list">
        {securityFacts.map(({ icon: Icon, title, description }) => (
          <li key={title} className="ui26-onboarding-security-fact" data-onboarding-security-fact="true">
            <Icon aria-hidden="true" className="ui26-onboarding-security-icon" />
            <div>
              <p className="ui26-onboarding-security-title">{title}</p>
              <p className="ui26-onboarding-security-description">{description}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
