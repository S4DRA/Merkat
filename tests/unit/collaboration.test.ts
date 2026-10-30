import assert from "node:assert/strict";
import { test } from "node:test";
import { splitMinorUnits, tabSummary } from "@merkat/backend";
import {
  parseMoneyInput,
  zonedDateTimeToIso,
  type TabState,
} from "@merkat/contracts";
import sharp from "sharp";
import { normalizeAvatar } from "../../apps/web/src/lib/server/profile-image.js";
function state(): TabState {
  return {
    participants: ["a", "b", "c"].map((id) => ({
      id,
      displayName: id,
      username: id,
    })),
    orders: [],
    payments: [],
    settlements: [],
    audit: [],
    submissions: {},
    snapshot: null,
  };
}
test("beer and shared-shot example distinguishes consumption from venue payments", () => {
  const s = state();
  s.orders = [
    {
      id: "beer-a",
      authorId: "a",
      name: "Beer",
      unitPrice: 20000,
      quantity: 1,
      total: 20000,
      status: "CONFIRMED",
      createdAt: "",
      allocations: [{ userId: "a", amount: 20000, accepted: true }],
    },
    {
      id: "beer-b",
      authorId: "b",
      name: "Beer",
      unitPrice: 25000,
      quantity: 1,
      total: 25000,
      status: "CONFIRMED",
      createdAt: "",
      allocations: [{ userId: "b", amount: 25000, accepted: true }],
    },
    {
      id: "shots",
      authorId: "a",
      name: "Six shots",
      unitPrice: 15000,
      quantity: 6,
      total: 90000,
      status: "CONFIRMED",
      createdAt: "",
      allocations: splitMinorUnits(
        90000,
        ["a", "b", "c"].map((userId) => ({ userId, weight: 1 })),
      ).map((a) => ({ ...a, accepted: true })),
    },
  ];
  s.payments = [{ id: "venue", userId: "a", amount: 135000, createdAt: "" }];
  const summary = tabSummary(s);
  assert.equal(summary.total, 135000);
  assert.deepEqual(
    summary.people.map((p) => p.consumed),
    [50000, 55000, 30000],
  );
  assert.deepEqual(summary.transfers, [
    { from: "b", to: "a", amount: 55000 },
    { from: "c", to: "a", amount: 30000 },
  ]);
  assert.equal(
    summary.people.reduce((sum, p) => sum + p.balance, 0),
    0,
  );
  s.settlements.push({
    id: "repayment",
    from: "b",
    to: "a",
    amount: 55000,
    confirmed: true,
  });
  assert.deepEqual(tabSummary(s).transfers, [
    { from: "c", to: "a", amount: 30000 },
  ]);
});
test("unconfirmed shared allocations never become financial obligations", () => {
  const s = state();
  s.orders = [
    {
      id: "x",
      authorId: "a",
      name: "Shots",
      unitPrice: 10000,
      quantity: 3,
      total: 30000,
      status: "PROPOSED",
      createdAt: "",
      allocations: [
        { userId: "a", amount: 10000, accepted: true },
        { userId: "b", amount: 10000, accepted: false },
        { userId: "c", amount: 10000, accepted: false },
      ],
    },
  ];
  assert.equal(tabSummary(s).total, 0);
  assert.equal(tabSummary(s).pendingTotal, 30000);
  assert.deepEqual(
    tabSummary(s).people.map((p) => p.balance),
    [0, 0, 0],
  );
  s.orders[0]!.status = "CANCELLED";
  assert.equal(tabSummary(s).pendingTotal, 0);
});
test("minor-unit remainder allocation is stable and exactly reconciles", () => {
  const split = splitMinorUnits(10001, [
    { userId: "c", weight: 1 },
    { userId: "a", weight: 1 },
    { userId: "b", weight: 1 },
  ]);
  assert.deepEqual(
    split.map((p) => [p.userId, p.amount]),
    [
      ["a", 3334],
      ["b", 3334],
      ["c", 3333],
    ],
  );
  assert.equal(
    split.reduce((sum, p) => sum + p.amount, 0),
    10001,
  );
});
test("quantity allocation uses explicit weights", () => {
  assert.deepEqual(
    splitMinorUnits(90000, [
      { userId: "a", weight: 2 },
      { userId: "b", weight: 3 },
      { userId: "c", weight: 1 },
    ]).map((a) => a.amount),
    [30000, 45000, 15000],
  );
  assert.throws(() =>
    splitMinorUnits(10, [
      { userId: "a", weight: 1 },
      { userId: "a", weight: 1 },
    ]),
  );
  assert.throws(() => splitMinorUnits(10, [{ userId: "a", weight: 0 }]));
});
test("money input accepts decimal comma without floating-point calculations", () => {
  assert.equal(parseMoneyInput("200,50"), 20050);
  assert.equal(parseMoneyInput("0.1"), 10);
  for (const invalid of ["0", "-1", "1.001", "NaN", "1e4", ""])
    assert.throws(() => parseMoneyInput(invalid));
});
test("timezone conversion rejects missing and ambiguous DST wall times", () => {
  assert.equal(
    zonedDateTimeToIso("2026-10-30T20:30", "Europe/Istanbul"),
    "2026-10-30T17:30:00.000Z",
  );
  assert.throws(
    () => zonedDateTimeToIso("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  );
  assert.throws(
    () => zonedDateTimeToIso("2026-11-01T01:30", "America/New_York"),
    /occurs twice/,
  );
  assert.throws(() =>
    zonedDateTimeToIso("2026-02-30T14:00", "Europe/Istanbul"),
  );
});
test("PNG and JPEG avatars decode, normalize and lose metadata", async () => {
  for (const format of ["png", "jpeg"] as const) {
    const original = await sharp({
      create: { width: 24, height: 12, channels: 3, background: "orange" },
    })
      [format]()
      .toBuffer();
    const result = await normalizeAvatar(
      original,
      format === "png" ? "image/png" : "image/jpeg",
    );
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
    assert.equal(metadata.exif, undefined);
    assert.ok(result.length <= 524288);
  }
});
test("avatar content checks reject renamed files, invalid data and oversized inputs", async () => {
  await assert.rejects(normalizeAvatar(Buffer.from("not a png"), "image/png"));
  await assert.rejects(
    normalizeAvatar(new Uint8Array(2_000_001), "image/jpeg"),
  );
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "black" },
  })
    .png()
    .toBuffer();
  await assert.rejects(normalizeAvatar(png, "image/jpeg"));
});
