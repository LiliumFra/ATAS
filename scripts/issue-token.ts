import { SignJWT } from 'jose';
import { loadConfig } from '../src/config.js';
import { ROLES, type Role } from '../src/domain/types.js';

function argument(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? fallback : process.argv[index + 1];
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
}

const config = loadConfig();
const roleRaw = argument('role', 'viewer');
if (!ROLES.includes(roleRaw as Role)) throw new Error(`Invalid role: ${roleRaw}`);
const role = roleRaw as Role;
const subject = argument('subject', 'local-user');
const hours = Number.parseInt(argument('hours', '8'), 10);
if (!Number.isSafeInteger(hours) || hours < 1 || hours > 24)
  throw new Error('--hours must be 1..24');

const matchesRaw = argument('matches', role === 'admin' ? '*' : undefined);
const matches = [
  ...new Set(
    matchesRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];
if (matches.length === 0) throw new Error('--matches must contain at least one match UUID');
if (role !== 'admin' && matches.includes('*')) {
  throw new Error('Only admin credentials may use the wildcard match scope');
}
if (
  matches.some(
    (value) =>
      value !== '*' &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  )
) {
  throw new Error('--matches must contain comma-separated UUIDs; only admin may use *');
}

const secret = new TextEncoder().encode(config.jwtSecret);
const token = await new SignJWT({ role, matches })
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setSubject(subject)
  .setIssuer(config.jwtIssuer)
  .setAudience(config.jwtAudience)
  .setIssuedAt()
  .setExpirationTime(`${hours}h`)
  .sign(secret);

process.stdout.write(`${token}\n`);
