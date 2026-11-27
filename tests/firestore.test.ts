// The REST Firestore facade (src/lib/firestore.ts): values survive an encode/decode round trip in Firestore's wire format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode, Timestamp } from "../src/lib/firestore.ts";

test("values round-trip through Firestore's wire format", () => {
  const value = { n: 3, f: 2.5, s: "x", b: true, z: null, arr: [1, "two"], nested: { deep: { ok: true } }, at: new Date(1700000000123) };
  const back = decode(encode(value));
  assert.deepEqual(back, { ...value, at: Timestamp.fromMillis(1700000000123) });
  assert.equal(encode(3).integerValue, "3");
  assert.equal(encode(2.5).doubleValue, 2.5);
});

test("Timestamp keeps milliseconds and matches admin's toMillis", () => {
  const ts = Timestamp.fromMillis(1700000000123);
  assert.equal(ts.toMillis(), 1700000000123);
  assert.equal(ts.toDate().getTime(), 1700000000123);
});
