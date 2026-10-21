import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { AppConfig } from '../config.js';
import { EVENT_SOURCES, ROLES, type EventSource, type Role } from '../domain/types.js';

const ROLE_WEIGHT: Record<Exclude<Role, 'sensor'>, number> = {
  viewer: 1,
  operator: 2,
  official: 3,
  admin: 4,
};

export const READ_ROLES = [
  'viewer',
  'operator',
  'official',
  'admin',
] as const satisfies readonly Role[];
export const EVENT_INGEST_ROLES = [
  'sensor',
  'operator',
  'official',
  'admin',
] as const satisfies readonly Role[];
export const CLOCK_INGEST_ROLES = ['sensor', 'admin'] as const satisfies readonly Role[];

const EVENT_SOURCES_BY_ROLE: Record<Role, readonly EventSource[]> = {
  viewer: [],
  sensor: ['SENSOR_FUSION'],
  operator: ['OPERATOR', 'OFFICIAL_FEED', 'SENSOR_FUSION'],
  official: ['REFEREE', 'FOURTH_OFFICIAL', 'VAR', 'OPERATOR'],
  admin: EVENT_SOURCES,
};

export type AuthenticatedUser = { sub: string; role: Role; matches?: string[] };

function isMatchScope(value: unknown, allowWildcard: boolean): value is string[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (item) =>
      typeof item === 'string' &&
      ((allowWildcard && item === '*') ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item)),
  );
}

export function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { sub?: unknown; role?: unknown; matches?: unknown };
  return (
    typeof candidate.sub === 'string' &&
    candidate.sub.trim().length > 0 &&
    typeof candidate.role === 'string' &&
    ROLES.includes(candidate.role as Role) &&
    (candidate.matches === undefined || isMatchScope(candidate.matches, candidate.role === 'admin'))
  );
}

export function hasMinimumRole(role: Role, minimumRole: Exclude<Role, 'sensor'>): boolean {
  if (role === 'sensor') return false;
  return ROLE_WEIGHT[role] >= ROLE_WEIGHT[minimumRole];
}

export function hasAnyRole(role: Role, allowedRoles: readonly Role[]): boolean {
  return allowedRoles.includes(role);
}

export function mayAssertEventSource(role: Role, source: EventSource): boolean {
  return EVENT_SOURCES_BY_ROLE[role].includes(source);
}

export function mayAccessMatch(user: AuthenticatedUser, matchId: string): boolean {
  return user.role === 'admin' || user.matches?.includes(matchId) === true;
}

function requestedMatchId(request: FastifyRequest): string | undefined {
  if (typeof request.params !== 'object' || request.params === null) return undefined;
  const value = (request.params as { matchId?: unknown }).matchId;
  return typeof value === 'string' ? value : undefined;
}

async function rejectAuthentication(reply: FastifyReply): Promise<void> {
  await reply
    .code(401)
    .send({ error: 'UNAUTHENTICATED', message: 'A valid bearer token is required' });
}

async function authenticateRequest(
  config: AppConfig,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (config.authDisabled) {
    request.user = { sub: 'development-user', role: 'admin', matches: ['*'] };
    return;
  }

  try {
    await request.jwtVerify();
  } catch {
    await rejectAuthentication(reply);
    return;
  }

  if (!isAuthenticatedUser(request.user)) {
    await rejectAuthentication(reply);
    return;
  }

  const matchId = requestedMatchId(request);
  if (
    config.jwtRequireMatchScope &&
    matchId !== undefined &&
    !mayAccessMatch(request.user, matchId)
  ) {
    await reply.code(403).send({
      error: 'MATCH_SCOPE_REQUIRED',
      message: 'This credential is not assigned to the requested match',
    });
  }
}

export function authenticate(config: AppConfig): preHandlerAsyncHookHandler {
  return async (request, reply) => authenticateRequest(config, request, reply);
}

export function requireRole(
  config: AppConfig,
  minimumRole: Exclude<Role, 'sensor'>,
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    await authenticateRequest(config, request, reply);
    if (reply.sent) return;

    if (!hasMinimumRole(request.user.role, minimumRole)) {
      await reply
        .code(403)
        .send({ error: 'FORBIDDEN', message: `Role ${minimumRole} or higher is required` });
    }
  };
}

export function requireAnyRole(
  config: AppConfig,
  allowedRoles: readonly Role[],
): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    await authenticateRequest(config, request, reply);
    if (reply.sent) return;

    if (!hasAnyRole(request.user.role, allowedRoles)) {
      await reply.code(403).send({
        error: 'FORBIDDEN',
        message: `One of these roles is required: ${allowedRoles.join(', ')}`,
      });
    }
  };
}
