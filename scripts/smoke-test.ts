import { randomUUID } from 'node:crypto';

const baseUrl = process.env.ATAS_BASE_URL ?? 'http://127.0.0.1:8080';

async function request<T>(path: string, init?: RequestInit, expectedStatus = 200): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (response.status !== expectedStatus) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path}: expected ${expectedStatus}, got ${response.status}: ${await response.text()}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const matchId = randomUUID();
const matchPayload = {
  matchId,
  competition: 'ATAS CI',
  homeTeam: 'Home',
  awayTeam: 'Away',
};
const match = await request<{ id: string }>(
  '/v1/matches',
  { method: 'POST', body: JSON.stringify(matchPayload) },
  201,
);
const replayedMatch = await request<{ id: string }>(
  '/v1/matches',
  { method: 'POST', body: JSON.stringify(matchPayload) },
  200,
);
if (match.id !== matchId || replayedMatch.id !== matchId) {
  throw new Error('Match creation idempotency failed');
}

await request(`/v1/matches/${match.id}/periods/FIRST_HALF/start`, { method: 'POST' }, 204);
// Repeating the same lifecycle command must be harmless and must not create another audit action.
await request(`/v1/matches/${match.id}/periods/FIRST_HALF/start`, { method: 'POST' }, 204);

const clockPayload = {
  period: 'FIRST_HALF',
  sourceSequence: 1,
  elapsedUs: 1_500_000,
  evidence: { source: 'ci-smoke' },
};
await request(
  `/v1/matches/${match.id}/clock-samples`,
  { method: 'POST', body: JSON.stringify(clockPayload) },
  202,
);
// A network retry with identical content must be harmless.
await request(
  `/v1/matches/${match.id}/clock-samples`,
  { method: 'POST', body: JSON.stringify(clockPayload) },
  202,
);

const eventId = randomUUID();
const eventPayload = {
  eventId,
  period: 'FIRST_HALF',
  kind: 'INJURY',
  source: 'OPERATOR',
  status: 'CONFIRMED',
  startUs: 200_000,
  endUs: 800_000,
  confidence: 1,
  evidence: { source: 'ci-smoke' },
};
await request(
  `/v1/matches/${match.id}/events`,
  { method: 'POST', body: JSON.stringify(eventPayload) },
  201,
);
// Stable event IDs provide replay protection without duplicating the interruption.
await request(
  `/v1/matches/${match.id}/events`,
  { method: 'POST', body: JSON.stringify(eventPayload) },
  200,
);
// Repeating an already-applied human decision is also idempotent.
await request(
  `/v1/matches/${match.id}/events/${eventId}/decision`,
  { method: 'POST', body: JSON.stringify({ status: 'CONFIRMED' }) },
  200,
);

const events = await request<{ eventId: string; revision: number }[]>(
  `/v1/matches/${match.id}/events`,
);
const firstEvent = events[0];
if (
  firstEvent === undefined ||
  events.length !== 1 ||
  firstEvent.eventId !== eventId ||
  firstEvent.revision !== 1
) {
  throw new Error(`Event idempotency failed: ${JSON.stringify(events)}`);
}

const estimate = await request<{
  initialAllowanceUs: number;
  rawCompensableUs: number;
  overlapDeductedUs: number;
  operationalRecommendation: string;
  clock: { sourceSequence: number; fresh: boolean };
}>(`/v1/matches/${match.id}/estimate/live?period=FIRST_HALF`);
if (
  estimate.initialAllowanceUs !== 600_000 ||
  estimate.rawCompensableUs !== 600_000 ||
  estimate.overlapDeductedUs !== 0 ||
  estimate.operationalRecommendation !== 'VALID' ||
  estimate.clock.sourceSequence !== 1 ||
  !estimate.clock.fresh
) {
  throw new Error(`Unexpected live estimate: ${JSON.stringify(estimate)}`);
}

const changes = await request<{
  changes: { id: number }[];
  cursor: number;
  cursorExpired: boolean;
  retainedAfterId: number;
}>(`/v1/matches/${match.id}/changes?afterId=0&limit=100`);
if (changes.changes.length === 0 || changes.cursor <= 0 || changes.cursorExpired) {
  throw new Error(`Durable change feed failed: ${JSON.stringify(changes)}`);
}

await request(
  `/v1/matches/${match.id}/periods/FIRST_HALF/announcement`,
  { method: 'POST', body: JSON.stringify({ minutes: 2 }) },
  204,
);
await request(
  `/v1/matches/${match.id}/periods/FIRST_HALF/announcement`,
  { method: 'POST', body: JSON.stringify({ minutes: 2 }) },
  204,
);
await request(
  `/v1/matches/${match.id}/periods/FIRST_HALF/announcement`,
  { method: 'POST', body: JSON.stringify({ minutes: 1 }) },
  409,
);
await request(`/v1/matches/${match.id}/periods/FIRST_HALF/end`, { method: 'POST' }, 204);
await request(`/v1/matches/${match.id}/periods/FIRST_HALF/end`, { method: 'POST' }, 204);

const verification = await request<{ valid: boolean }>(`/v1/matches/${match.id}/audit/verify`);
if (!verification.valid) throw new Error('Audit verification failed');

process.stdout.write('ATAS integration smoke test passed\n');
