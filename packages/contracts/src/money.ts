export function parseMoneyInput(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized))
    throw new Error("Use a price with at most two decimals.");
  const [major, minor = ""] = normalized.split(".");
  const amount = Number(major) * 100 + Number(minor.padEnd(2, "0"));
  if (amount < 1 || amount > 100_000_000)
    throw new Error("Enter a price between 0.01 and 1,000,000.");
  return amount;
}
