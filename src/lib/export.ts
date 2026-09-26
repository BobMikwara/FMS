/**
 * Client-side export helpers.
 *
 * CSV and Excel exports are generated in the browser from the rows already on
 * screen, so an export never blocks the server and never sends more data than
 * the user can already see. The Excel export uses a minimal SpreadsheetML
 * worksheet that opens natively in Excel, LibreOffice and Google Sheets.
 */

function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(escapeCsv).join(","), ...rows.map((row) => row.map(escapeCsv).join(","))].join("\r\n");
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const csv = toCsv(headers, rows);
  // The BOM makes Excel honour UTF-8.
  downloadBlob(filename, new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
}

/** Escapes XML text and strips control characters Excel rejects. */
function xmlEscape(value: unknown): string {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnLetter(index: number): string {
  let letter = "";
  let remaining = index;
  while (remaining >= 0) {
    letter = String.fromCharCode((remaining % 26) + 65) + letter;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return letter;
}

export function downloadExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: unknown[][],
): void {
  const lastColumn = columnLetter(Math.max(0, headers.length - 1));
  const headerCells = headers
    .map(
      (header, columnIndex) =>
        `<Cell r="${columnLetter(columnIndex)}1" ss:StyleID="sHeader"><Data ss:Type="String">${xmlEscape(header)}</Data></Cell>`,
    )
    .join("");

  const bodyRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .slice(0, headers.length)
        .map((value: unknown, columnIndex: number) => {
          const numeric = typeof value === "number" && Number.isFinite(value);
          return `<Cell r="${columnLetter(columnIndex)}${rowIndex + 2}"${
            numeric ? ' ss:StyleID="sNumber"' : ""
          }><Data ss:Type="${numeric ? "Number" : "String"}">${xmlEscape(value)}</Data></Cell>`;
        })
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="sHeader"><Font ss:Bold="1"/><Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/></Style>
    <Style ss:ID="sNumber"><NumberFormat ss:Format="#,##0"/></Style>
  </Styles>
  <Worksheet ss:Name="${xmlEscape(sheetName.slice(0, 31))}">
    <Table ss:ExpandedColumnCount="${headers.length}" ss:ExpandedRowCount="${rows.length + 1}">
      <Row ss:Index="1">${headerCells}</Row>
      ${bodyRows}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><SplitHorizontal>1</SplitHorizontal></WorksheetOptions>
  </Worksheet>
</Workbook>`;

  downloadBlob(filename, new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so Safari has time to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Timestamped filename, e.g. `stations-2026-09-25-1527.csv`. */
export function exportFilename(base: string, extension: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${base}-${stamp}.${extension}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
