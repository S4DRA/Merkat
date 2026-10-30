"use client";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { PlanView } from "@merkat/contracts";
import { Button } from "../ui/primitives";
async function fetchPlans(): Promise<PlanView[]> {
  const response = await fetch("/api/account/plans", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load plans. Please try again.");
  const data = await response.json();
  return data.plans;
}
export function PlanWorkspace({ userId }: { userId: string }) {
  return (
    <Suspense>
      <PlanWorkspaceContent userId={userId} />
    </Suspense>
  );
}
function PlanWorkspaceContent({ userId }: { userId: string }) {
  const parameters = useSearchParams();
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(!!parameters.get("conversation"));
  const [conversationId, setConversationId] = useState<string | undefined>(
    parameters.get("conversation") ?? undefined,
  );
  async function load() {
    setPlans(await fetchPlans());
  }
  useEffect(() => {
    let active = true;
    void fetchPlans()
      .then((data) => {
        if (active) setPlans(data);
      })
      .catch(() => {
        if (active) setError("Could not load plans. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/account/plans/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          location: form.get("location"),
          startsAt: new Date(String(form.get("startsAt"))).toISOString(),
          endsAt: new Date(String(form.get("endsAt"))).toISOString(),
          usernames: String(form.get("usernames") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...(conversationId ? { conversationId } : {}),
        }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 400
            ? "Check the dates and participant usernames."
            : "Could not create this plan. Try again.",
        );
      const data = await response.json();
      setPlans((old) => [data.plan, ...old]);
      setCreating(false);
      setConversationId(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create this plan.");
    } finally {
      setPending(false);
    }
  }
  async function respond(id: string, action: string) {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/account/plans/respond", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!response.ok) throw new Error("Could not update this plan.");
      await load();
    } catch {
      setError("Could not update this plan. Please refresh and try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="product-workspace">
      <div className="product-heading">
        <h2>Make it happen.</h2>
        <Button onClick={() => setCreating(!creating)}>
          {creating ? "Close form" : "Create a plan"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setError("");
              void load().catch(() => setError("Could not load plans."));
            }}
          >
            Retry
          </button>
        </p>
      )}
      {creating && (
        <form className="account-form product-form" onSubmit={create}>
          {conversationId && (
            <p>
              This plan links to the conversation. Enter the details you want to
              share; chat content is not copied.
            </p>
          )}
          <label>
            Title
            <input name="title" required maxLength={120} disabled={pending} />
          </label>
          <div className="product-form-row">
            <label>
              Starts
              <input
                type="datetime-local"
                name="startsAt"
                required
                disabled={pending}
              />
            </label>
            <label>
              Ends
              <input
                type="datetime-local"
                name="endsAt"
                required
                disabled={pending}
              />
            </label>
          </div>
          <small>Dates use your device’s local time zone.</small>
          <label>
            Place
            <input name="location" maxLength={200} disabled={pending} />
          </label>
          <label>
            Details
            <textarea name="description" maxLength={2000} disabled={pending} />
          </label>
          <label>
            Invite by username
            <input
              name="usernames"
              placeholder="Separate usernames with commas"
              disabled={pending}
            />
          </label>
          <small>
            Plan details are visible to invited people and are not end-to-end
            encrypted.
          </small>
          <Button type="submit" variant="primary" loading={pending}>
            Create plan
          </Button>
        </form>
      )}
      {loading ? (
        <p role="status">Loading plans…</p>
      ) : (
        !plans.length && (
          <p>No plans yet. Start with a time, a place, and your people.</p>
        )
      )}
      <div className="plan-list">
        {plans.map((plan) => (
          <article className="plan-item" key={plan.id}>
            <h3>
              {plan.title}
              {plan.cancelled ? " · Cancelled" : ""}
            </h3>
            <p>
              <time dateTime={plan.startsAt}>
                {new Date(plan.startsAt).toLocaleString()}
              </time>{" "}
              —{" "}
              <time dateTime={plan.endsAt}>
                {new Date(plan.endsAt).toLocaleString()}
              </time>
            </p>
            {plan.location && <p>{plan.location}</p>}
            {plan.description && (
              <p className="preserve-lines">{plan.description}</p>
            )}
            <ul>
              {plan.participants.map((p) => (
                <li key={p.userId}>
                  {p.displayName ?? p.username} · {p.response.toLowerCase()}
                </li>
              ))}
            </ul>
            {plan.conversationId && (
              <Link
                href={`/chats?room=${encodeURIComponent(plan.conversationId)}`}
              >
                Open conversation
              </Link>
            )}
            {!plan.cancelled && (
              <div className="product-actions">
                {(["GOING", "MAYBE", "DECLINED"] as const).map((action) => (
                  <Button
                    key={action}
                    disabled={pending}
                    aria-pressed={
                      plan.participants.find((p) => p.userId === userId)
                        ?.response === action
                    }
                    onClick={() => void respond(plan.id, action)}
                  >
                    {action === "GOING"
                      ? "Going"
                      : action === "MAYBE"
                        ? "Maybe"
                        : "Can’t go"}
                  </Button>
                ))}
                {plan.ownerId === userId && (
                  <Button
                    disabled={pending}
                    onClick={() => void respond(plan.id, "CANCEL")}
                  >
                    Cancel plan
                  </Button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
