import { getCurrentUser } from "@/server/auth/session";
import { getOrganization } from "@/server/db/repo/core";
import { StationForm } from "./station-form";

export const dynamic = "force-dynamic";

export default async function NewStationPage() {
  const user = await getCurrentUser();
  const organization = user ? (await getOrganization(user.organizationId)) : null;
  return (
    <StationForm
      defaultCurrency={organization?.currency ?? "TZS"}
      defaultCountry={"Tanzania"}
    />
  );
}
