-- 0116 — `crm_lead_appointments`: a agenda do negócio.
--
-- Por que tabela nova e não mais um `type` em `crm_lead_activities`: a timeline
-- é log — registra o que ACONTECEU, uma linha por evento, e não tem conceito de
-- "isto ainda vai acontecer" nem de cancelar algo que já foi escrito. Agendamento
-- é o oposto: uma lista de compromissos FUTUROS que precisa ser consultável
-- ("o que vem essa semana", em `/app/agenda`, org inteira) e mutável (remarcar,
-- cancelar) depois de criada. Forçar isso dentro da timeline faria "cancelar"
-- virar uma segunda linha que anula a primeira — o dado certo, modelado errado.
--
-- O agendamento AINDA emite uma linha em `crm_lead_activities` ao ser criado ou
-- cancelado (emitido pela API, não por trigger — HTTP dentro de trigger é
-- proibido, e aqui nem precisa: é side effect síncrono do mesmo request). A
-- tabela nova é o estado atual; a activity é o rastro de que ele mudou.
--
-- `status` TEM CHECK porque é vocabulário NOSSO (dois valores, fechado), ao
-- contrário de `meta_templates.status` (vocabulário aberto de terceiro).
-- Sem um terceiro estado "concluído": passado + scheduled já significa
-- "aconteceu" sem precisar de um campo que alguém esqueceria de marcar — a
-- tela deriva "próximo" vs. "histórico" comparando scheduled_at com agora.

create table if not exists public.crm_lead_appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  -- Denormalizado do lead, mesmo padrão de crm_lead_activities.contact_id:
  -- listar a agenda por contato (ou mandar lembrete por WhatsApp, futuro) não
  -- pode exigir join até crm_leads toda vez.
  contact_id uuid references public.contacts(id) on delete set null,
  scheduled_at timestamptz not null,
  note text,
  status text not null default 'scheduled',
  -- Sem FK pra auth.users — mesmo padrão de crm_leads.created_by_user_id.
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.crm_lead_appointments
    add constraint crm_lead_appointments_status_check
    check (status in ('scheduled', 'cancelled'));
exception when duplicate_object then null; end $$;

comment on table public.crm_lead_appointments is
  'A agenda do negócio (migration 0116) — compromissos futuros com o lead, consultável em /app/agenda (org inteira) e no dossiê (por lead). Distinta de crm_lead_activities: aqui é estado mutável, lá é log imutável.';
comment on column public.crm_lead_appointments.status is
  'Vocabulário NOSSO, fechado em dois (scheduled|cancelled) — por isso TEM CHECK, ao contrário de meta_templates.status. Sem "concluído": scheduled_at no passado já significa aconteceu.';

-- Agenda de UM lead, mais recente primeiro no dossiê.
create index if not exists crm_lead_appointments_org_lead_idx
  on public.crm_lead_appointments (organization_id, lead_id, scheduled_at);

-- /app/agenda (org inteira): só os vivos, ordenados por quando são.
create index if not exists crm_lead_appointments_org_scheduled_idx
  on public.crm_lead_appointments (organization_id, scheduled_at)
  where status = 'scheduled';

alter table public.crm_lead_appointments enable row level security;

drop policy if exists tenant_isolation_crm_lead_appointments_all on public.crm_lead_appointments;
create policy tenant_isolation_crm_lead_appointments_all on public.crm_lead_appointments
  for all
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));
