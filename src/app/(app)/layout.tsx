import { requireSession } from "@/server/auth/permissions";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  return <Shell user={user}>{children}</Shell>;
}
