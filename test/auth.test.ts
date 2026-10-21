import { describe, expect, it } from 'vitest';
import {
  CLOCK_INGEST_ROLES,
  EVENT_INGEST_ROLES,
  hasAnyRole,
  hasMinimumRole,
  isAuthenticatedUser,
  mayAccessMatch,
  mayAssertEventSource,
  READ_ROLES,
} from '../src/api/auth.js';

describe('authentication claims', () => {
  it('accepts only known roles and a non-empty subject', () => {
    expect(isAuthenticatedUser({ sub: 'referee-1', role: 'official' })).toBe(true);
    expect(isAuthenticatedUser({ sub: 'referee-1', role: 'root' })).toBe(false);
    expect(isAuthenticatedUser({ sub: '', role: 'admin' })).toBe(false);
    expect(
      isAuthenticatedUser({ sub: 'referee-1', role: 'official', matches: ['not-a-uuid'] }),
    ).toBe(false);
    expect(isAuthenticatedUser(null)).toBe(false);
  });

  it('keeps sensor credentials outside the human role hierarchy', () => {
    expect(hasMinimumRole('viewer', 'viewer')).toBe(true);
    expect(hasMinimumRole('sensor', 'viewer')).toBe(false);
    expect(hasMinimumRole('sensor', 'operator')).toBe(false);
    expect(hasMinimumRole('official', 'operator')).toBe(true);
  });

  it('uses explicit capabilities for read, event-ingest, and clock-ingest access', () => {
    expect(hasAnyRole('sensor', READ_ROLES)).toBe(false);
    expect(hasAnyRole('sensor', EVENT_INGEST_ROLES)).toBe(true);
    expect(hasAnyRole('official', EVENT_INGEST_ROLES)).toBe(true);
    expect(hasAnyRole('official', CLOCK_INGEST_ROLES)).toBe(false);
    expect(hasAnyRole('admin', CLOCK_INGEST_ROLES)).toBe(true);
  });
  it('limits non-admin credentials to explicitly assigned matches', () => {
    const matchId = '00000000-0000-4000-8000-000000000001';
    const otherMatchId = '00000000-0000-4000-8000-000000000002';
    expect(mayAccessMatch({ sub: 'referee', role: 'official', matches: [matchId] }, matchId)).toBe(
      true,
    );
    expect(
      mayAccessMatch({ sub: 'referee', role: 'official', matches: [matchId] }, otherMatchId),
    ).toBe(false);
    expect(isAuthenticatedUser({ sub: 'ops', role: 'operator', matches: ['*'] })).toBe(false);
    expect(mayAccessMatch({ sub: 'admin', role: 'admin' }, otherMatchId)).toBe(true);
  });

  it('prevents automated and human roles from impersonating stronger provenance sources', () => {
    expect(mayAssertEventSource('sensor', 'SENSOR_FUSION')).toBe(true);
    expect(mayAssertEventSource('sensor', 'REFEREE')).toBe(false);
    expect(mayAssertEventSource('operator', 'OPERATOR')).toBe(true);
    expect(mayAssertEventSource('operator', 'VAR')).toBe(false);
    expect(mayAssertEventSource('official', 'VAR')).toBe(true);
    expect(mayAssertEventSource('admin', 'SYSTEM')).toBe(true);
  });
});
