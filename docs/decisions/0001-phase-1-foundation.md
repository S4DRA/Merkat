# ADR 0001 — Approved Merkat foundation

Status: accepted by the user, 2026-09-11. Scope: Phase 1 preparation only.

## Repository and process boundaries

Use npm workspaces: Next.js App Router web, Fastify API, and a worker process. Shared packages are contracts, server-only backend, and database. This is one modular application with multiple runtime processes, not independently owned domain microservices. No Kubernetes, Kafka, or service mesh.

The API owns session enforcement, authorization, business rules, and privileged orchestration. Next.js owns presentation; it must not access Prisma or embed business logic in route components. Contracts are client-safe, with no database rows or secrets. Lint guards block named server-package imports from web and contracts; code review must also reject relative-path bypasses.

## Identity authority

An immutable internal Merkat ID is permanent. Phone, username, and external identity mappings are mutable or replaceable attributes. An issuer/subject pair is an external mapping, not the primary product identity. IdentityProvider remains abstract; actual phone OTP/OIDC authority must be selected before Phase 4. Supabase Auth is not adopted. The initial interface is a verification seam, not a full protocol or working authentication flow.

## Matrix ownership and federation

Matrix owns messaging rooms, membership, messaging roles, message history, replies, reactions, synchronization, and encryption state. Do not duplicate message history in Merkat PostgreSQL. Matrix IDs and room IDs are opaque mappings; do not infer Merkat IDs from their string structure or assume all identifiers share a local server suffix.

Self-operated infrastructure with federation disabled for V1. Later federation remains architecturally possible, subject to an explicit security/product review. Choose the permanent server name before deployment. Phase 1 contains no Matrix deployment, SDK, or provider credentials.

## Encryption

- DMs and private groups: E2EE by default.
- Public/broadcast channels: not E2EE.
- Plans and calendar: not E2EE in V1; private through backend authorization and database security.
- Plans originating from encrypted conversations store a source reference and deliberately supplied product fields. Never automatically copy encrypted chat content into a plan.

Device key recovery, encrypted attachments, server visibility, notification previews, and encrypted search require validation before messaging implementation. A provider boundary must not erase the need for client-side encryption or silently downgrade it.

## Data ownership

Merkat PostgreSQL owns users/profiles, external identity mappings, contacts, privacy, blocks/reports, plans, RSVPs, reminders, preferences, sessions, and call metadata. Calendar shared views derive from plans. Matrix owns messaging membership and content. Object storage owns bytes; access/reference metadata stays with the appropriate domain. LiveKit owns realtime transport, not the authoritative product call history. Redis is temporary/cache/coordination storage, never the product system of record.

Synapse/MAS storage is separate from the Merkat schema. Cross-system mutations need idempotency, reconciliation, and durable outbox patterns when introduced; no imaginary distributed transaction. Product authorization must fail closed when authoritative membership cannot be verified.

## Provider adapters

Keep identity, messaging, storage, calls, and notifications behind relevant service boundaries. Add implementations when their phases begin. Do not build a universal provider framework or fake production adapters. Database access uses Prisma/PostgreSQL; Supabase may host the database without becoming an application API dependency.

## Hosting

Vendor undecided, EU preferred, inexpensive early operation, distinct staging and production. Docker-based local development. API, workers, and Matrix need suitable persistent runtime hosting later. No external infrastructure provisioning in Phase 1.

## Consequences and open gates

Provider choice, account recovery, Matrix server name, resource budget, and deployment vendor remain open. Encryption policy and non-federated V1 behavior are settled. Complete auth/provider compatibility work before Phase 4. Do not start Phase 2 without review.
