import test from "node:test";
import assert from "node:assert/strict";
import { defaultKeyName, validateKeyName } from "../mcp/auth-contract.mjs";

test("generated Key names satisfy MetaSo's actual 20-unit limit", () => {
  const names = Array.from({ length: 100 }, defaultKeyName);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) { assert.equal(name.length, 19); assert.equal(validateKeyName(name), name); }
  assert.equal(validateKeyName("  Codex验证0923  "), "Codex验证0923");
  assert.equal(validateKeyName("🙂".repeat(10)).length, 20);
  for (const name of ["x".repeat(21), "🙂".repeat(11), "", "line\nnext", "x\u200by", `mk-${"a".repeat(16)}`]) {
    assert.throws(() => validateKeyName(name), { code: "INVALID_KEY_NAME" });
  }
});
