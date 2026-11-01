import { CalendarDays, Clock, Sparkles } from "lucide-react";
import Link from "next/link";
import { LogoutButton } from "@/components/client-bits";
import { requireUser } from "@/server/session";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-1 flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
        <Link href="/ma" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-teal-700 text-white">
            <Sparkles className="size-4" />
          </span>
          <span className="text-sm font-semibold">Hallo {me.name.split(" ")[0]}</span>
        </Link>
        <LogoutButton />
      </header>
      <main className="flex-1 p-4 pb-24">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-lg border-t bg-background">
        <Link href="/ma" className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium">
          <CalendarDays className="size-5" /> Einsätze
        </Link>
        <Link href="/ma/zeiten" className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium">
          <Clock className="size-5" /> Meine Stunden
        </Link>
      </nav>
    </div>
  );
}
