import assert from "node:assert/strict";
import { test } from "node:test";
import { rollDice } from "../src/tools.ts";

test("骰子表达式解析：d100 / 2d6 / 3d8+2", () => {
  const always1 = () => 0;
  const alwaysMax = () => 0.999999;

  const d100 = rollDice("d100", always1);
  assert.deepEqual(d100?.rolls, [1]);
  assert.equal(d100?.total, 1);

  const twoD6 = rollDice("2d6", alwaysMax);
  assert.deepEqual(twoD6?.rolls, [6, 6]);
  assert.equal(twoD6?.total, 12);
  assert.ok(twoD6?.text.includes("6+6 = 12"));

  const withModifier = rollDice("3d8+2", always1);
  assert.deepEqual(withModifier?.rolls, [1, 1, 1]);
  assert.equal(withModifier?.total, 5);

  const negative = rollDice("2d6-1", alwaysMax);
  assert.equal(negative?.total, 11);
});

test("骰子表达式容错：空格、大小写、上限、非法输入", () => {
  assert.equal(rollDice(" 2 D 6 ", () => 0)?.total, 2);
  assert.equal(rollDice("D6", () => 0)?.total, 1);
  assert.equal(rollDice("0d6"), undefined);
  assert.equal(rollDice("21d6"), undefined, "超过单次骰子上限");
  assert.equal(rollDice("d1"), undefined, "面数下限为 2");
  assert.equal(rollDice("d1001"), undefined, "面数上限为 1000");
  assert.equal(rollDice("d6+"), undefined);
  assert.equal(rollDice("abc"), undefined);
});
