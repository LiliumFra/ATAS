export const PERIODS = ['FIRST_HALF', 'SECOND_HALF', 'ET_FIRST', 'ET_SECOND'] as const;
export type Period = (typeof PERIODS)[number];

export const EVENT_KINDS = [
  'SUBSTITUTION',
  'INJURY',
  'PLAYER_REMOVAL',
  'TIME_WASTING',
  'DISCIPLINARY_DELAY',
  'MEDICAL_BREAK',
  'VAR_CHECK',
  'VAR_REVIEW',
  'GOAL_CELEBRATION',
  'EXTERNAL_INTERFERENCE',
  'THROW_IN_RESTART',
  'GOAL_KICK_RESTART',
  'FREE_KICK_RESTART',
  'CORNER_RESTART',
  'OTHER_SIGNIFICANT_DELAY',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_STATUSES = ['PROPOSED', 'CONFIRMED', 'REJECTED', 'CORRECTED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_SOURCES = [
  'REFEREE',
  'FOURTH_OFFICIAL',
  'VAR',
  'OFFICIAL_FEED',
  'SENSOR_FUSION',
  'OPERATOR',
  'SYSTEM',
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const ROLES = ['viewer', 'sensor', 'operator', 'official', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export type CompensationMode = 'FULL' | 'EXCESS' | 'MANUAL' | 'NONE';

export type EventPolicy = {
  mode: CompensationMode;
  graceUs: number;
  description: string;
};

export type Ruleset = {
  id: string;
  version: string;
  effectiveFrom: string;
  description: string;
  nominalPeriodUs: Record<Period, number>;
  policies: Record<EventKind, EventPolicy>;
  boardPolicy: {
    suggestion: 'FLOOR_AND_CEIL';
    refereeApprovalRequired: true;
  };
};

export type MatchEvent = {
  recordId: string;
  sequence: number;
  eventId: string;
  matchId: string;
  period: Period;
  revision: number;
  kind: EventKind;
  source: EventSource;
  status: EventStatus;
  startUs: number;
  endUs?: number;
  confidence: number;
  evidence: Record<string, unknown>;
  createdBy: string;
  supersedesRecordId?: string;
  previousHash: string;
  eventHash: string;
  createdAt: string;
};

export type ClockSample = {
  sequence: number;
  matchId: string;
  period: Period;
  sourceId: string;
  sourceSequence: number;
  elapsedUs: number;
  sourceTimestamp?: string;
  evidence: Record<string, unknown>;
  previousHash: string;
  sampleHash: string;
  receivedAt: string;
};

export type Interval = {
  startUs: number;
  endUs: number;
};

export type PeriodState = {
  period: Period;
  status: 'NOT_STARTED' | 'RUNNING' | 'ENDED';
  nominalDurationUs: number;
  announcedMinutes?: number;
};

export type EngineInput = {
  period: Period;
  nowUs: number;
  ruleset: Ruleset;
  events: MatchEvent[];
  allPlayStoppages: Interval[];
  announcedMinutes?: number;
  clockIntegrityOk: boolean;
  sourceIntegrityOk: boolean;
};

export type EventContribution = {
  eventId: string;
  kind: EventKind;
  policyMode: CompensationMode;
  regulationUs: number;
  addedTimeUs: number;
  totalRawUs: number;
  exclusiveUs: number;
  sharedUs: number;
};

export type ExcludedEvent = {
  eventId: string;
  kind: EventKind;
  status: EventStatus;
  reason:
    | 'STATUS_NOT_CONFIRMED'
    | 'POLICY_NONE'
    | 'NOT_YET_STARTED'
    | 'WITHIN_GRACE'
    | 'NO_COMPENSABLE_DURATION';
};

export type EngineResult = {
  period: Period;
  nowUs: number;
  nominalBoundaryUs: number;
  addedTimeStartUs: number;
  initialAllowanceUs: number;
  announcedAllowanceUs: number;
  effectiveBaseAllowanceUs: number;
  lossDuringAddedTimeUs: number;
  exactTargetEndUs: number;
  remainingUs: number;
  boardFloorMinutes: number;
  boardCeilMinutes: number;
  activeEventIds: string[];
  includedEventIds: string[];
  eventContributions: EventContribution[];
  excludedEvents: ExcludedEvent[];
  rawCompensableUs: number;
  overlapDeductedUs: number;
  integrity: 'OK' | 'DEGRADED' | 'UNSAFE';
  operationalRecommendation: 'VALID' | 'REVIEW_REQUIRED' | 'WITHHELD';
  decisionRequired: boolean;
};
