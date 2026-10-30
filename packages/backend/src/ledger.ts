import type { TabAllocation, TabState, TabSummary } from "@merkat/contracts";

export function splitMinorUnits(
  total: number,
  shares: { userId: string; weight: number }[],
): TabAllocation[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    !shares.length ||
    shares.length > 100 ||
    new Set(shares.map((s) => s.userId)).size !== shares.length ||
    shares.some((s) => !Number.isSafeInteger(s.weight) || s.weight < 1)
  )
    throw new Error("INVALID_SPLIT");
  const denominator = shares.reduce((sum, s) => sum + BigInt(s.weight), 0n);
  const rows = shares
    .map((s) => {
      const numerator = BigInt(total) * BigInt(s.weight);
      return {
        userId: s.userId,
        amount: Number(numerator / denominator),
        remainder: numerator % denominator,
        accepted: false,
      };
    })
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.userId.localeCompare(b.userId)
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  let remaining = total - rows.reduce((sum, s) => sum + s.amount, 0);
  for (const row of rows)
    if (remaining > 0) {
      row.amount++;
      remaining--;
    }
  return rows
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map(({ userId, amount, accepted }) => ({ userId, amount, accepted }));
}
export function tabSummary(state: TabState): TabSummary {
  const people = state.participants.map((p) => ({
    userId: p.id,
    consumed: 0,
    paid: 0,
    balance: 0,
  }));
  const index = new Map(people.map((p) => [p.userId, p]));
  let total = 0,
    pendingTotal = 0,
    paidTotal = 0;
  for (const order of state.orders) {
    if (order.status === "PROPOSED") pendingTotal += order.total;
    if (order.status !== "CONFIRMED") continue;
    if (
      order.allocations.reduce((sum, a) => sum + a.amount, 0) !== order.total ||
      order.allocations.some((a) => !a.accepted || !index.has(a.userId))
    )
      throw new Error("INVALID_LEDGER");
    total += order.total;
    for (const a of order.allocations)
      index.get(a.userId)!.consumed += a.amount;
  }
  for (const payment of state.payments) {
    const p = index.get(payment.userId);
    if (!p) throw new Error("INVALID_LEDGER");
    p.paid += payment.amount;
    paidTotal += payment.amount;
  }
  for (const p of people) p.balance = p.consumed - p.paid;
  for (const s of state.settlements)
    if (s.confirmed) {
      index.get(s.from)!.balance -= s.amount;
      index.get(s.to)!.balance += s.amount;
    }
  const debtors = people
    .filter((p) => p.balance > 0)
    .map((p) => ({ id: p.userId, amount: p.balance }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const creditors = people
    .filter((p) => p.balance < 0)
    .map((p) => ({ id: p.userId, amount: -p.balance }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const transfers: TabSummary["transfers"] = [];
  for (const debtor of debtors)
    for (const creditor of creditors) {
      const amount = Math.min(debtor.amount, creditor.amount);
      if (amount) {
        transfers.push({ from: debtor.id, to: creditor.id, amount });
        debtor.amount -= amount;
        creditor.amount -= amount;
      }
    }
  return { total, pendingTotal, paidTotal, people, transfers };
}
export function parseMinorUnits(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized))
    throw new Error("Use a price with at most two decimals.");
  const [major, minor = ""] = normalized.split(".");
  const result = Number(major) * 100 + Number(minor.padEnd(2, "0"));
  if (result < 1 || result > 100_000_000)
    throw new Error("Enter a price between 0.01 and 1,000,000.");
  return result;
}
