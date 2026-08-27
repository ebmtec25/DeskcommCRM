-- ============================================================================
-- 0176 — BIBLIOTECA DE DOCUMENTOS NA BASE DE CONHECIMENTO.
--
-- O card "Política" (`ai_knowledge_sources.source_type = 'policy'`) já tinha
-- upload de arquivo funcionando de ponta a ponta no backend — bucket privado
-- `ai-policy`, extração de PDF/Markdown, chunking — mas o endpoint sempre
-- tratou UM arquivo como A fonte inteira: cada upload novo substituiria o
-- anterior, e o botão de upload no frontend nunca chegou a ser ligado (ficou
-- como stub, "em breve").
--
-- O que foi pedido é uma BIBLIOTECA: vários arquivos acumulados sob a mesma
-- fonte, cada um enviado, listado e removido individualmente — upload
-- ACRESCENTA, não substitui. Isso não cabe no modelo atual (uma linha de
-- `ai_knowledge_sources` = um arquivo); precisa de tabela filha 1:N, no mesmo
-- padrão que `ai_faq_items` já usa para os itens de FAQ colados à mão.
--
-- Por que não reaproveitar `ai_faq_items`: ela modela pares pergunta/resposta
-- (texto colado), não arquivo binário com blob no Storage, extração que pode
-- falhar DEPOIS do upload (arquivo corrompido, blob removido manualmente) e
-- contagem de chunks por unidade de upload. Os dois convivem sob a MESMA
-- fonte (`knowledge_source_id`) quando fizer sentido, mas são conteúdos de
-- natureza diferente.
--
-- `status`/`error` existem porque a extração pode falhar em dois momentos
-- distintos: na validação do upload (aí o endpoint recusa e nem grava a
-- linha) e DEPOIS, na reindexação assíncrona (o worker lê o blob nesse
-- momento — se ele sumiu ou o PDF corrompeu entre o upload e a reindexação, o
-- arquivo individual fica `failed` sem derrubar os demais).
--
-- Sem `unique(knowledge_source_id, filename)` de propósito: é biblioteca,
-- nomes duplicados são caso normal (duas versões do mesmo manual, por
-- exemplo) — cada upload é uma linha própria com seu próprio `blob_path`.
--
-- `ext` com CHECK fechado (`pdf`,`md`) é seguro aqui: campo novo, sem dado
-- legado de clone nenhum — mesmo padrão de conjunto pequeno e controlado que
-- `ai_knowledge_sources_source_type_check` já usa.
-- ============================================================================

create table if not exists public.ai_document_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  knowledge_source_id uuid not null references public.ai_knowledge_sources(id) on delete cascade,

  filename text not null,
  blob_path text not null,
  ext text not null check (ext in ('pdf', 'md')),
  mime_type text not null,
  size_bytes integer not null,

  status text not null default 'ready' check (status in ('ready', 'failed')),
  error text,
  chunk_count integer not null default 0,

  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A lista da tela: arquivos de uma fonte, mais recente primeiro.
create index if not exists ai_document_files_source_idx
  on public.ai_document_files (knowledge_source_id, created_at desc);

-- Suporte a query por org direto (auditoria/depuração cross-fonte).
create index if not exists ai_document_files_org_idx
  on public.ai_document_files (organization_id);

comment on table public.ai_document_files is
  'Biblioteca de arquivos (PDF/Markdown) que compõem UMA fonte ai_knowledge_sources tipo policy. '
  'Upload acrescenta; remoção individual apaga a linha + o blob e reindexa sem aquele arquivo.';
comment on column public.ai_document_files.status is
  'ready = extraído/chunkado com sucesso na validação de upload; failed = a reindexação não '
  'conseguiu ler este arquivo depois (blob sumiu, PDF corrompido). error carrega o motivo.';

alter table public.ai_document_files enable row level security;

-- Só SELECT, de propósito: toda escrita (upload/remoção) passa pelo admin
-- client nos endpoints, que bypassa RLS e filtra organization_id manualmente
-- (doutrina do CLAUDE.md) — não existe caminho de INSERT/UPDATE/DELETE direto
-- do browser via PostgREST para esta tabela. Uma policy `for all` sem gate de
-- papel entraria na dívida de RBAC vigiada por
-- tests/invariants/rbac-config-ia-canais.test.ts ("nenhuma tabela NOVA entra
-- com policy ALL só-tenancy") sem necessidade nenhuma — o SELECT já é o único
-- acesso real que existe.
drop policy if exists "tenant_isolation_ai_document_files_all" on public.ai_document_files;
drop policy if exists "tenant_isolation_ai_document_files_select" on public.ai_document_files;
create policy "tenant_isolation_ai_document_files_select" on public.ai_document_files
  for select
  using (organization_id in (select public.fn_user_org_ids()));

drop trigger if exists trg_ai_document_files_updated_at on public.ai_document_files;
create trigger trg_ai_document_files_updated_at
  before update on public.ai_document_files
  for each row execute function public.fn_set_updated_at();

notify pgrst, 'reload schema';
