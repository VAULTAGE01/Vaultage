import { CalendarClock, CircleAlert, CircleCheck } from 'lucide-react'
import type { CertificateMetadata, CertificateExpiryProjection } from '../../../shared/certificateMetadata'
import { CertificateProjectionError, projectCertificateExpiry } from '../../../shared/certificateMetadata'

type CertificateExpiryPresentation = {
  readonly className: string
  readonly detail: string
  readonly label: string
}

function expiryPresentation(projection: CertificateExpiryProjection): CertificateExpiryPresentation {
  switch (projection.status) {
    case 'valid':
      return {
        className: 'border-success/20 bg-success/[0.08] text-success',
        detail: `Valid for ${projection.remainingDays} more days.`,
        label: 'Certificate valid',
      }
    case 'expiring':
      return {
        className: 'border-warning/25 bg-warning/[0.08] text-warning',
        detail: 'Review or rotate this certificate before it expires.',
        label: `Expires in ${projection.remainingDays} days`,
      }
    case 'expired':
      return {
        className: 'border-danger/25 bg-danger/10 text-danger',
        detail: 'Replace or revoke this certificate before using it again.',
        label: 'Certificate expired',
      }
    case 'not-yet-valid':
      return {
        className: 'border-info/25 bg-info/10 text-info',
        detail: 'This certificate is not valid yet.',
        label: 'Certificate not active',
      }
  }
}

export function CertificateExpiryStatusCard({
  certificate,
  nowMs = Date.now(),
}: {
  readonly certificate: CertificateMetadata | undefined
  readonly nowMs?: number
}) {
  if (!certificate?.notBefore || !certificate.notAfter) return null

  let projection: CertificateExpiryProjection
  try {
    projection = projectCertificateExpiry(certificate, nowMs)
  } catch (error) {
    if (error instanceof CertificateProjectionError) return null
    throw error
  }
  const presentation = expiryPresentation(projection)
  const Icon = projection.status === 'valid' ? CircleCheck : CircleAlert

  return (
    <section
      aria-live="polite"
      className={`rounded-2xl border px-4 py-3 ${presentation.className}`}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-semibold">{presentation.label}</p>
          <p className="mt-1 text-[11px] leading-relaxed opacity-90">{presentation.detail}</p>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] opacity-75">
            <CalendarClock className="h-3 w-3" aria-hidden="true" />
            Valid until {new Date(projection.expiresAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </section>
  )
}
