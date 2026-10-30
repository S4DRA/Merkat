import type { DirectMessageView, MessagePage } from "@merkat/contracts";

export class DirectRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryAfter = 0,
  ) {
    super(code);
  }
}
export async function directRequest<T>(
  endpoint: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${endpoint}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const value = response.status === 204 ? undefined : await response.json();
  if (!response.ok)
    throw new DirectRequestError(
      value?.error ?? "SERVICE_UNAVAILABLE",
      Number(response.headers.get("Retry-After")) || 0,
    );
  return value as T;
}
export function directError(error: unknown) {
  if (error instanceof DirectRequestError) {
    if (error.code === "PAYMENTS_EXCEED_TOTAL")
      return "Correct the venue payment records before reducing the total.";
    if (error.code === "TAB_ALREADY_OPEN")
      return "This conversation already has an open tab. Open it from the activity list.";
    if (error.code === "PENDING_CONFIRMATIONS")
      return "Confirm or cancel pending shared orders before closing.";
    if (error.code === "INVALID_CREDENTIALS")
      return "That password or recovery code didn't match.";
    if (error.code === "NOT_FOUND") return "Not found.";
    if (error.code === "INVALID_REQUEST")
      return "Check the details and try again.";
    if (error.code === "SELF_CONVERSATION") return "Choose someone else.";
    if (error.code === "SELF_FRIENDSHIP") return "Choose someone else.";
    if (error.code === "PENDING_LIMIT")
      return "Cancel a pending request first.";
    if (error.code === "TRY_LATER")
      return `Try again in ${error.retryAfter || 60}s.`;
    if (error.code === "UNAUTHORIZED") return "Sign in again.";
    if (error.code === "SUBMISSION_CONFLICT")
      return "This activity changed. Refresh and try again.";
    if (error.code === "FORBIDDEN") return "You don’t have permission.";
    if (error.code === "INTERACTION_UNAVAILABLE")
      return "Messaging is unavailable for this conversation.";
    if (error.code === "OWNER_TRANSFER_REQUIRED")
      return "Transfer ownership before leaving.";
    if (error.code === "DEFAULT_CHANNEL")
      return "The default channel can’t be deleted.";
    if (error.code === "CHANNEL_NAME_TAKEN")
      return "That channel name is already used.";
    if (error.code === "LIMIT_REACHED") return "This limit has been reached.";
  }
  return "Couldn’t connect. Try again.";
}
export function mergeMessages<T extends { id: string; sequence: number }>(
  current: T[],
  incoming: T[],
) {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence);
}
/** Drain a fixed persisted sequence boundary; retries/replayed notifications cannot duplicate rows. */
export async function reconcileMessages(
  current: DirectMessageView[],
  load: (after: number, through?: number) => Promise<MessagePage>,
  changed: (page: MessagePage, merged: DirectMessageView[]) => void,
  afterSequence = current.at(-1)?.sequence ?? 0,
) {
  let merged = current;
  let after = afterSequence;
  let through: number | undefined;
  while (true) {
    const page = await load(after, through);
    through = page.through;
    merged = mergeMessages(merged, page.messages);
    changed(page, merged);
    const next = page.messages.at(-1)?.sequence;
    if (!page.hasMore || next === undefined || next <= after) return merged;
    after = next;
  }
}
