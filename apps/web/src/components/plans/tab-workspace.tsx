"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Check, Plus, Receipt, RotateCcw } from "lucide-react";
import {
  parseMoneyInput,
  type ChatScope,
  type TabView,
  type TabState,
  type tabActionSchema,
} from "@merkat/contracts";
import type { z } from "zod";
import {
  directRequest,
  directError,
  DirectRequestError,
} from "../../lib/direct-client";
import { Button } from "../ui/primitives";
import { featureChanged } from "./calendar-workspace";
type Action = z.infer<typeof tabActionSchema>["action"];
type Person = TabState["participants"][number];
export const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    amount / 100,
  );
export function TabCreate({
  scope,
  onSaved,
  onCancel,
}: {
  scope: ChatScope;
  onSaved: (tab: TabView) => void;
  onCancel: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [canManage, setCanManage] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const clientId = useRef(crypto.randomUUID()),
    busy = useRef(false);
  const scopeJson = JSON.stringify(scope);
  useEffect(() => {
    const controller = new AbortController();
    void directRequest<{ people: Person[]; canManage: boolean }>(
      "tabs/context",
      JSON.parse(scopeJson),
      controller.signal,
    )
      .then((r) => {
        setPeople(r.people);
        setSelected(r.people.map((p) => p.id));
        setCanManage(r.canManage);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(directError(error));
      });
    return () => controller.abort();
  }, [scopeJson]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    const f = new FormData(e.currentTarget);
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const r = await directRequest<{ tab: TabView }>("tabs/create", {
        scope,
        clientId: clientId.current,
        title: f.get("title"),
        currency: f.get("currency"),
        participantIds: selected,
      });
      featureChanged();
      onSaved(r.tab);
    } catch (error) {
      setError(directError(error));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <form className="social-form" onSubmit={(e) => void submit(e)}>
      <p className="eyebrow">GOOD TIMES, CLEAR TOTALS</p>
      <h2>Open a tab</h2>
      <p className="supporting-copy">
        Keep track together. Each person adds their own orders, and shared costs
        need everyone’s confirmation.
      </p>
      <label>
        Session name
        <input
          name="title"
          required
          maxLength={100}
          placeholder="Friday pub night"
          autoFocus
        />
      </label>
      <label>
        Currency
        <select name="currency" defaultValue="TRY">
          <option value="TRY">TRY · Turkish lira</option>
          <option value="EUR">EUR · Euro</option>
          <option value="USD">USD · US dollar</option>
          <option value="GBP">GBP · British pound</option>
        </select>
      </label>
      <fieldset className="participant-options">
        <legend>Who’s joining?</legend>
        {people.map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked
                    ? [...old, p.id]
                    : old.filter((id) => id !== p.id),
                )
              }
            />
            {p.displayName}
          </label>
        ))}
      </fieldset>
      {!canManage && people.length > 0 && (
        <p role="status">Only group owners and admins can open a group tab.</p>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <div className="feature-actions">
        <Button
          type="submit"
          variant="primary"
          loading={pending}
          disabled={!canManage || !selected.length}
        >
          Open tab
        </Button>
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
export function TabDetail({
  tabId,
  userId,
}: {
  tabId: string;
  userId: string;
}) {
  const [tab, setTab] = useState<TabView | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [confirmClose, setConfirmClose] = useState(false),
    [failed, setFailed] = useState<unknown>(null);
  const [name, setName] = useState(""),
    [price, setPrice] = useState(""),
    [quantity, setQuantity] = useState(1),
    [split, setSplit] = useState<"OWN" | "EQUAL" | "QUANTITY" | "CUSTOM">(
      "OWN",
    ),
    [selected, setSelected] = useState<string[]>([userId]),
    [weights, setWeights] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const busy = useRef(false);
  const load = useCallback(async () => {
    try {
      const r = await directRequest<{ tab: TabView }>("tabs/detail", {
        id: tabId,
      });
      setTab(r.tab);
      setError("");
    } catch (error) {
      setError(directError(error));
    }
  }, [tabId]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    const change = () => void load();
    window.addEventListener("merkat:reconcile", change);
    window.addEventListener("focus", change);
    return () => {
      active = false;
      window.removeEventListener("merkat:reconcile", change);
      window.removeEventListener("focus", change);
    };
  }, [load]);
  async function update(action: Action, original?: unknown) {
    if (!tab || busy.current) return;
    const payload = original ?? {
      id: tab.id,
      version: tab.version,
      clientId: crypto.randomUUID(),
      action,
    };
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const r = await directRequest<{ tab: TabView }>("tabs/act", payload);
      setTab(r.tab);
      setFailed(null);
      featureChanged();
      return true;
    } catch (error) {
      if (
        error instanceof DirectRequestError &&
        !["SERVICE_UNAVAILABLE"].includes(error.code)
      ) {
        setFailed(null);
        await load();
        setError(
          error.code === "SUBMISSION_CONFLICT"
            ? "Someone updated this tab. Review the latest totals and try again."
            : directError(error),
        );
      } else {
        setFailed(payload);
        setError(
          "The update wasn’t confirmed. Retry safely to check the same submission.",
        );
      }
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function addOrder(e: FormEvent) {
    e.preventDefault();
    try {
      const amount = parseMoneyInput(price);
      if (editingId) {
        if (
          await update({
            kind: "EDIT_ORDER",
            orderId: editingId,
            name,
            unitPrice: amount,
            quantity,
          })
        )
          setEditingId(null);
        return;
      }
      const allocations =
        split === "OWN"
          ? [{ userId }]
          : selected.map((id) => ({
              userId: id,
              ...(split === "QUANTITY"
                ? { weight: Number(weights[id] ?? 1) }
                : split === "CUSTOM"
                  ? { amount: parseMoneyInput(weights[id] ?? "") }
                  : {}),
            }));
      await update({
        kind: "ORDER",
        name,
        quantity,
        unitPrice:
          split === "OWN" ? amount : Math.max(1, Math.floor(amount / quantity)),
        ...(split !== "OWN" ? { total: amount } : {}),
        split,
        allocations,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Check the order.");
    }
  }
  if (!tab)
    return (
      <div>
        <p role={error ? "alert" : "status"}>{error || "Loading tab…"}</p>
        {error && <Button onClick={() => void load()}>Try again</Button>}
      </div>
    );
  const person = (id: string) =>
    id === userId
      ? "You"
      : (tab.state.participants.find((p) => p.id === id)?.displayName ??
        "Participant");
  const own = tab.summary.people.find((p) => p.userId === userId),
    disabled = pending || !!failed;
  return (
    <div className="tab-detail">
      <div className="tab-title">
        <div>
          <p className="eyebrow">
            {tab.closedAt
              ? "SAVED IN THIS CONVERSATION"
              : "KEEP THE GOOD TIMES SIMPLE"}
          </p>
          <h2>{tab.title}</h2>
        </div>
        <span className="feature-status">
          {tab.closedAt ? "Closed" : "Open"} · {tab.currency}
        </span>
      </div>
      <p className="supporting-copy">
        {tab.state.participants.length} people · Started{" "}
        {new Date(tab.createdAt).toLocaleDateString()}
      </p>
      <div className="tab-totals">
        <div>
          <small>Your consumption</small>
          <strong>{money(own?.consumed ?? 0, tab.currency)}</strong>
        </div>
        <div>
          <small>Group total</small>
          <strong>{money(tab.summary.total, tab.currency)}</strong>
        </div>
        <div>
          <small>You paid the venue</small>
          <strong>{money(own?.paid ?? 0, tab.currency)}</strong>
        </div>
      </div>
      {tab.summary.pendingTotal > 0 && (
        <p className="tab-pending">
          {money(tab.summary.pendingTotal, tab.currency)} in shared orders is
          awaiting confirmation and is excluded from totals.
        </p>
      )}
      {!tab.closedAt && (
        <form
          className="social-form quick-order"
          onSubmit={(e) => void addOrder(e)}
        >
          <h3>{editingId ? "Edit your order" : "Add an order"}</h3>
          <div className="form-columns">
            <label>
              What did you order?
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Amsterdam beer"
              />
            </label>
            <label>
              {split === "OWN" ? "Unit price" : "Total price"}
              <input
                inputMode="decimal"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="200.00"
              />
            </label>
          </div>
          <div className="form-columns">
            <label>
              Quantity
              <input
                type="number"
                min={1}
                max={100}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                required
              />
            </label>
            <label>
              Who’s sharing?
              <select
                value={split}
                disabled={!!editingId}
                onChange={(e) => setSplit(e.target.value as typeof split)}
              >
                <option value="OWN">Just me</option>
                <option value="EQUAL">Split equally</option>
                <option value="QUANTITY">By quantity</option>
                <option value="CUSTOM">Custom amounts</option>
              </select>
            </label>
          </div>
          {split !== "OWN" && (
            <fieldset className="participant-options">
              <legend>Ask these people to confirm their shares</legend>
              {tab.state.participants.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    disabled={p.id === userId}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, p.id]
                          : old.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <span>{person(p.id)}</span>
                  {split !== "EQUAL" && selected.includes(p.id) && (
                    <input
                      aria-label={`${person(p.id)} ${split === "QUANTITY" ? "quantity" : "amount"}`}
                      inputMode={split === "QUANTITY" ? "numeric" : "decimal"}
                      placeholder={split === "QUANTITY" ? "Quantity" : "Amount"}
                      value={weights[p.id] ?? ""}
                      onChange={(e) =>
                        setWeights((old) => ({
                          ...old,
                          [p.id]: e.target.value,
                        }))
                      }
                    />
                  )}
                </label>
              ))}
            </fieldset>
          )}
          <Button
            variant="primary"
            type="submit"
            loading={pending}
            disabled={!!failed}
          >
            <Plus size={16} />
            {editingId
              ? "Save order"
              : split === "OWN"
                ? "Add my order"
                : "Propose shared order"}
          </Button>
          {editingId && (
            <Button disabled={disabled} onClick={() => setEditingId(null)}>
              Cancel edit
            </Button>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {!!failed && (
        <Button
          disabled={pending}
          onClick={() => void update({ kind: "CLOSE", confirm: true }, failed)}
        >
          Retry update safely
        </Button>
      )}
      <section>
        <h3>Orders</h3>
        {!tab.state.orders.length && (
          <div className="feature-empty">
            <Receipt size={28} />
            <p>Your first order starts the tab.</p>
          </div>
        )}
        <div className="tab-orders">
          {tab.state.orders.map((order) => {
            const allocation = order.allocations.find(
              (a) => a.userId === userId,
            );
            return (
              <article
                key={order.id}
                className="tab-order"
                data-cancelled={order.status === "CANCELLED"}
              >
                <div>
                  <strong>
                    {order.quantity} × {order.name}
                  </strong>
                  <small>
                    {person(order.authorId)} ·{" "}
                    {order.allocations.length > 1
                      ? `${order.allocations.length} sharing`
                      : "Individual"}{" "}
                    · {order.status.toLowerCase()}
                  </small>
                </div>
                <strong>{money(order.total, tab.currency)}</strong>
                {order.status !== "CANCELLED" && (
                  <div className="order-allocations">
                    {order.allocations.map((a) => (
                      <span key={a.userId}>
                        {person(a.userId)} {money(a.amount, tab.currency)}{" "}
                        {a.accepted ? "✓" : "· pending"}
                      </span>
                    ))}
                  </div>
                )}
                {!tab.closedAt &&
                  order.status === "PROPOSED" &&
                  allocation &&
                  !allocation.accepted && (
                    <div className="feature-actions">
                      <Button
                        disabled={disabled}
                        onClick={() =>
                          void update({
                            kind: "ACCEPT_ORDER",
                            orderId: order.id,
                            accept: true,
                          })
                        }
                      >
                        <Check size={16} />
                        Confirm my share
                      </Button>
                      <Button
                        disabled={disabled}
                        onClick={() =>
                          void update({
                            kind: "ACCEPT_ORDER",
                            orderId: order.id,
                            accept: false,
                          })
                        }
                      >
                        Decline shared order
                      </Button>
                    </div>
                  )}
                {!tab.closedAt &&
                  order.authorId === userId &&
                  order.status !== "CANCELLED" && (
                    <div className="feature-actions">
                      {order.allocations.length === 1 &&
                        order.status === "CONFIRMED" && (
                          <Button
                            disabled={disabled}
                            onClick={() => {
                              setEditingId(order.id);
                              setName(order.name);
                              setPrice((order.unitPrice / 100).toFixed(2));
                              setQuantity(order.quantity);
                              setSplit("OWN");
                              document
                                .querySelector(".quick-order")
                                ?.scrollIntoView({
                                  block: "nearest",
                                  behavior: "instant",
                                });
                            }}
                          >
                            Edit my order
                          </Button>
                        )}
                      {order.allocations.length === 1 && (
                        <Button
                          disabled={disabled}
                          onClick={() =>
                            void update({
                              kind: "ORDER",
                              name: order.name,
                              unitPrice: order.unitPrice,
                              quantity: order.quantity,
                              split: "OWN",
                              allocations: [{ userId }],
                            })
                          }
                        >
                          <RotateCcw size={15} />
                          Same again
                        </Button>
                      )}
                      {(order.status === "PROPOSED" ||
                        order.allocations.length === 1) && (
                        <Button
                          disabled={disabled}
                          onClick={() =>
                            void update({
                              kind: "CANCEL_ORDER",
                              orderId: order.id,
                            })
                          }
                        >
                          Remove order
                        </Button>
                      )}
                    </div>
                  )}
              </article>
            );
          })}
        </div>
      </section>
      <section className="tab-summary">
        <h3>Everyone’s total</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Consumed</th>
                <th>Paid venue</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {tab.summary.people.map((p) => (
                <tr key={p.userId}>
                  <th>{person(p.userId)}</th>
                  <td>{money(p.consumed, tab.currency)}</td>
                  <td>{money(p.paid, tab.currency)}</td>
                  <td>
                    {p.balance > 0
                      ? `${money(p.balance, tab.currency)} to pay`
                      : p.balance < 0
                        ? `${money(-p.balance, tab.currency)} to receive`
                        : "Even"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="supporting-copy">
          Consumption and payments are separate. Balances include confirmed
          repayments.
        </p>
      </section>
      {!tab.closedAt && (
        <PaymentForm
          remaining={tab.summary.total - tab.summary.paidTotal}
          currency={tab.currency}
          disabled={disabled}
          onPay={(amount) => void update({ kind: "PAYMENT", amount })}
        />
      )}
      {tab.state.payments.length > 0 && (
        <section>
          <h3>Venue payments</h3>
          {tab.state.payments.map((p) => (
            <div className="ledger-row" key={p.id}>
              <span>
                {person(p.userId)} paid {money(p.amount, tab.currency)}
              </span>
              {!tab.closedAt && p.userId === userId && (
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void update({ kind: "CANCEL_PAYMENT", paymentId: p.id })
                  }
                >
                  Undo payment record
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {tab.summary.transfers.length > 0 && (
        <section>
          <h3>Suggested repayments</h3>
          <p className="supporting-copy">
            Tracking only. Merkat never charges or transfers money.
          </p>
          {tab.summary.transfers.map((transfer) => (
            <div className="ledger-row" key={`${transfer.from}:${transfer.to}`}>
              <span>
                {person(transfer.from)} → {person(transfer.to)}{" "}
                <strong>{money(transfer.amount, tab.currency)}</strong>
              </span>
              {transfer.from === userId && (
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void update({
                      kind: "SETTLE",
                      to: transfer.to,
                      amount: transfer.amount,
                    })
                  }
                >
                  I’ve repaid this
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {tab.state.settlements.map((s) => (
        <div key={s.id} className="ledger-row">
          <span>
            {person(s.from)} repaid {person(s.to)}{" "}
            {money(s.amount, tab.currency)} ·{" "}
            {s.confirmed ? "Confirmed" : "Awaiting recipient confirmation"}
          </span>
          {s.to === userId && !s.confirmed && (
            <Button
              disabled={disabled}
              onClick={() =>
                void update({ kind: "CONFIRM_SETTLEMENT", settlementId: s.id })
              }
            >
              Confirm received
            </Button>
          )}
        </div>
      ))}
      {!tab.closedAt && tab.canManage && (
        <section className="tab-close">
          <Button disabled={disabled} onClick={() => setConfirmClose(true)}>
            Review & close tab
          </Button>
          {confirmClose && (
            <div className="confirmation-panel">
              <h3>Close {tab.title}?</h3>
              <p>
                Final consumption: {money(tab.summary.total, tab.currency)}.
                Venue payments: {money(tab.summary.paidTotal, tab.currency)}.
              </p>
              <p>
                {tab.summary.pendingTotal
                  ? "Resolve or cancel pending shared orders before closing."
                  : "Orders will be locked and a final snapshot kept in this chat. Repayments can still be confirmed."}
              </p>
              <Button
                disabled={disabled || tab.summary.pendingTotal > 0}
                onClick={() => {
                  setConfirmClose(false);
                  void update({ kind: "CLOSE", confirm: true });
                }}
              >
                Confirm closure
              </Button>
              <Button onClick={() => setConfirmClose(false)}>Keep open</Button>
            </div>
          )}
        </section>
      )}
      {tab.state.snapshot && (
        <details>
          <summary>Original closing snapshot</summary>
          <p>
            Consumption {money(tab.state.snapshot.total, tab.currency)} · Venue
            payments {money(tab.state.snapshot.paidTotal, tab.currency)}
          </p>
          {tab.state.snapshot.people.map((p) => (
            <p key={p.userId}>
              {person(p.userId)} consumed {money(p.consumed, tab.currency)} and
              paid {money(p.paid, tab.currency)}
            </p>
          ))}
        </details>
      )}
      <details>
        <summary>Session history</summary>
        <ol className="tab-audit">
          {tab.state.audit.map((entry) => (
            <li key={entry.id}>
              <strong>
                {person(entry.actorId)} ·{" "}
                {entry.action.toLowerCase().replaceAll("_", " ")}
              </strong>
              <time dateTime={entry.at}>
                {new Date(entry.at).toLocaleString()}
              </time>
              {entry.details && (
                <p>{auditDescription(entry.details, tab.currency)}</p>
              )}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
function auditDescription(raw: string, currency: string) {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.name === "string" &&
      typeof value.quantity === "number" &&
      typeof value.unitPrice === "number"
    )
      return `${value.quantity} × ${value.name} · ${money(typeof value.total === "number" ? value.total : value.unitPrice * value.quantity, currency)}`;
    if (typeof value.amount === "number") return money(value.amount, currency);
    if (typeof value.accept === "boolean")
      return value.accept ? "Share confirmed" : "Proposal cancelled";
    return "Recorded in the session history.";
  } catch {
    return "Recorded in the session history.";
  }
}
function PaymentForm({
  remaining,
  currency,
  disabled,
  onPay,
}: {
  remaining: number;
  currency: string;
  disabled: boolean;
  onPay: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      className="social-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const value = parseMoneyInput(amount);
          if (value > remaining)
            throw new Error("That exceeds the unpaid venue total.");
          setError("");
          onPay(value);
        } catch (error) {
          setError(
            error instanceof Error ? error.message : "Check the amount.",
          );
        }
      }}
    >
      <h3>Paid the venue?</h3>
      <p className="supporting-copy">
        Record what you paid, separately from what you ordered.{" "}
        {money(Math.max(0, remaining), currency)} is not yet recorded as paid.
      </p>
      <div className="feature-actions">
        <input
          inputMode="decimal"
          aria-label="Amount you paid the venue"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <Button type="submit" disabled={disabled || remaining <= 0}>
          Record my payment
        </Button>
      </div>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
    </form>
  );
}
