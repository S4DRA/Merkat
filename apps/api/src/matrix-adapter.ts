import { createHmac } from "node:crypto";
import { z } from "zod";

export interface MessagingProvider {
  userId(id: string): string;
  ensureUser(id: string, displayName: string): Promise<void>;
  request(id: string, device: string, path: string, method: string, body?: unknown): Promise<Response>;
  isMember(id: string, room: string): Promise<boolean>;
}
export function createMatrixAdapter(input: { url: string; serverName: string; adminToken: string; passwordSecret: string }): MessagingProvider {
  const origin = new URL(input.url);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !/^[a-zA-Z0-9.:-]+$/.test(input.serverName) || input.passwordSecret.length < 32 || !input.adminToken)
    throw new Error("Invalid Matrix configuration");
  const userId = (id: string) => `@merkat_${id.replaceAll('-', '')}:${input.serverName}`;
  const password = (id: string) => createHmac('sha256', input.passwordSecret).update(id).digest('base64url');
  const tokens = new Map<string, { token: string; expires: number }>();
  const pending = new Map<string, Promise<string>>();
  async function call(path: string, method: string, body?: unknown, token?: string) {
    return fetch(new URL(path, origin), { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(35000) });
  }
  async function login(id: string, device: string) {
    const key = `${id}:${device}`;
    const cached = tokens.get(key);
    if (cached && cached.expires > Date.now()) return cached.token;
    const running = pending.get(key);
    if (running) return running;
    const promise = (async () => {
      for (const [k, entry] of tokens) if (entry.expires < Date.now()) tokens.delete(k);
      if (tokens.size + pending.size >= 500) throw new Error('Messaging capacity reached');
      const response = await call('/_matrix/client/v3/login', 'POST', { type: 'm.login.password', identifier: { type: 'm.id.user', user: userId(id) }, password: password(id), device_id: device, initial_device_display_name: 'Merkat browser' });
      if (!response.ok) throw new Error('Messaging login unavailable');
      const data = z.object({ access_token: z.string(), user_id: z.string(), device_id: z.string() }).parse(await response.json());
      if (data.user_id !== userId(id) || data.device_id !== device) throw new Error('Messaging identity mismatch');
      tokens.set(key, { token: data.access_token, expires: Date.now() + 3600000 });
      return data.access_token;
    })();
    pending.set(key, promise);
    try { return await promise; } finally { pending.delete(key); }
  }
  return {
    userId,
    async ensureUser(id, displayName) {
      const path = `/_synapse/admin/v2/users/${encodeURIComponent(userId(id))}`;
      const existing = await call(path, 'GET', undefined, input.adminToken);
      if (existing.ok) return;
      if (existing.status !== 404) throw new Error('Messaging provisioning unavailable');
      const response = await call(path, 'PUT', { password: password(id), displayname: displayName, admin: false, logout_devices: false }, input.adminToken);
      if (!response.ok) throw new Error('Messaging provisioning unavailable');
    },
    async request(id, device, path, method, body) {
      const key = `${id}:${device}`;
      const result = await call(path, method, body, await login(id, device));
      if (result.status === 401) tokens.delete(key);
      return result;
    },
    async isMember(id, room) {
      const response = await call(`/_synapse/admin/v1/rooms/${encodeURIComponent(room)}/members`, 'GET', undefined, input.adminToken);
      if (response.status === 404) return false;
      if (!response.ok) throw new Error('Membership check unavailable');
      const data = z.object({ members: z.array(z.string()) }).parse(await response.json());
      return data.members.includes(userId(id));
    },
  };
}
