const assert = require("node:assert/strict");
const test = require("node:test");

const { MAX_USAGE_RANGE_DAYS, buildUsageReport, parseUsagePreset, resolveUsageRange } = require("../src/lib/tank-usage.ts");
const { formatDateKey, parseDateKey } = require("../src/lib/calendar-dates.ts");
const { bucketTickLabel, bucketTitle, formatPeriod } = require("../src/lib/tank-usage-labels.ts");

// Tuesday 06 Oct 2026, 15:49 in Dar es Salaam (UTC+3, no daylight saving).
const NOW = new Date("2026-10-06T12:49:00Z");
const ZONE = "Africa/Dar_es_Salaam";
const LONG_AGO = "2026-09-06T12:00:00Z";

function range(preset, extra = {}, now = NOW, zone = ZONE) {
  const result = resolveUsageRange({ preset, ...extra }, now, zone);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.range;
}
const rejected = (request, now = NOW, zone = ZONE) => {
  const result = resolveUsageRange(request, now, zone);
  assert.equal(result.ok, false);
  return result.error;
};
const sumOf = (buckets) => buckets.reduce((total, bucket) => total + bucket.volume, 0);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

/* -------------------------------------------------------------------------- */
/* Range resolution                                                            */
/* -------------------------------------------------------------------------- */

test("Today runs from local midnight to now and is charted hourly", () => {
  const today = range("today");
  assert.equal(today.startDate, "2026-10-06");
  assert.equal(today.endDate, "2026-10-06");
  assert.equal(today.from, "2026-10-05T21:00:00.000Z");
  assert.equal(today.to, NOW.toISOString());
  assert.equal(today.interval, "hour");
});

test("This Week starts on Monday and This Month on the 1st, both charted daily", () => {
  assert.equal(range("week").startDate, "2026-10-05");
  assert.equal(range("week").interval, "day");
  assert.equal(range("week", {}, new Date("2026-10-11T10:00:00Z")).startDate, "2026-10-05", "a Sunday belongs to the week that began on Monday");
  assert.equal(range("week", {}, new Date("2026-10-12T10:00:00Z")).startDate, "2026-10-12", "a Monday starts a new week");
  assert.equal(range("month").startDate, "2026-10-01");
  assert.equal(range("month").interval, "day");
  assert.equal(range("month", {}, new Date("2026-11-01T01:00:00Z")).startDate, "2026-11-01");
});

test("the day boundary follows the tank's time zone, not UTC", () => {
  const justAfterMidnightLocal = new Date("2026-10-05T21:30:00Z");
  assert.equal(range("today", {}, justAfterMidnightLocal).startDate, "2026-10-06");
  assert.equal(range("today", {}, justAfterMidnightLocal, "UTC").startDate, "2026-10-05");
  assert.equal(range("today", {}, NOW, "America/New_York").from, "2026-10-06T04:00:00.000Z");
});

test("Custom Date accepts a period, clamps the end to today and adapts the interval to its length", () => {
  const six = range("custom", { start: "2026-10-01", end: "2026-10-06" });
  assert.deepEqual([six.startDate, six.endDate, six.interval], ["2026-10-01", "2026-10-06", "day"]);
  assert.equal(range("custom", { start: "2026-10-05", end: "2026-10-06" }).interval, "hour");
  assert.equal(range("custom", { start: "2026-10-04", end: "2026-10-06" }).interval, "day");
  assert.equal(range("custom", { start: "2026-08-06", end: "2026-10-06" }).interval, "day", "62 days stays daily");
  assert.equal(range("custom", { start: "2026-08-05", end: "2026-10-06" }).interval, "week", "63 days switches to weekly");
  const future = range("custom", { start: "2026-10-01", end: "2026-12-31" });
  assert.equal(future.endDate, "2026-10-06", "days that have not happened yet are never included");
  assert.equal(future.to, NOW.toISOString());
  const past = range("custom", { start: "2026-09-01", end: "2026-09-03" });
  assert.equal(past.to, "2026-09-03T20:59:59.999Z", "a finished period ends at the end of its last local day");
});

test("Custom Date rejects periods it cannot represent honestly", () => {
  assert.match(rejected({ preset: "custom" }), /both a start date and an end date/);
  assert.match(rejected({ preset: "custom", start: "2026-02-30", end: "2026-03-01" }), /valid dates/);
  assert.match(rejected({ preset: "custom", start: "2026-10-06", end: "2026-10-01" }), /on or after the start/);
  assert.match(rejected({ preset: "custom", start: "2026-10-07", end: "2026-10-08" }), /cannot be in the future/);
  assert.match(rejected({ preset: "custom", start: "2025-01-01", end: "2026-10-06" }), new RegExp(String(MAX_USAGE_RANGE_DAYS)));
  assert.equal(parseUsagePreset("week"), "week");
  assert.equal(parseUsagePreset("fortnight"), null);
  assert.equal(parseDateKey("2028-02-29")?.day, 29);
  assert.equal(parseDateKey("2026-02-29"), null);
});

/* -------------------------------------------------------------------------- */
/* Report: totals, buckets, metrics                                            */
/* -------------------------------------------------------------------------- */

const EVENTS = [
  { ts: "2026-10-01T09:00:00Z", volume: 200 },
  { ts: "2026-10-02T09:00:00Z", volume: 50 },
  { ts: "2026-10-04T09:00:00Z", volume: 300 },
  { ts: "2026-10-05T08:00:00Z", volume: 100 },
  { ts: "2026-10-05T20:59:59Z", volume: 10 }, // 23:59:59 local on the 5th
  { ts: "2026-10-05T21:00:00Z", volume: 20 }, // 00:00:00 local on the 6th
  { ts: "2026-10-06T06:15:00Z", volume: 30.5 },
  { ts: "2026-10-06T06:45:00Z", volume: 40 },
  { ts: "2026-10-06T12:30:00Z", volume: 5 },
];

test("Today: hourly buckets for elapsed hours only, totals exactly the sum of the movements", () => {
  const today = range("today");
  const report = buildUsageReport({ range: today, events: EVENTS, dataStart: LONG_AGO, now: NOW });
  assert.equal(report.hasData, true);
  assert.equal(report.interval, "hour");
  assert.equal(report.buckets.length, 16, "00:00 to 15:00 local, nothing after the current hour");
  assert.equal(report.buckets[0].key, "2026-10-06T00:00");
  assert.equal(report.buckets[15].key, "2026-10-06T15:00");
  const byKey = Object.fromEntries(report.buckets.map((bucket) => [bucket.key, bucket]));
  assert.equal(byKey["2026-10-06T00:00"].volume, 20, "an event at local midnight belongs to the new day");
  near(byKey["2026-10-06T09:00"].volume, 70.5);
  assert.equal(byKey["2026-10-06T09:00"].events, 2);
  assert.equal(byKey["2026-10-06T15:00"].inProgress, true);
  assert.equal(byKey["2026-10-06T14:00"].inProgress, false);
  assert.equal(byKey["2026-10-06T10:00"].volume, 0, "hours without movements are honest zeros");
  near(report.totals.volume, 95.5);
  assert.equal(report.totals.events, 4);
  near(sumOf(report.buckets), report.totals.volume);
});

test("Today's total matches the figure the status card shows for the same movements", () => {
  const todayStart = Date.parse(range("today").from);
  const expected = EVENTS.filter((event) => Date.parse(event.ts) >= todayStart && Date.parse(event.ts) <= NOW.getTime()).reduce(
    (total, event) => total + event.volume,
    0,
  );
  const report = buildUsageReport({ range: range("today"), events: EVENTS, dataStart: LONG_AGO, now: NOW });
  near(report.totals.volume, expected);
});

test("This Week: daily buckets, average and extremes use complete days only", () => {
  const report = buildUsageReport({ range: range("week"), events: EVENTS, dataStart: LONG_AGO, now: NOW });
  assert.deepEqual(
    report.buckets.map((bucket) => [bucket.key, bucket.volume, bucket.inProgress]),
    [
      ["2026-10-05", 110, false],
      ["2026-10-06", 95.5, true],
    ],
  );
  assert.equal(report.metrics.daysRepresented, 2);
  assert.equal(report.metrics.completeDays, 1);
  assert.equal(report.metrics.includesToday, true);
  assert.equal(report.metrics.averagePerDay, 110);
  assert.equal(report.metrics.highest, null, "one complete day cannot have a highest and a lowest");
  assert.equal(report.metrics.lowest, null);
});

test("This Month: zero-usage days count, today's partial day does not skew the average or extremes", () => {
  const report = buildUsageReport({ range: range("month"), events: EVENTS, dataStart: LONG_AGO, now: NOW });
  assert.equal(report.buckets.length, 6);
  assert.equal(report.buckets.find((bucket) => bucket.key === "2026-10-03").volume, 0);
  assert.equal(report.metrics.daysRepresented, 6);
  assert.equal(report.metrics.completeDays, 5);
  near(report.metrics.averagePerDay, (200 + 50 + 0 + 300 + 110) / 5);
  assert.deepEqual(report.metrics.highest, { date: "2026-10-04", volume: 300 });
  assert.deepEqual(report.metrics.lowest, { date: "2026-10-03", volume: 0 });
  near(report.totals.volume, 200 + 50 + 300 + 110 + 95.5);
  near(sumOf(report.buckets), report.totals.volume);
});

test("days before the tank had any data are never invented", () => {
  const events = EVENTS.filter((event) => event.ts >= "2026-10-04");
  const report = buildUsageReport({ range: range("month"), events, dataStart: "2026-10-03T10:00:00Z", now: NOW });
  assert.equal(report.requestedStartDate, "2026-10-01");
  assert.equal(report.startDate, "2026-10-03");
  assert.deepEqual(report.buckets.map((bucket) => bucket.key), ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
  assert.equal(report.metrics.daysRepresented, 4);
  assert.equal(report.metrics.startsPartway, true, "data began part-way through the 3rd");
  assert.equal(report.metrics.completeDays, 2, "only the 4th and 5th are full days of data");
  near(report.metrics.averagePerDay, (300 + 110) / 2);
  assert.deepEqual(report.metrics.highest, { date: "2026-10-04", volume: 300 });
  assert.deepEqual(report.metrics.lowest, { date: "2026-10-05", volume: 110 });
});

test("a period entirely before the tank's history reports no data instead of zeros", () => {
  const report = buildUsageReport({
    range: range("custom", { start: "2026-09-01", end: "2026-09-05" }),
    events: [],
    dataStart: "2026-09-20T08:00:00Z",
    now: NOW,
  });
  assert.equal(report.hasData, false);
  assert.deepEqual(report.buckets, []);
  assert.equal(report.metrics.daysRepresented, 0);
  assert.equal(report.metrics.averagePerDay, null);
  assert.equal(report.totals.volume, 0);
  const brandNew = buildUsageReport({ range: range("today"), events: [], dataStart: null, now: NOW });
  assert.equal(brandNew.hasData, false);
  assert.equal(brandNew.dataStart, null);
});

test("a period with history but no movements shows zeros and still counts its days", () => {
  const report = buildUsageReport({ range: range("week"), events: [], dataStart: LONG_AGO, now: NOW });
  assert.equal(report.hasData, true);
  assert.equal(report.totals.volume, 0);
  assert.equal(report.buckets.length, 2);
  assert.equal(report.metrics.averagePerDay, 0);
});

test("movements outside the period or with unusable values are ignored", () => {
  const report = buildUsageReport({
    range: range("today"),
    events: [
      { ts: "2026-10-05T20:59:59Z", volume: 999 },
      { ts: "2026-10-06T13:00:00Z", volume: 999 },
      { ts: "not a date", volume: 5 },
      { ts: "2026-10-06T07:00:00Z", volume: Number.NaN },
      { ts: "2026-10-06T07:00:00Z", volume: 12 },
    ],
    dataStart: LONG_AGO,
    now: NOW,
  });
  assert.equal(report.totals.volume, 12);
  assert.equal(report.totals.events, 1);
});

test("Custom Date over two days is hourly and spans both days", () => {
  const report = buildUsageReport({
    range: range("custom", { start: "2026-10-05", end: "2026-10-06" }),
    events: EVENTS,
    dataStart: LONG_AGO,
    now: NOW,
  });
  assert.equal(report.interval, "hour");
  assert.equal(report.buckets.length, 24 + 16);
  near(sumOf(report.buckets), report.totals.volume);
  assert.equal(report.buckets.find((bucket) => bucket.key === "2026-10-05T23:00").volume, 10);
});

test("long Custom Date periods are charted weekly with partial weeks at both ends", () => {
  const events = [
    { ts: "2026-07-30T09:00:00Z", volume: 11 },
    { ts: "2026-08-12T09:00:00Z", volume: 22 },
    { ts: "2026-09-30T09:00:00Z", volume: 33 },
    { ts: "2026-10-05T08:00:00Z", volume: 44 },
  ];
  const report = buildUsageReport({
    range: range("custom", { start: "2026-07-29", end: "2026-10-05" }),
    events,
    dataStart: "2026-07-01T00:00:00Z",
    now: NOW,
  });
  assert.equal(report.interval, "week");
  assert.deepEqual([report.buckets[0].key, report.buckets[0].endDate], ["2026-07-29", "2026-08-02"], "the first week starts on the chosen day");
  const last = report.buckets[report.buckets.length - 1];
  assert.deepEqual([last.key, last.endDate, last.volume], ["2026-10-05", "2026-10-05", 44]);
  near(sumOf(report.buckets), 11 + 22 + 33 + 44);
  assert.equal(report.metrics.daysRepresented, 69);
});

test("time zones with half-hour offsets bucket on local hours and days", () => {
  const now = new Date("2026-10-06T12:00:00Z"); // 17:30 in Kolkata
  const today = range("today", {}, now, "Asia/Kolkata");
  assert.equal(today.from, "2026-10-05T18:30:00.000Z");
  const report = buildUsageReport({
    range: today,
    events: [
      { ts: "2026-10-05T18:29:59Z", volume: 7 },
      { ts: "2026-10-05T18:30:00Z", volume: 9 },
      { ts: "2026-10-06T11:45:00Z", volume: 4 },
    ],
    dataStart: LONG_AGO,
    now,
  });
  assert.equal(report.totals.volume, 13);
  assert.equal(report.buckets.length, 18, "00:00 to 17:00 local");
  assert.equal(report.buckets[0].volume, 9);
  assert.equal(report.buckets[17].key, "2026-10-06T17:00");
  assert.equal(report.buckets[17].volume, 4);
});

test("daylight-saving days keep every movement in exactly one bucket", () => {
  const fallNow = new Date("2026-11-02T15:00:00Z");
  const fall = buildUsageReport({
    range: range("custom", { start: "2026-11-01", end: "2026-11-01" }, fallNow, "America/New_York"),
    events: [
      { ts: "2026-11-01T05:30:00Z", volume: 10 }, // 01:30 EDT
      { ts: "2026-11-01T06:30:00Z", volume: 20 }, // 01:30 EST, the repeated hour
    ],
    dataStart: LONG_AGO,
    now: fallNow,
  });
  assert.equal(new Set(fall.buckets.map((bucket) => bucket.key)).size, fall.buckets.length);
  assert.equal(fall.buckets.find((bucket) => bucket.key === "2026-11-01T01:00").volume, 30);
  near(sumOf(fall.buckets), 30);

  const springNow = new Date("2026-03-09T15:00:00Z");
  const spring = buildUsageReport({
    range: range("custom", { start: "2026-03-08", end: "2026-03-08" }, springNow, "America/New_York"),
    events: [{ ts: "2026-03-08T07:30:00Z", volume: 15 }], // 03:30 EDT, the hour after the skipped one
    dataStart: "2026-01-01T00:00:00Z",
    now: springNow,
  });
  assert.equal(spring.buckets.length, 23, "the skipped hour does not exist");
  assert.equal(spring.buckets.some((bucket) => bucket.key === "2026-03-08T02:00"), false);
  assert.equal(spring.buckets.find((bucket) => bucket.key === "2026-03-08T03:00").volume, 15);
});

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

test("labels read as the dates and times operators expect", () => {
  assert.equal(formatDateKey("2026-10-06"), "06 Oct 2026");
  assert.equal(formatPeriod("2026-10-06", "2026-10-06"), "06 Oct 2026");
  assert.equal(formatPeriod("2026-10-01", "2026-10-06"), "01 Oct 2026 to 06 Oct 2026");

  const hour = { key: "2026-10-06T09:00", endDate: "2026-10-06", volume: 0, events: 0, inProgress: false };
  assert.equal(bucketTitle(hour, "hour"), "Tue 06 Oct 2026, 09:00 to 10:00");
  assert.equal(bucketTitle({ ...hour, key: "2026-10-06T23:00", inProgress: true }, "hour"), "Tue 06 Oct 2026, 23:00 to 00:00 (so far)");
  assert.equal(bucketTickLabel(hour, "hour", { count: 16, multiDay: false }), "09:00");
  assert.equal(bucketTickLabel(hour, "hour", { count: 40, multiDay: true }), "Tue 09:00");

  const day = { key: "2026-10-06", endDate: "2026-10-06", volume: 0, events: 0, inProgress: false };
  assert.equal(bucketTickLabel(day, "day", { count: 7, multiDay: true }), "Tue 06");
  assert.equal(bucketTickLabel(day, "day", { count: 31, multiDay: true }), "06 Oct");
  assert.equal(bucketTitle(day, "day"), "Tue 06 Oct 2026");

  const week = { key: "2026-10-05", endDate: "2026-10-11", volume: 0, events: 0, inProgress: false };
  assert.equal(bucketTitle(week, "week"), "Mon 05 Oct 2026 to Sun 11 Oct 2026");
});
