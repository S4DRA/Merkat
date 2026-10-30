import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sessionCookieName } from "@merkat/contracts";
import type { AccountRoutesOptions } from "./account-routes.js";
import { hashSessionToken } from "@merkat/backend";

export function allowedMatrixRequest(path: string, method: string, ownUserId: string) {
  const parts = path.split('/').map(decodeURIComponent);
  if (parts.some((p) => p === '.' || p === '..' || p.includes('/') || p.includes('\\'))) return false;
  if (path === '/_matrix/client/versions') return method === 'GET';
  if (parts[1] !== '_matrix' || parts[2] !== 'client' || !['v3', 'r0'].includes(parts[3] ?? '')) return false;
  const tail = parts.slice(4);
  if (method === 'GET') return ['sync', 'capabilities', 'pushrules', 'joined_rooms'].includes(tail[0] ?? '') ||
    (tail[0] === 'account' && tail[1] === 'whoami') ||
    (tail[0] === 'keys' && tail[1] === 'changes') ||
    (tail[0] === 'rooms' && ['state', 'members', 'joined_members', 'messages', 'context', 'event'].includes(tail[2] ?? '')) ||
    (tail[0] === 'user' && tail[1] === ownUserId && tail[2] === 'account_data');
  if (method === 'POST') return (tail[0] === 'keys' && ['upload', 'query', 'claim'].includes(tail[1] ?? '')) ||
    (tail[0] === 'rooms' && tail.length === 3 && ['join', 'leave'].includes(tail[2] ?? ''));
  if (method === 'PUT') return (tail[0] === 'sendToDevice' && ['m.room.encrypted', 'm.room_key_request'].includes(tail[1] ?? '')) ||
    (tail[0] === 'rooms' && tail[2] === 'send' && tail[3] === 'm.room.encrypted' && tail.length === 5) ||
    (tail[0] === 'user' && tail[1] === ownUserId && tail[2] === 'account_data' && tail.length === 4);
  return false;
}

export function registerMessagingRoutes(app: FastifyInstance, options: AccountRoutesOptions) {
  const messaging = options.messaging;
  const cookie = sessionCookieName(options.production);
  const deviceSchema = z.string().regex(/^[a-zA-Z0-9_-]{16,64}$/);
  app.post('/messaging/connect', async (request, reply) => {
    const user = await options.accounts.current(request.cookies[cookie]);
    if (!user?.onboardingComplete) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    if (!messaging) return reply.code(503).send({ error: 'MESSAGING_UNAVAILABLE' });
    const parsed = z.object({ device: deviceSchema }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    await messaging.ensureUser(user.id, user.profile.displayName ?? user.profile.username ?? 'Merkat');
    return { userId: messaging.userId(user.id), deviceId: parsed.data.device };
  });
  app.post('/messaging/rooms', async (request, reply) => {
    const user = await options.accounts.current(request.cookies[cookie]);
    if (!user?.onboardingComplete) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    if (!messaging || !options.plans) return reply.code(503).send({ error: 'MESSAGING_UNAVAILABLE' });
    const parsed = z.object({ device: deviceSchema, username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{2,29}$/) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const person = await options.plans.findPerson(parsed.data.username, hashSessionToken(request.cookies[cookie]!));
    if (!person || person.id === user.id) return reply.code(404).send({ error: 'PERSON_NOT_FOUND' });
    await messaging.ensureUser(user.id, user.profile.displayName ?? 'Merkat');
    await messaging.ensureUser(person.id, person.displayName ?? parsed.data.username);
    const response = await messaging.request(user.id, parsed.data.device, '/_matrix/client/v3/createRoom', 'POST', {
      preset: 'private_chat', visibility: 'private', is_direct: true, invite: [messaging.userId(person.id)],
      initial_state: [{ type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }, { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'joined' } }],
    });
    if (!response.ok) return reply.code(503).send({ error: 'MESSAGING_UNAVAILABLE' });
    return reply.code(201).send(z.object({ room_id: z.string() }).parse(await response.json()));
  });
  app.route({ method: ['GET', 'POST', 'PUT'], url: '/matrix/*', bodyLimit: 1048576, handler: async (request, reply) => {
    const user = await options.accounts.current(request.cookies[cookie]);
    if (!user?.onboardingComplete) return reply.code(401).send({ errcode: 'M_UNKNOWN_TOKEN', error: 'Sign in again' });
    if (!messaging) return reply.code(503).send({ error: 'MESSAGING_UNAVAILABLE' });
    const device = deviceSchema.safeParse(request.headers['x-merkat-device']);
    const url = new URL(request.url, 'http://internal');
    const path = url.pathname.slice('/matrix'.length);
    if (!device.success || !allowedMatrixRequest(path, request.method, messaging.userId(user.id))) return reply.code(403).send({ errcode: 'M_FORBIDDEN', error: 'Request not supported' });
    url.searchParams.delete('access_token');
    if (url.searchParams.has('timeout')) url.searchParams.set('timeout', '25000');
    const response = await messaging.request(user.id, device.data, path + url.search, request.method, request.body);
    return reply.code(response.status).type('application/json').send(await response.text());
  }});
}
