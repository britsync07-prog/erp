import Link from "next/link";
import { requireSession } from "@/server/auth/permissions";
import { listNotifications } from "@/server/services/platformRead";
import { PageHeader, Card, StatusPill, Pagination, EmptyState } from "@/components/ui";
import { InlineAction } from "@/components/client";
import { markNotificationReadAction, markAllNotificationsReadAction } from "@/server/actions/platform";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({ searchParams }: { searchParams?: Promise<{ page?: string }> }) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const data = await listNotifications(session.orgId, session, page);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Info, actions required, warnings and critical alerts — each links to its record."
        actions={<InlineAction action={markAllNotificationsReadAction}>Mark all read</InlineAction>}
      />
      {data.items.length === 0 ? (
        <EmptyState title="All clear." hint="New operational alerts will appear here." />
      ) : (
        <>
          <div className="space-y-2">
            {data.items.map((n) => (
              <Card key={n.id} className={n.isRead ? "opacity-70" : ""}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusPill value={n.severity} />
                    <p className="font-medium">{n.title}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-xs text-slate-400">{n.createdAt.toLocaleString("en-IE")}</span>
                    {n.link && <Link href={n.link} className="font-medium text-indigo-700 hover:underline">Open →</Link>}
                    {!n.isRead && <InlineAction action={markNotificationReadAction} args={[n.id]}>Mark read</InlineAction>}
                  </div>
                </div>
                {n.body && <p className="mt-1 text-sm text-slate-600">{n.body}</p>}
              </Card>
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} base="/notifications" />
        </>
      )}
    </>
  );
}
