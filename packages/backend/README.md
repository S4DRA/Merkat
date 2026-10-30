# Server-only backend

Reusable server-only product services and provider ports. Next imports these only through guarded `src/lib/server` modules; client imports remain blocked by lint and the server-only boundary. AccountService owns identity/session orchestration and profile validation. PlanService preserves existing plan validation and ownership behavior. Repository ports are implemented by packages/database. Fastify is a parity-test reference only.

Phase 4 AuthenticationService validates registration/login, performs Argon2id
hashing/verification and applies shared account/source/global quotas through a
PostgreSQL limiter port. New users get a complete profile and existing Merkat
session semantics. No password recovery or automatic legacy identity linking.
Domain errors carry a non-enumerable process-wide brand so Next bundle copies can
recognize errors from the shared server-service cache without exposing internals.

IdentityProvider remains a verification boundary without a production adapter. Its eventual implementation must verify credentials and flow bindings before AccountService.signIn may run. No HTTP endpoint accepts a supposedly verified issuer, subject or user ID from the browser. Provider selection remains open. Verified issuer/subject pairs map to independently generated Merkat UUIDs; automatic linking by phone or username is forbidden.

Add Matrix, object-storage, calling, and notification adapters with their integrations, not speculative mock implementations now. Messaging device encryption and synchronization also need a client-side Matrix boundary; server adapters must not require plaintext access.
