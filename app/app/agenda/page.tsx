import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { AgendaList } from "./_components/AgendaList";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
        <p className="text-sm text-muted-foreground">
          Os compromissos marcados com os leads, org inteira, mais próximo primeiro.
        </p>
      </header>
      <AgendaList />
    </div>
  );
}
