import { Type } from '@sinclair/typebox';
import { EVENT_KINDS, EVENT_SOURCES, PERIODS } from '../domain/types.js';

const MAX_MATCH_TIME_US = 86_400_000_000;

export const MatchIdParams = Type.Object({ matchId: Type.String({ format: 'uuid' }) });
export const MatchPeriodParams = Type.Object({
  matchId: Type.String({ format: 'uuid' }),
  period: Type.Union(PERIODS.map((period) => Type.Literal(period))),
});
export const EventParams = Type.Object({
  matchId: Type.String({ format: 'uuid' }),
  eventId: Type.String({ format: 'uuid' }),
});

export const CreateMatchBody = Type.Object({
  matchId: Type.String({ format: 'uuid' }),
  competition: Type.String({ minLength: 1, maxLength: 200 }),
  homeTeam: Type.String({ minLength: 1, maxLength: 200 }),
  awayTeam: Type.String({ minLength: 1, maxLength: 200 }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const CreateEventBody = Type.Object({
  eventId: Type.String({ format: 'uuid' }),
  period: Type.Union(PERIODS.map((period) => Type.Literal(period))),
  kind: Type.Union(EVENT_KINDS.map((kind) => Type.Literal(kind))),
  source: Type.Union(EVENT_SOURCES.map((source) => Type.Literal(source))),
  status: Type.Optional(Type.Union([Type.Literal('PROPOSED'), Type.Literal('CONFIRMED')])),
  startUs: Type.Integer({ minimum: 0, maximum: MAX_MATCH_TIME_US }),
  endUs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_MATCH_TIME_US })),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  evidence: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ReviseEventBody = Type.Object({
  status: Type.Union([
    Type.Literal('CONFIRMED'),
    Type.Literal('REJECTED'),
    Type.Literal('CORRECTED'),
  ]),
  corrections: Type.Optional(
    Type.Partial(
      Type.Object({
        kind: Type.Union(EVENT_KINDS.map((kind) => Type.Literal(kind))),
        source: Type.Union(EVENT_SOURCES.map((source) => Type.Literal(source))),
        startUs: Type.Integer({ minimum: 0, maximum: MAX_MATCH_TIME_US }),
        endUs: Type.Integer({ minimum: 1, maximum: MAX_MATCH_TIME_US }),
        confidence: Type.Number({ minimum: 0, maximum: 1 }),
        evidence: Type.Record(Type.String(), Type.Unknown()),
      }),
    ),
  ),
});

export const CreateStoppageBody = Type.Object({
  stoppageId: Type.String({ format: 'uuid' }),
  period: Type.Union(PERIODS.map((period) => Type.Literal(period))),
  startUs: Type.Integer({ minimum: 0, maximum: MAX_MATCH_TIME_US }),
  endUs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_MATCH_TIME_US })),
  source: Type.Union(EVENT_SOURCES.map((source) => Type.Literal(source))),
  status: Type.Optional(Type.Union([Type.Literal('PROPOSED'), Type.Literal('CONFIRMED')])),
  evidence: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const StoppageParams = Type.Object({
  matchId: Type.String({ format: 'uuid' }),
  stoppageId: Type.String({ format: 'uuid' }),
});

export const CloseStoppageBody = Type.Object({
  endUs: Type.Integer({ minimum: 1, maximum: MAX_MATCH_TIME_US }),
  status: Type.Optional(Type.Union([Type.Literal('CONFIRMED'), Type.Literal('CORRECTED')])),
});

export const IntegrityBody = Type.Object({
  clockIntegrityOk: Type.Optional(Type.Boolean()),
  sourceIntegrityOk: Type.Optional(Type.Boolean()),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
});

export const MatchStatusBody = Type.Object({
  status: Type.Union([Type.Literal('FINISHED'), Type.Literal('ABANDONED')]),
  reason: Type.String({ minLength: 3, maxLength: 500 }),
});

export const AnnounceBody = Type.Object({
  minutes: Type.Integer({ minimum: 0, maximum: 60 }),
});

export const EstimateQuery = Type.Object({
  period: Type.Union(PERIODS.map((period) => Type.Literal(period))),
  nowUs: Type.Integer({ minimum: 0, maximum: MAX_MATCH_TIME_US }),
});

export const ClockSampleBody = Type.Object({
  period: Type.Union(PERIODS.map((period) => Type.Literal(period))),
  sourceSequence: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  elapsedUs: Type.Integer({ minimum: 0, maximum: MAX_MATCH_TIME_US }),
  sourceTimestamp: Type.Optional(Type.String({ format: 'date-time' })),
  evidence: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const ChangesQuery = Type.Object({
  afterId: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
});

export const LiveEstimateQuery = Type.Object({
  period: Type.Union(PERIODS.map((period) => Type.Literal(period))),
});
