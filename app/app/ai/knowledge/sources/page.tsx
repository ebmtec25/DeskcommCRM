import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Compatibilidade: esta tela geral virou aba do agente (`?tab=conhecimento`
 * em `/app/ai/agents/[id]`) — a gestão por agente é o que o dado sempre
 * permitiu (`ai_knowledge_sources.agent_id` é obrigatório, com UNIQUE por
 * agente+tipo), mas a tela antiga só enxergava o default da org, então um
 * agente não-default nunca conseguia ter a própria base. Ficam de pé, sem
 * precisar mudar: os CTAs de `EvolutionGaps`, o script `qa-wave-09.ts` e o
 * spec `olhar-telas-do-epico.spec.ts` — todos apontam pra esta rota e seguem
 * o redirect até o destino de verdade.
 */
export default async function KnowledgeSourcesRedirectPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data: agent } = await supabase
    .from("ai_agents")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_default", true)
    .maybeSingle();

  if (!agent) {
    return (
      <div className="flex h-full flex-col gap-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Fontes de Conhecimento</h1>
          <p className="text-sm text-muted-foreground">
            Configure as fontes de RAG do agent default da organização.
          </p>
        </header>
        <div className="rounded-lg border border-border bg-surface p-6 text-sm">
          <p className="mb-4">
            Nenhum agent default encontrado. Crie um agent default em{" "}
            <span className="font-mono">/app/ai/agents</span> primeiro.
          </p>
          <Button asChild variant="primary" size="sm">
            <Link href="/app/ai/agents">Ir para Agents</Link>
          </Button>
        </div>
      </div>
    );
  }

  redirect(`/app/ai/agents/${agent.id}?tab=conhecimento`);
}
