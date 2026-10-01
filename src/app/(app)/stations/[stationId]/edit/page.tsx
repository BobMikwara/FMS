import { userCanAccessStation } from "@/server/auth/authorization";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { getOrganization } from "@/server/db/repo/core";
import { getStation } from "@/server/db/repo/stations";
import { PageHeader } from "@/components/ui/layout";
import { StationForm } from "../../new/station-form";

export const dynamic = "force-dynamic";

export default async function EditStationPage({ params }: { params: Promise<{ stationId: string }> }) {
  const { stationId } = await params;
  const user = await getCurrentUser();
  if (!user) return null;

  const station = (await getStation(stationId));
  if (!station || station.organizationId !== user.organizationId || !userCanAccessStation(user, stationId)) notFound();

  const organization = (await getOrganization(user.organizationId));

  return (
    <div className="space-y-5">
      <PageHeader title="Edit station" description={`${station.name} · ${station.code}`} />
      <StationForm
        defaultCurrency={organization?.currency ?? "TZS"}
        defaultCountry={station.country}
        station={{
          id: station.id,
          name: station.name,
          code: station.code,
          address: station.address,
          city: station.city,
          region: station.region,
          country: station.country,
          phone: station.phone,
          email: station.email,
          latitude: station.latitude,
          longitude: station.longitude,
          openingTime: station.openingTime,
          closingTime: station.closingTime,
          notes: station.notes,
          currency: station.currency,
          volumeUnit: station.volumeUnit,
        }}
      />
    </div>
  );
}
