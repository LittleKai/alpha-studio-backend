import test from "node:test";
import assert from "node:assert/strict";
import { validateExpression, validateTemplateStructure } from "./templateValidator.js";

test("template validator accepts strict equality aliases", () => {
  assert.equal(validateExpression("{{style.hand === 'right'}}"), true);
  assert.equal(validateExpression("{{style.hand !== 'right'}}"), true);
});

test("template validator rejects ternary and assignment expressions", () => {
  assert.equal(validateExpression("{{style.hand === 'right' ? width - 10 : 8}}"), false);
  assert.equal(validateExpression("{{width = 50}}"), false);
});

test("template validator accepts known material color tokens", () => {
  const result = validateTemplateStructure({
    id: "material-token-test",
    category: "other",
    params: {},
    boxes: [
      { x: 0, y: 0, z: 0, w: 10, h: 10, d: 10, faces: { front: "$metal", right: "$stone", left: "$plantGreen", top: "$ledWarm" } }
    ]
  });
  assert.equal(result.valid, true);
});

test("template validator rejects unknown color tokens", () => {
  const result = validateTemplateStructure({
    id: "bad-token-test",
    category: "other",
    params: {},
    boxes: [
      { x: 0, y: 0, z: 0, w: 10, h: 10, d: 10, faces: { front: "$notARealToken" } }
    ]
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /Unknown color token/);
});
