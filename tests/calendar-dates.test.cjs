const assert = require("node:assert/strict");
const test = require("node:test");

const {
  addDays,
  dateKeysBetween,
  daysBetween,
  formatDateKey,
  formatDateKeyWithWeekday,
  mondayOf,
  parseDateKey,
  startOfLocalDay,
  weekdayOf,
} = require("../src/lib/calendar-dates.ts");

test("adds days across month, year and leap-day boundaries", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-10-01", "2026-10-06"), 5);
  assert.equal(daysBetween("2026-10-06", "2026-10-01"), -5);
  assert.deepEqual(dateKeysBetween("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
});

test("only real calendar dates are accepted", () => {
  assert.deepEqual(parseDateKey("2026-10-06"), { year: 2026, month: 10, day: 6 });
  for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-10-32", "26-10-06", "2026/10/06", "", null, undefined]) {
    assert.equal(parseDateKey(bad), null, String(bad));
  }
});

test("finds weekdays and the Monday that starts a week", () => {
  assert.equal(weekdayOf("2026-10-06"), 2, "Tuesday");
  assert.equal(mondayOf("2026-10-06"), "2026-10-05");
  assert.equal(mondayOf("2026-10-05"), "2026-10-05", "a Monday starts its own week");
  assert.equal(mondayOf("2026-10-04"), "2026-09-28", "a Sunday belongs to the week that began the Monday before");
});

test("formats dates the way the app writes them", () => {
  assert.equal(formatDateKey("2026-10-06"), "06 Oct 2026");
  assert.equal(formatDateKeyWithWeekday("2026-10-06"), "Tue 06 Oct 2026");
  assert.equal(formatDateKey("not a date"), "not a date");
});

test("a local day starts at midnight in its own zone, including zones more than 12 hours from UTC", () => {
  const start = (date, zone) => startOfLocalDay(date, zone).toISOString();
  assert.equal(start("2026-10-06", "Africa/Dar_es_Salaam"), "2026-10-05T21:00:00.000Z");
  assert.equal(start("2026-10-06", "UTC"), "2026-10-06T00:00:00.000Z");
  assert.equal(start("2026-10-06", "Asia/Kolkata"), "2026-10-05T18:30:00.000Z");
  assert.equal(start("2026-10-06", "Pacific/Kiritimati"), "2026-10-05T10:00:00.000Z", "UTC+14");
  assert.equal(start("2026-10-06", "Pacific/Pago_Pago"), "2026-10-06T11:00:00.000Z", "UTC-11");
  assert.equal(start("2026-03-08", "America/New_York"), "2026-03-08T05:00:00.000Z", "before the clocks go forward");
  assert.equal(start("2026-03-09", "America/New_York"), "2026-03-09T04:00:00.000Z", "after the clocks go forward");
});
