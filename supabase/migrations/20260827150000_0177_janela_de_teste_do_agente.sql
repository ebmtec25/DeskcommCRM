-- ============================================================================
-- 0177 — JANELA DE TESTE DO AGENTE, COM MEMÓRIA E RESET.
--
-- O painel "Testar agente" (`/api/v1/ai/agents/:id/versions/:vid/test`) já
-- roda o runtime real em dry-run, mas cada clique era uma conversa NOVA:
-- `ai_agent_runs.conversation_id` nasce sempre null nesse caminho (de
-- propósito — o dry-run nunca toca `contacts`/`conversations`/`messages`
-- reais), e o runtime só carrega histórico quando `conversation_id` existe.
-- Resultado: dava pra testar "essa mensagem isolada", não "essa conversa de
-- 5 turnos fica coerente".
--
-- O pedido foi uma janela de conversa DE TESTE, com memória entre mensagens
-- e um jeito de resetar. Isso não pode reaproveitar `conversations`/
-- `messages` (viraria lead de teste no funil real, e quebraria o invariante
-- documentado da rota de teste). Precisa de duas tabelas isoladas, no mesmo
-- espírito de `ai_document_files` (child 1:N, RLS só de SELECT porque toda
-- escrita passa pelo admin client da rota).
--
-- Duas tabelas: uma linha de "conversa de teste" por (versão, quem testa) —
-- `unique(agent_version_id, created_by)` é o que faz "voltar à mesma tela"
-- continuar a MESMA conversa em vez de criar outra a cada visita — e as
-- mensagens dela, com `organization_id` duplicado direto na filha (mesmo
-- padrão que `messages` já usa: RLS mais simples, sem exigir join na policy).
-- ============================================================================

create table if not exists public.ai_agent_test_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  agent_version_id uuid not null references public.ai_agent_versions(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,

  sample_contact_name text,
  sample_contact_phone text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ai_agent_test_conversations_one_per_version_user
    unique (agent_version_id, created_by)
);

create index if not exists ai_agent_test_conversations_org_idx
  on public.ai_agent_test_conversations (organization_id);

comment on table public.ai_agent_test_conversations is
  'Uma "conversa de teste" persistente por (versão do agente, admin que testa). Nunca toca '
  'contacts/conversations/messages reais — é o que dá memória ao painel "Testar agente" sem '
  'o teste vazar para o funil de leads de verdade. Resetar = apagar esta linha (cascade nas '
  'mensagens).';

create table if not exists public.ai_agent_test_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  test_conversation_id uuid not null references public.ai_agent_test_conversations(id) on delete cascade,

  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tool_calls jsonb,
  guardrails jsonb,

  created_at timestamptz not null default now()
);

-- A tela: mensagens de uma conversa de teste, em ordem.
create index if not exists ai_agent_test_messages_conv_idx
  on public.ai_agent_test_messages (test_conversation_id, created_at);

create index if not exists ai_agent_test_messages_org_idx
  on public.ai_agent_test_messages (organization_id);

comment on table public.ai_agent_test_messages is
  'Turnos de uma ai_agent_test_conversations. O histórico completo fica aqui SEMPRE (nunca '
  'trimado) — a janela deslizante (history_message_window/history_token_window da versão) só '
  'decide o que entra no PRÓXIMO prompt, não o que a tela mostra.';

alter table public.ai_agent_test_conversations enable row level security;
alter table public.ai_agent_test_messages enable row level security;

-- Só SELECT, de propósito (mesmo racional da 0176 / ai_document_files): toda
-- escrita (criar conversa de teste, mandar mensagem, resetar) passa pelo
-- admin client da rota `/api/v1/ai/agents/:id/versions/:vid/test*`, que já é
-- admin-only via requireRole() e filtra organization_id manualmente. Não
-- existe caminho de INSERT/UPDATE/DELETE direto do browser via PostgREST
-- para estas tabelas — uma policy `for all` sem gate de papel entraria na
-- dívida vigiada por tests/invariants/rbac-config-ia-canais.test.ts sem
-- necessidade nenhuma.
drop policy if exists "tenant_isolation_ai_agent_test_conversations_all" on public.ai_agent_test_conversations;
drop policy if exists "tenant_isolation_ai_agent_test_conversations_select" on public.ai_agent_test_conversations;
create policy "tenant_isolation_ai_agent_test_conversations_select" on public.ai_agent_test_conversations
  for select
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "tenant_isolation_ai_agent_test_messages_all" on public.ai_agent_test_messages;
drop policy if exists "tenant_isolation_ai_agent_test_messages_select" on public.ai_agent_test_messages;
create policy "tenant_isolation_ai_agent_test_messages_select" on public.ai_agent_test_messages
  for select
  using (organization_id in (select public.fn_user_org_ids()));

revoke all on public.ai_agent_test_conversations from anon;
revoke all on public.ai_agent_test_messages from anon;

drop trigger if exists trg_ai_agent_test_conversations_updated_at on public.ai_agent_test_conversations;
create trigger trg_ai_agent_test_conversations_updated_at
  before update on public.ai_agent_test_conversations
  for each row execute function public.fn_set_updated_at();

notify pgrst, 'reload schema';
