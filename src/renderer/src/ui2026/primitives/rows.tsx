import { LockKeyhole } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type {
  ActionSpec,
  EmptyStateSpec,
  Environment,
  PanelItem,
  StatusKind,
} from './types.open';

const ENVIRONMENT_LABELS = {
  local: { compact: 'Local', full: 'Local' },
  development: { compact: 'Dev', full: 'Development' },
  staging: { compact: 'Stg', full: 'Staging' },
  production: { compact: 'Prod', full: 'Production' },
} as const;

export function Panel<T>({
  title,
  count,
  items,
  renderItem,
  empty,
  action,
  tone = 'neutral',
  variant = 'activity',
}: {
  readonly title: string;
  readonly count?: number;
  readonly items: readonly PanelItem<T>[];
  readonly renderItem: (item: T) => ReactNode;
  readonly empty: EmptyStateSpec;
  readonly action?: ActionSpec;
  readonly tone?: 'neutral' | 'warning';
  readonly variant?:
    | 'reminders'
    | 'issues'
    | 'activity'
    | 'collections'
    | 'connections';
}): ReactElement {
  return (
    <section
      className={`ui26-panel ui26-panel-${tone}`}
      data-ui26-panel={variant}
    >
      <header>
        <h2>{title}</h2>
        {typeof count === 'number' ? (
          <CountChip value={count} label={title} />
        ) : null}
      </header>
      {items.length > 0 ? (
        <div>
          {items.map(({ id, item }) => (
            <div key={id}>{renderItem(item)}</div>
          ))}
        </div>
      ) : (
        <div className="ui26-empty">
          <strong>{empty.title}</strong>
          <p>{empty.description}</p>
          {empty.action ? (
            <ActionButton action={empty.action} secondary />
          ) : null}
        </div>
      )}
      {action ? <ActionButton action={action} secondary /> : null}
    </section>
  );
}

export function CompactRow({
  icon,
  title,
  detail,
  meta,
  status,
  onActivate,
  disabledReason,
  loading = false,
  error,
}: {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly detail?: string;
  readonly meta?: string;
  readonly status?: { readonly kind: StatusKind; readonly label: string };
  readonly onActivate?: () => void;
  readonly disabledReason?: string;
  readonly loading?: boolean;
  readonly error?: { readonly message: string; readonly recovery: string };
}): ReactElement {
  const disabled = Boolean(disabledReason);
  const explanationId = `ui26-row-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-explanation`;
  const body = (
    <>
      <span className="ui26-icon">{icon}</span>
      <span className="ui26-row-copy">
        <strong>{title}</strong>
        {loading ? (
          <span className="ui26-row-skeleton" aria-label={`${title} loading`} />
        ) : detail ? (
          <small>{detail}</small>
        ) : null}
        {disabledReason ? <small id={explanationId}>{disabledReason}</small> : null}
        {error ? (
          <small className="ui26-row-error" role="status">
            {error.message} {error.recovery}
          </small>
        ) : null}
      </span>
      {status ? (
        <StatusMark status={status.kind} label={status.label} compact />
      ) : null}
      {meta ? <span className="ui26-meta">{meta}</span> : null}
    </>
  );
  return onActivate ? (
    <button
      type="button"
      className="ui26-row"
      disabled={disabled}
      onClick={onActivate}
      aria-busy={loading || undefined}
      aria-describedby={disabled ? explanationId : undefined}
    >
      {body}
    </button>
  ) : (
    <div className="ui26-row">{body}</div>
  );
}

export function EnvBadge({
  environment,
  compact = false,
}: {
  readonly environment: Environment;
  readonly compact?: boolean;
}): ReactElement {
  const labels = ENVIRONMENT_LABELS[environment];
  return (
    <span
      className={`ui26-env ui26-env-${environment}`}
      aria-label={labels.full}
    >
      {compact ? labels.compact : labels.full}
    </span>
  );
}

export function StatusMark({
  status,
  label,
  compact = false,
}: {
  readonly status: StatusKind;
  readonly label: string;
  readonly compact?: boolean;
}): ReactElement {
  return (
    <span className={`ui26-status ui26-status-${status}`}>
      {status === 'locked' ? (
        <LockKeyhole aria-hidden size={12} />
      ) : (
        <i aria-hidden />
      )}
      {compact ? (
        <span className="ui26-visually-hidden">{label}</span>
      ) : (
        label
      )}
    </span>
  );
}

export function CountChip({
  value,
  label,
  tone = 'neutral',
}: {
  readonly value: number;
  readonly label: string;
  readonly tone?: 'neutral' | 'warning' | 'danger';
}): ReactElement {
  return (
    <span
      className={`ui26-count ui26-count-${tone}`}
      aria-label={`${value} ${label}`}
    >
      {value}
    </span>
  );
}

export function ActionButton({
  action,
  secondary = false,
}: {
  readonly action: ActionSpec;
  readonly secondary?: boolean;
}): ReactElement {
  const variant = action.variant ?? (secondary ? 'secondary' : 'primary');
  return (
    <button
      type="button"
      className={cn(
        'ui26-button',
        variant === 'secondary' && 'is-secondary',
        variant === 'inverse' && 'is-inverse',
      )}
      disabled={action.disabled}
      onClick={action.onActivate}
    >
      {action.icon ? (
        <span className="ui26-icon" aria-hidden>
          {action.icon}
        </span>
      ) : null}
      {action.label}
    </button>
  );
}
