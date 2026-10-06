import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Set your SmartFuel password" };

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string | string[]; mode?: string | string[] }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] ?? "" : params.token ?? "";
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode = rawMode === "activate" ? "activate" : "reset";
  return <ResetPasswordForm token={token} mode={mode} />;
}
