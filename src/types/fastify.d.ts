import type { Role } from '../domain/types.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: Role;
      matches?: string[];
      iss?: string;
      aud?: string | string[];
    };
    user: {
      sub: string;
      role: Role;
      matches?: string[];
      iss?: string;
      aud?: string | string[];
    };
  }
}
