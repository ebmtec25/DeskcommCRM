"use client";
/**
 * Tabs do detalhe de agent. Wave 12 (S-13.12) entrega Test, Runs e History.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentForm, type ChannelSessionLite } from "./AgentForm";
import type { CoberturaPorFunil } from "./FunisDoAgente";
import type { FunilDaResposta } from "@/hooks/pipelines/usePipelines";
import { TestPanel } from "./TestPanel";
import { RunsTable } from "./RunsTable";
import { UsoDasCapacidades } from "./UsoDasCapacidades";
import { VersionHistory } from "./VersionHistory";
import { ProposalsPanel } from "./ProposalsPanel";
import { KnowledgeSourcesClient } from "@/components/ai/KnowledgeSourcesClient";
import type { AgentRow } from "@/hooks/ai/useAgent";
import type { AgentVersionRow } from "@/hooks/ai/useAgentVersions";
import type { CredentialRow } from "@/hooks/ai/useCredentials";
import type { SourceRow } from "@/hooks/ai/useKnowledgeSources";

const TAB_VALUES = [
  "configuration",
  "test",
  "capacidades",
  "conhecimento",
  "runs",
  "history",
  "proposals",
] as const;
type TabValue = (typeof TAB_VALUES)[number];

function tabInicial(param: string | null): TabValue {
  return (TAB_VALUES as readonly string[]).includes(param ?? "") ? (param as TabValue) : "configuration";
}

interface Props {
  /** Funis da org, para a marcação de escopo do agente (spec 17 passo 3). */
  funis?: FunilDaResposta[];
  cobertura?: CoberturaPorFunil;
  agent: AgentRow;
  draft: AgentVersionRow | null;
  published: AgentVersionRow | null;
  /** De onde o formulário se hidrata — ver `lib/ai/agents/versoes-da-tela.ts`. */
  base?: AgentVersionRow | null;
  /** Rascunho anterior à publicada: existe, mas não abre nem publica. */
  draftObsoleto?: AgentVersionRow | null;
  versions: AgentVersionRow[];
  credentials: CredentialRow[];
  /** Provedores cuja chave veio na instalação — ver `AgentForm`. */
  provedoresDaInstalacao?: string[];
  channelSessions: ChannelSessionLite[];
  routerMembership?: { routerId: string; routerName: string } | null;
  /** Fontes de RAG deste agente — ver `docs/runbooks` sobre a migração da tela geral. */
  knowledgeSources: SourceRow[];
  readOnly?: boolean;
}

export function AgentTabs(props: Props) {
  // `?tab=conhecimento` é o que sustenta o link de compatibilidade da antiga
  // tela geral `/app/ai/knowledge/sources` (agora um redirect pra cá) e os CTAs
  // de `EvolutionGaps` — sem isto, o link levaria pro agente mas sempre abriria
  // em "Configuração", obrigando um segundo clique pra achar o que o link prometia.
  const searchParams = useSearchParams();
  const [tab, setTab] = React.useState<TabValue>(() => tabInicial(searchParams.get("tab")));
  const hasVersion = !!(props.draft || props.published);

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as typeof tab)}
      className="flex flex-col gap-4"
    >
      <TabsList>
        <TabsTrigger value="configuration">Configuração</TabsTrigger>
        <TabsTrigger value="test" disabled={!hasVersion}>
          Teste
        </TabsTrigger>
        <TabsTrigger value="capacidades">Capacidades</TabsTrigger>
        <TabsTrigger value="conhecimento">Conhecimento</TabsTrigger>
        <TabsTrigger value="runs">Execuções</TabsTrigger>
        <TabsTrigger value="history">Histórico</TabsTrigger>
        <TabsTrigger value="proposals">Propostas</TabsTrigger>
      </TabsList>

      <TabsContent value="configuration" className="m-0">
        <AgentForm
          mode="edit"
          agent={props.agent}
          draft={props.draft}
          published={props.published}
          base={props.base}
          draftObsoleto={props.draftObsoleto}
          credentials={props.credentials}
          provedoresDaInstalacao={props.provedoresDaInstalacao}
          channelSessions={props.channelSessions}
          funis={props.funis}
          cobertura={props.cobertura}
          routerMembership={props.routerMembership}
          readOnly={props.readOnly}
        />
      </TabsContent>

      <TabsContent value="test" className="m-0">
        <TestPanel
          agent={props.agent}
          draft={props.draft}
          published={props.published}
          readOnly={props.readOnly}
        />
      </TabsContent>

      <TabsContent value="capacidades" className="m-0">
        <UsoDasCapacidades agentId={props.agent.id} active={tab === "capacidades"} />
      </TabsContent>

      <TabsContent value="conhecimento" className="m-0">
        <KnowledgeSourcesClient agentId={props.agent.id} initialSources={props.knowledgeSources} />
      </TabsContent>

      <TabsContent value="runs" className="m-0">
        <RunsTable agentId={props.agent.id} active={tab === "runs"} />
      </TabsContent>

      <TabsContent value="proposals" className="m-0">
        <ProposalsPanel
          agentId={props.agent.id}
          active={tab === "proposals"}
          readOnly={props.readOnly}
        />
      </TabsContent>

      <TabsContent value="history" className="m-0">
        <VersionHistory
          agentId={props.agent.id}
          versions={props.versions}
          readOnly={props.readOnly}
        />
      </TabsContent>
    </Tabs>
  );
}
