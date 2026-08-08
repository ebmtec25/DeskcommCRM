import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { PerdidosList } from "./_components/PerdidosList";

export const dynamic = "force-dynamic";

export default async function PerdidosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Perdidos</h1>
        <p className="text-sm text-muted-foreground">
          Negócios arquivados — saíram do Kanban, mas ficam aqui pra remarketing: filtre por
          motivo, valor ou data.
        </p>
      </header>
      <PerdidosList />
    </div>
  );
}
