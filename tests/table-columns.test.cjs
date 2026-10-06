const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ACTIONS_COLUMN_LABEL,
  actionsColumn,
  canHideColumn,
  columnWidth,
  humanizeKey,
  mobileColumnsOf,
  resolveColumnLabel,
  resolveColumns,
  tableMinWidth,
  toggleHiddenColumn,
  visibleColumnsOf,
} = require("../src/lib/table-columns.ts");

const cell = () => null;

// A realistic Tanks-style definition, including the historically unlabeled last column.
const tankColumns = () => [
  { key: "name", header: "Tank", cell },
  { key: "level", header: "Measured volume", cell },
  { key: "status", header: "Status", cell },
  { key: "lastReading", header: "Last reading", hideOnMobile: true, cell },
  { key: "temp", header: "Temp", numeric: true, hideOnMobile: true, cell },
  { key: "actions", header: "", cell },
];

test("humanizeKey turns identifiers into readable labels", () => {
  assert.equal(humanizeKey("lastReading"), "Last reading");
  assert.equal(humanizeKey("created_at"), "Created at");
  assert.equal(humanizeKey("status"), "Status");
  assert.equal(humanizeKey(""), "Column");
});

test("a blank heading is never produced: actions fall back to 'Actions', others to their key", () => {
  assert.equal(resolveColumnLabel({ key: "actions", header: "" }), "Actions");
  assert.equal(resolveColumnLabel({ key: "row-menu", header: "  ", kind: "actions" }), "Actions");
  assert.equal(resolveColumnLabel({ key: "lastReading", header: "" }), "Last reading");
  assert.equal(resolveColumnLabel({ key: "lastReading", header: undefined }), "Last reading");
  assert.equal(resolveColumnLabel({ key: "name", header: "  Tank  " }), "Tank");
});

test("actionsColumn is a labelled, non-sortable column of kind 'actions'", () => {
  const column = actionsColumn(cell, { width: "20%", minWidth: 150 });
  assert.equal(column.key, "actions");
  assert.equal(column.header, ACTIONS_COLUMN_LABEL);
  assert.equal(column.kind, "actions");
  assert.equal(column.width, "20%");
  assert.equal(column.minWidth, 150);
  const [resolved] = resolveColumns([{ ...column, sortable: true }]);
  assert.equal(resolved.sortable, false);
});

test("resolveColumns gives every column a kind and a non-empty label, keeping explicit labels untouched", () => {
  const resolved = resolveColumns(tankColumns());
  assert.deepEqual(
    resolved.map((column) => column.header),
    ["Tank", "Measured volume", "Status", "Last reading", "Temp", "Actions"],
  );
  assert.ok(resolved.every((column) => column.header.trim().length > 0));
  assert.equal(resolved.at(-1).kind, "actions");
  assert.equal(resolved[0].kind, "data");
});

test("menu labels and table headings come from the same resolved definitions", () => {
  const resolved = resolveColumns(tankColumns());
  const menuLabels = resolved.map((column) => column.header);
  const headings = visibleColumnsOf(resolved, []).map((column) => column.header);
  assert.deepEqual(headings, menuLabels);
});

test("switching a column off removes exactly that column and keeps the order", () => {
  const resolved = resolveColumns(tankColumns());
  const visible = visibleColumnsOf(resolved, ["status", "actions"]);
  assert.deepEqual(
    visible.map((column) => column.key),
    ["name", "level", "lastReading", "temp"],
  );
  // Unknown (stale) keys are ignored rather than breaking the table.
  assert.equal(visibleColumnsOf(resolved, ["no-such-column"]).length, resolved.length);
});

test("the Actions column can be toggled off and back on", () => {
  const keys = resolveColumns(tankColumns()).map((column) => column.key);
  const off = toggleHiddenColumn([], "actions", keys);
  assert.deepEqual(off, ["actions"]);
  const on = toggleHiddenColumn(off, "actions", keys);
  assert.deepEqual(on, []);
});

test("the last visible column cannot be switched off", () => {
  const keys = ["a", "b", "c"];
  let hidden = [];
  hidden = toggleHiddenColumn(hidden, "a", keys);
  hidden = toggleHiddenColumn(hidden, "b", keys);
  assert.deepEqual(hidden, ["a", "b"]);
  assert.equal(canHideColumn(hidden, "c", keys), false);
  assert.deepEqual(toggleHiddenColumn(hidden, "c", keys), ["a", "b"]);
  // A hidden column can always be restored.
  assert.equal(canHideColumn(hidden, "a", keys), true);
  assert.deepEqual(toggleHiddenColumn(hidden, "a", keys), ["b"]);
});

test("stale hidden keys do not stop the remaining columns from being hidden correctly", () => {
  const keys = ["a", "b"];
  // "gone" no longer exists in the definitions (for example after a permission change).
  assert.deepEqual(toggleHiddenColumn(["gone"], "a", keys), ["gone", "a"]);
  assert.equal(canHideColumn(["gone", "a"], "b", keys), false);
});

test("columnWidth prefers an explicit width, then the minimum, otherwise nothing", () => {
  assert.equal(columnWidth({ width: "22%", minWidth: 200 }), "22%");
  assert.equal(columnWidth({ minWidth: 200 }), "200px");
  assert.equal(columnWidth({}), undefined);
});

test("tableMinWidth is opt-in and sums visible columns", () => {
  assert.equal(tableMinWidth([{ key: "a", header: "A", cell }]), undefined);
  const columns = [
    { key: "a", header: "A", minWidth: 100, cell },
    { key: "b", header: "B", minWidth: 150, cell },
    { key: "c", header: "C", cell },
  ];
  assert.equal(tableMinWidth(columns), 100 + 150 + 96);
  assert.equal(tableMinWidth(columns, 36), 100 + 150 + 96 + 36);
  assert.equal(tableMinWidth(columns.slice(0, 2)), 250);
});

test("mobile cards drop secondary columns, keep Actions, and are never empty", () => {
  const resolved = resolveColumns(tankColumns());
  assert.deepEqual(
    mobileColumnsOf(resolved).map((column) => column.key),
    ["name", "level", "status", "actions"],
  );
  // Only secondary data columns left: fall back to showing everything that is on.
  const secondaryOnly = visibleColumnsOf(resolved, ["name", "level", "status", "actions"]);
  assert.deepEqual(
    mobileColumnsOf(secondaryOnly).map((column) => column.key),
    ["lastReading", "temp"],
  );
});
