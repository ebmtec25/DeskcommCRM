-- 0178 · Mover leads em lote deixa de empilhar todos na MESMA posição.
--
-- ─── O sintoma ───────────────────────────────────────────────────────────────
-- `components/kanban/BulkActionBar.tsx` manda um único `position_in_stage`
-- fixo (1_000_000) para o lote inteiro, e `POST /api/v1/leads/bulk` (case
-- "move") grava esse valor com um `update ... in (ids)` — N leads movidos de
-- uma vez terminam com o MESMO número na etapa de destino.
--
-- `position_in_stage` é fractional indexing (numeric, nunca int): quem decide
-- onde um card entra é `midpoint(prev, next)` em `lib/kanban/fractional-indexing.ts`,
-- que já documenta o caso `prev === next` como indefinido. Sem posições
-- distintas por linha, arrastar um card para ENTRE dois dos que acabaram de
-- ser movidos em lote calcula o midpoint de dois valores iguais, e a ordem
-- entre os N já fica arbitrária (resolvida pelo plano de execução) antes disso.
--
-- ─── Por que uma função, e não N updates no route handler ────────────────────
-- Posições distintas exigem um valor por linha. Pelo PostgREST isso é um
-- `upsert` (exigiria reenviar todas as colunas NOT NULL) ou N chamadas
-- `.update()` — até 50 idas ao banco, e uma falha no meio deixa o lote pela
-- metade sem transação que desfaça. Uma função resolve os dois: `row_number()`
-- dá o valor por linha, e o `update` único faz do lote uma transação só.
--
-- ─── O que ela faz ───────────────────────────────────────────────────────────
-- Empilha o lote ao FIM da etapa de destino, espaçado de 1000 em 1000 (mesmo
-- STEP de `fractional-indexing.ts`), preservando a ordem em que os cards
-- estavam no quadro (etapa atual, depois posição). O piso é o maior valor JÁ
-- ocupado na etapa de destino IGNORANDO os cards do próprio lote — sem isso,
-- um card que já está no destino serviria de piso para si mesmo.
--
-- ─── Segurança ───────────────────────────────────────────────────────────────
-- `security invoker` de propósito: a RLS de `crm_leads` continua sendo o piso.
-- `p_organization_id` é escopo explícito (org resolvida do cookie pelo
-- handler, nunca do body) — sozinha a RLS deixaria um ator com duas
-- organizações tocar as duas de uma vez. As duas origens de EXECUTE são
-- revogadas (doutrina, item 9 do CLAUDE.md): `revoke from public` não tira o
-- grant direto que `anon` herda do `ALTER DEFAULT PRIVILEGES`, e
-- `revoke from anon` não tira o grant a PUBLIC dado na criação.
--
-- Aditiva e idempotente: `create or replace`, nenhuma coluna nova, nenhum
-- dado existente tocado.

create or replace function public.fn_mover_leads_em_lote(
  p_organization_id uuid,
  p_lead_ids uuid[],
  p_stage_id uuid
) returns table (lead_id uuid, from_stage_id uuid, pipeline_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_piso numeric;
begin
  -- coalesce(..., 0) cobre a etapa vazia; o DEFAULT da coluna é 1000, então o
  -- primeiro card de um lote para uma etapa vazia cai em 1000, como um card
  -- criado à mão.
  select coalesce(max(l.position_in_stage), 0)
    into v_piso
    from public.crm_leads l
   where l.organization_id = p_organization_id
     and l.stage_id = p_stage_id
     and not (l.id = any(p_lead_ids));

  return query
  with alvo as (
    select l.id,
           l.stage_id    as from_stage_id,
           l.pipeline_id as pipeline_id,
           -- A ordem do lote no destino é a ordem em que ele estava no
           -- quadro: etapa, depois posição. `id` só desempata para o
           -- resultado ser determinístico.
           row_number() over (order by l.stage_id, l.position_in_stage, l.id) as ordem
      from public.crm_leads l
     where l.organization_id = p_organization_id
       and l.id = any(p_lead_ids)
  ),
  movidos as (
    update public.crm_leads l
       set stage_id          = p_stage_id,
           position_in_stage = v_piso + (a.ordem * 1000),
           updated_at        = now()
      from alvo a
     where l.id = a.id
       and l.organization_id = p_organization_id
    returning l.id, a.from_stage_id, a.pipeline_id
  )
  select m.id, m.from_stage_id, m.pipeline_id from movidos m;
end;
$$;

comment on function public.fn_mover_leads_em_lote(uuid, uuid[], uuid) is
  'Move um lote de leads para uma etapa dando a cada um posição DISTINTA (piso da etapa de destino + 1000 por card, na ordem em que estavam no quadro). Existe porque gravar a mesma position_in_stage em N linhas quebra o midpoint() do arrasto seguinte (prev === next) e deixa a ordem do quadro indefinida. Devolve uma linha por card movido, com a etapa de ORIGEM, para o handler emitir a atividade de timeline de cada um.';

revoke all     on function public.fn_mover_leads_em_lote(uuid, uuid[], uuid) from public;
revoke execute on function public.fn_mover_leads_em_lote(uuid, uuid[], uuid) from anon;
grant  execute on function public.fn_mover_leads_em_lote(uuid, uuid[], uuid)
  to authenticated, service_role;
