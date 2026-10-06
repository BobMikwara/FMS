import { toCsv } from "@/lib/export";
import type { Report } from "../domain/types";
import { buildReportTable, resolveReportTimeZone } from "./report-builder";
import { formatDateTimeInTimeZone } from "./time-zone";

export interface ReportExportFile {
  filename: string;
  contentType: string;
  content: string;
  format: string;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "report";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatReportTable(
  report: Report,
  table: { headers: string[]; rows: unknown[][] },
  timeZone: string,
  requestedFormat: string,
): ReportExportFile {
  const format = ["csv", "excel", "pdf"].includes(requestedFormat) ? requestedFormat : "csv";
  const baseName = `${safeFilename(report.title)}-${report.id}`;
  if (format === "csv") {
    return {
      filename: `${baseName}.csv`,
      contentType: "text/csv; charset=utf-8",
      content: toCsv(table.headers, table.rows),
      format,
    };
  }
  if (format === "excel") {
    const cells = table.headers.map((header) => `<Cell><Data ss:Type="String">${escapeHtml(header)}</Data></Cell>`).join("");
    const rows = table.rows
      .map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeHtml(cell)}</Data></Cell>`).join("")}</Row>`)
      .join("");
    return {
      filename: `${baseName}.xls`,
      contentType: "application/vnd.ms-excel; charset=utf-8",
      content: [
        '<?xml version="1.0"?>',
        '<?mso-application progid="Excel.Sheet"?>',
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
        `<Worksheet ss:Name="${escapeHtml(report.category)}"><Table><Row>${cells}</Row>${rows}</Table></Worksheet>`,
        "</Workbook>",
      ].join(""),
      format,
    };
  }

  const content = [
    "<!doctype html><html><head><meta charset='utf-8'><title>",
    escapeHtml(report.title),
    "</title><style>body{font:14px/1.5 system-ui,sans-serif;padding:32px;color:#111}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:12px}th{background:#f5f5f5}h1{font-size:22px}p{color:#555}</style></head><body>",
    `<h1>${escapeHtml(report.title)}</h1>`,
    `<p>${escapeHtml(report.period)} · ${escapeHtml(formatDateTimeInTimeZone(report.dateFrom, timeZone))} to ${escapeHtml(formatDateTimeInTimeZone(report.dateTo, timeZone))} (${escapeHtml(timeZone)}) · category ${escapeHtml(report.category)}</p>`,
    "<table><thead><tr>",
    table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join(""),
    "</tr></thead><tbody>",
    table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join(""),
    "</tbody></table></body></html>",
  ].join("");
  return {
    filename: `${baseName}.html`,
    contentType: "text/html; charset=utf-8",
    content,
    format,
  };
}

export async function buildReportExport(report: Report, format = report.format): Promise<ReportExportFile> {
  const [table, timeZone] = await Promise.all([
    buildReportTable(report),
    resolveReportTimeZone(report),
  ]);
  return formatReportTable(report, table, timeZone, format);
}
