import test from "node:test";
import assert from "node:assert/strict";
import { validateExpression } from "./templateValidator.js";

test("template validator accepts strict equality aliases", () => {
  assert.equal(validateExpression("{{style.hand === 'right'}}"), true);
  assert.equal(validateExpression("{{style.hand !== 'right'}}"), true);
});

test("template validator rejects ternary and assignment expressions", () => {
  assert.equal(validateExpression("{{style.hand === 'right' ? width - 10 : 8}}"), false);
  assert.equal(validateExpression("{{width = 50}}"), false);
});
