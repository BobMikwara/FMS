const assert = require("node:assert/strict");
const test = require("node:test");

const { formatAxisTick, niceAxis } = require("../src/lib/chart-axis.ts");

test("rounds the axis up to a whole number of round steps", () => {
  assert.deepEqual(niceAxis(611.4), { max: 800, step: 200, ticks: [0, 200, 400, 600, 800] });
  assert.deepEqual(niceAxis(1204.9), { max: 1500, step: 500, ticks: [0, 500, 1000, 1500] });
  assert.deepEqual(niceAxis(10318.3), { max: 15000, step: 5000, ticks: [0, 5000, 10000, 15000] });
  assert.deepEqual(niceAxis(100), { max: 100, step: 25, ticks: [0, 25, 50, 75, 100] });
});

test("the largest value always fits under the top of the axis", () => {
  for (const value of [0.3, 1, 7.9, 8.9, 99, 250, 999.9, 4321, 123456]) {
    const axis = niceAxis(value);
    assert.ok(axis.max >= value, `${value} must fit under ${axis.max}`);
    assert.ok(axis.ticks.length >= 2 && axis.ticks.length <= 6, `${value} gives ${axis.ticks.length} ticks`);
    assert.equal(axis.ticks[0], 0);
    assert.equal(axis.ticks[axis.ticks.length - 1], axis.max);
  }
});

test("an empty or all-zero series still has a usable axis", () => {
  assert.deepEqual(niceAxis(0), { max: 1, step: 1, ticks: [0, 1] });
  assert.deepEqual(niceAxis(Number.NaN), { max: 1, step: 1, ticks: [0, 1] });
});

test("tick labels use thousands separators and decimals only when needed", () => {
  assert.equal(formatAxisTick(0), "0");
  assert.equal(formatAxisTick(15000), "15,000");
  assert.equal(formatAxisTick(2.5), "2.5");
});
