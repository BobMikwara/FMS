const assert = require("node:assert/strict");
const test = require("node:test");

const { describeFillLevel } = require("../src/lib/tank-fill-level.ts");

const base = {
  volumeLiters: 7424,
  capacityLiters: 15000,
  fillPercent: (7424 / 15000) * 100,
  remainingCapacityLiters: 15000 - 7424,
  coverage: { avgDailyConsumption: 135.4, daysRemaining: 13.26 },
};

test("reads a tank with a current reading the way the card shows it", () => {
  const display = describeFillLevel(base);
  assert.equal(display.hasReading, true);
  assert.equal(display.percent, "49.5%");
  assert.equal(display.volume, "7,424 L of 15,000 L");
  assert.equal(display.free, "7,576 L");
  assert.deepEqual(display.coverage, { value: "13.3 days", hint: "135 L/day average" });
});

test("formats large tanks with thousands separators", () => {
  const display = describeFillLevel({
    ...base,
    volumeLiters: 74250,
    capacityLiters: 150000,
    fillPercent: 49.5,
    remainingCapacityLiters: 75750,
  });
  assert.equal(display.volume, "74,250 L of 150,000 L");
  assert.equal(display.free, "75,750 L");
});

test("says so plainly when a tank has no reading yet instead of showing zeros", () => {
  const display = describeFillLevel({ ...base, volumeLiters: null, fillPercent: 0, remainingCapacityLiters: 15000 });
  assert.equal(display.hasReading, false);
  assert.equal(display.percent, "Not available");
  assert.equal(display.volume, "Awaiting first reading");
  assert.equal(display.free, "Not available");
});

test("stock coverage stays honest when consumption or days remaining are unknown", () => {
  const noConsumption = describeFillLevel({ ...base, coverage: { avgDailyConsumption: 0, daysRemaining: null } });
  assert.deepEqual(noConsumption.coverage, { value: "Not available", hint: "No consumption recorded yet" });
});

test("hides stock coverage entirely when the viewer cannot see consumption data", () => {
  assert.equal(describeFillLevel({ ...base, coverage: null }).coverage, null);
});

test("rounds the fill percent to one decimal and litres to whole numbers", () => {
  const display = describeFillLevel({ ...base, volumeLiters: 7424.6, fillPercent: 49.4973, remainingCapacityLiters: 7575.4 });
  assert.equal(display.percent, "49.5%");
  assert.equal(display.volume, "7,425 L of 15,000 L");
  assert.equal(display.free, "7,575 L");
});
