import { stationScopeForUser } from "@/server/auth/authorization";
import { getReport } from "@/server/db/repo/reports";
import { buildReportTable, reportStationIsAllowed, resolveReportTimeZone } from "@/server/services/report-builder";
import { formatDateTimeInTimeZone } from "@/server/services/time-zone";
import { toCsv } from "@/lib/export";
import { audit, jsonError, notFound, withPermission } from "@/server/api/route";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  csv: "text/csv; charset=utf-8",
  excel: "application/vnd.ms-excel; charset=utf-8",
  pdf: "text/html; charset=utf-8",
};

const EXTENSION: Record<string, string> = {
  csv: "csv",
  excel: "xls",
  pdf: "html",
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Streams a generated report file. The dataset is built from the same read
 * models the application uses, so the download always matches what the preview
 * showed. Excel output uses SpreadsheetML so it opens natively in Excel,
 * LibreOffice and Google Sheets without a server-side rendering engine.
 */
export const GET = withPermission("reports.export", async (request, ctx) => {
  try {
    const report = (await getReport(ctx.params?.reportId ?? ""));
    if (!report || report.organizationId !== ctx.user.organizationId || !reportStationIsAllowed(report, stationScopeForUser(ctx.user))) return jsonError(notFound(), request);

    const requested = new URL(request.url).searchParams.get("format") ?? report.format;
    const format = MIME[requested] ? requested : "csv";
    const [table, timeZone] = await Promise.all([
      buildReportTable(report, stationScopeForUser(ctx.user)),
      resolveReportTimeZone(report),
    ]);

    const filename = `${report.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "report"}-${report.id}.${EXTENSION[format]}`;
    let body: string;

    if (format === "csv") {
      body = toCsv(table.headers, table.rows);
    } else if (format === "excel") {
      const cells = table.headers.map((header) => `<Cell><Data ss:Type="String">${escapeHtml(header)}</Data></Cell>`).join("");
      const rows = table.rows
        .map(
          (row) =>
            `<Row>${row
              .map((cell) => `<Cell><Data ss:Type="String">${escapeHtml(cell)}</Data></Cell>`)
              .join("")}</Row>`,
        )
        .join("");
      body = [
        '<?xml version="1.0"?>',
        '<?mso-application progid="Excel.Sheet"?>',
        '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
        `<Worksheet ss:Name="${escape(report.category)}"><Table><Row>${cells}</Row>${rows}</Table></Worksheet>`,
        "</Workbook>",
      ].join("");
    } else {
      // PDF is served as a print-ready HTML document the browser can save as PDF.
      body = [
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
    }

    (await audit({
      user: ctx.user,
      action: "exported",
      entity: "report",
      entityId: report.id,
      entityLabel: report.title,
      summary: `${ctx.user.name} exported report "${report.title}" as ${format.toUpperCase()}`,
      next: { format, rows: table.rows.length },
      request,
    }));

    return new Response(body, {
      headers: {
        "content-type": MIME[format],
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error as Error, request);
  }
});
