import { Sparkles } from "lucide-react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { AppNav } from "@/components/app-nav";
import { LogoutButton } from "@/components/client-bits";
import { db, schema } from "@/db";
import { requireOwner } from "@/server/session";

export default async function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const me = await requireOwner();
  const [tenant] = await db.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, me.tenantId));

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="border-b bg-background md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 p-3 md:block md:p-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-teal-700 text-white">
              <Sparkles className="size-4" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">CleaningHub</span>
              <span className="block text-xs text-muted-foreground">{tenant?.name}</span>
            </span>
          </Link>
          <LogoutButton className="md:hidden" />
        </div>
        <div className="px-3 pb-3 md:px-3">
          <AppNav />
        </div>
        <div className="hidden px-4 md:absolute md:bottom-4 md:block">
          <p className="mb-1 text-xs text-muted-foreground">{me.name}</p>
          <LogoutButton className="-ml-2" />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
