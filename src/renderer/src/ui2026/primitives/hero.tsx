import { X } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { ActionButton } from './rows';
import type { ActionSpec, HeroFact } from './types';

export function SurfaceSectionHeader({
  id,
  title,
  icon,
  action,
}: {
  readonly id: string;
  readonly title: string;
  readonly icon?: ReactNode;
  readonly action?: ActionSpec;
}): ReactElement {
  return (
    <div className="ui26-section-heading">
      <h2 id={id}>
        {icon ? <span className="ui26-icon" aria-hidden>{icon}</span> : null}
        {title}
      </h2>
      {action ? (
        <button
          type="button"
          className="ui26-section-action"
          disabled={action.disabled}
          onClick={action.onActivate}
        >
          {action.label}
          {action.icon ? <span aria-hidden>{action.icon}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

export function SurfaceHero({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  facts = [],
  visual,
  tone = 'neutral',
  onDismiss,
  dismissLabel = 'Dismiss guidance',
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
  readonly primaryAction?: ActionSpec;
  readonly secondaryAction?: ActionSpec;
  readonly facts?: readonly HeroFact[];
  readonly visual?: ReactNode;
  readonly tone?: 'neutral' | 'guided' | 'secure';
  readonly onDismiss?: () => void;
  readonly dismissLabel?: string;
}): ReactElement {
  return (
    <section className={`ui26-hero ui26-hero-${tone}`}>
      <div>
        {eyebrow ? <p className="ui26-overline">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="ui26-actions">
          {primaryAction ? <ActionButton action={primaryAction} /> : null}
          {secondaryAction ? (
            <ActionButton action={secondaryAction} secondary />
          ) : null}
        </div>
      </div>
      {facts.length > 0 ? (
        <dl className="ui26-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {visual ? (
        <div className="ui26-hero-visual" aria-hidden>
          {visual}
        </div>
      ) : null}
      {onDismiss ? (
        <button
          className="ui26-hero-dismiss"
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X size={16} aria-hidden />
        </button>
      ) : null}
    </section>
  );
}

export function MetricTile({
  label,
  value,
  detail,
  icon,
  tone = 'neutral',
  onActivate,
  loading = false,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: string;
  readonly icon: ReactNode;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  readonly onActivate?: () => void;
  readonly loading?: boolean;
}): ReactElement {
  const content = (
    <>
      <span className="ui26-icon">{icon}</span>
      {loading ? (
        <span className="ui26-skeleton" aria-label={`${label} loading`} />
      ) : (
        <strong>{value}</strong>
      )}
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
    </>
  );
  return onActivate ? (
    <button
      type="button"
      className={`ui26-metric ui26-metric-${tone}`}
      onClick={onActivate}
    >
      {content}
    </button>
  ) : (
    <div className={`ui26-metric ui26-metric-${tone}`}>{content}</div>
  );
}
