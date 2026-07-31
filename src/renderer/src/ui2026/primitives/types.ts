import type { ReactNode } from 'react';

export type ActionSpec = {
  readonly label: string;
  readonly onActivate: () => void;
  readonly disabled?: boolean;
  readonly variant?: 'primary' | 'secondary' | 'inverse';
  readonly icon?: ReactNode;
};

export type Environment = 'local' | 'development' | 'staging' | 'production';

export type StatusKind =
  | 'connected'
  | 'secure'
  | 'syncing'
  | 'attention'
  | 'error'
  | 'coming-soon'
  | 'locked';

export type PanelItem<T> = {
  readonly id: string;
  readonly item: T;
};

export type HeroFact = {
  readonly label: string;
  readonly value: string;
};

export type EmptyStateSpec = {
  readonly title: string;
  readonly description: string;
  readonly action?: ActionSpec;
};

export type CategoryAccent =
  | 'violet'
  | 'cyan'
  | 'blue'
  | 'amber'
  | 'lime'
  | 'rose';

export type SponsorDisclosure = {
  readonly label: 'Sponsored';
  readonly sponsorName?: string;
};
