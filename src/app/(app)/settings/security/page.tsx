import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/layout";
import { getCurrentUser } from "@/server/auth/session";
import { getUserMfaStatus } from "@/server/db/repo/security";
import { MfaSettings } from "./mfa-settings";

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const mfa = await getUserMfaStatus(user.id);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Account security"
        description="Manage authenticator sign-in and recovery codes for your own account."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Account security" }]}
      />
      <MfaSettings initialEnabled={mfa.enabled} initialRecoveryCodesRemaining={mfa.recoveryCodesRemaining} />
    </div>
  );
}
