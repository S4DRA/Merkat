import { SocialError } from "@merkat/backend";
import type { Prisma } from "./generated/client.js";
type Tx = Prisma.TransactionClient;
/** Shared checks coexist; privacy changes wait for in-flight interactions to commit. */
export async function privacyFence(tx: Tx, exclusive = false) {
  if (exclusive)
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('merkat:privacy',0))::text`;
  else
    await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('merkat:privacy',0))::text`;
}
export async function isBlocked(tx: Tx, a: string, b: string) {
  return !!(await tx.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { blockerId: true },
  }));
}
export async function areFriends(tx: Tx, a: string, b: string) {
  const [firstUserId, secondUserId] = a < b ? [a, b] : [b, a];
  return !!(await tx.friendship.findFirst({
    where: { firstUserId, secondUserId, status: "ACCEPTED" },
    select: { id: true },
  }));
}
export async function assertInteraction(tx: Tx, a: string, b: string) {
  if (await isBlocked(tx, a, b))
    throw new SocialError("INTERACTION_UNAVAILABLE");
}
export async function invitationAllowed(
  tx: Tx,
  inviter: string,
  owner: string,
  target: string,
) {
  if (
    target === inviter ||
    (await isBlocked(tx, inviter, target)) ||
    (await isBlocked(tx, owner, target))
  )
    return false;
  const person = await tx.user.findFirst({
    where: {
      id: target,
      status: "ACTIVE",
      onboardingCompletedAt: { not: null },
    },
    select: { privacy: { select: { groupInvitesFrom: true } } },
  });
  if (!person) return false;
  const policy = person.privacy?.groupInvitesFrom ?? "FRIENDS";
  return (
    policy === "EVERYONE" ||
    (policy === "FRIENDS" && (await areFriends(tx, inviter, target)))
  );
}
export const publicPersonSelect = {
  userId: true,
  username: true,
  displayName: true,
} as const;
export function personView(
  id: string,
  profile: { username: string | null; displayName: string | null } | null,
) {
  return {
    id,
    username: profile?.username ?? null,
    displayName: profile?.displayName ?? null,
  };
}
