import assert from "node:assert/strict";
import test from "node:test";
import { greetingInputSchema } from "./example.schema.ts";

test("greetingInputSchema accepts a non-empty name", () => {
  assert.deepEqual(greetingInputSchema.parse({ name: "Ada" }), { name: "Ada" });
});

test("greetingInputSchema rejects an empty name", () => {
  assert.equal(greetingInputSchema.safeParse({ name: "" }).success, false);
});
