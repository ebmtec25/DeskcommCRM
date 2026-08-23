-- ============================================================================
-- 0168 — Arquivo do inbox com retorno automático.
--
-- Arquivar é organização da caixa, não exclusão: a conversa e suas mensagens
-- continuam no banco. Uma nova mensagem do contato precisa trazê-la de volta ao
-- trabalho sem depender do canal usado.
--
-- A regra fica em fn_mark_conversation_message porque QR, Meta e Zernio já
-- passam por esta RPC para carimbar toda mensagem persistida. Colocá-la em um
-- webhook deixaria os outros dois canais com comportamento diferente.
--
-- Só inbound reabre. Outbound atrasado/eco do celular não deve desfazer uma
-- decisão humana de arquivar.
-- ============================================================================

create or replace function public.fn_mark_conversation_message(
  p_conv uuid, p_direction text, p_preview text, p_at timestamptz
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set
    status = case
      when p_direction = 'inbound' and status = 'archived' then 'open'
      else status
    end,
    status_changed_at = case
      when p_direction = 'inbound' and status = 'archived' then now()
      else status_changed_at
    end,
    last_message_at = p_at, last_message_preview = p_preview,
    last_inbound_at  = case when p_direction = 'inbound'  then p_at else last_inbound_at  end,
    last_outbound_at = case when p_direction = 'outbound' then p_at else last_outbound_at end,
    unread_count_for_assignee = case
      when p_direction = 'inbound'  then unread_count_for_assignee + 1
      when p_direction = 'outbound' then 0
      else unread_count_for_assignee
    end,
    updated_at = now()
  where id = p_conv;

  update public.contacts c
     set last_activity_at = greatest(coalesce(c.last_activity_at, '-infinity'::timestamptz), p_at)
    from public.conversations v
   where v.id = p_conv
     and c.id = v.contact_id;
end; $$;

comment on function public.fn_mark_conversation_message is
  'Atualiza agregados da conversa; inbound reabre conversa arquivada, incrementa unread e carimba contacts.last_activity_at; outbound zera unread.';

revoke execute on function public.fn_mark_conversation_message(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_mark_conversation_message(uuid, text, text, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
