import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { listAuditLogs } from "@/server/db/repo/core";
import { PageHeader, Notice } from "@/components/ui/layout";
import { AuditLogBrowser } from "./audit-log-browser";

export const dynamic = "force-dynamic";

export default async function AuditLogsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const logs = listAuditLogs({ orgId: user.organizationId, pageSize: 500 }).rows;

  const rows = logs.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entity,
    entityId: log.entityId,
    entityLabel: log.entityLabel,
    actorName: log.userLabel,
    actorEmail: "",
    ipAddress: log.ip,
    createdAt: log.ts,
    metadata: log.summary,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Every write action across this organization, newest first. Entries are append-only and cannot be edited or deleted from the interface."
        breadcrumbs={[{ label: "Administration" }, { label: "Audit log" }]}
      />

      <Notice tone="info" title="What is recorded">
        Sign-ins, permission changes, tank and device edits, alert acknowledgements, report generation, export downloads
        and integration changes. Each entry captures the acting user, their IP address and the affected record.
      </Notice>

      <AuditLogBrowser initialRows={rows} />
    </div>
  );
}
