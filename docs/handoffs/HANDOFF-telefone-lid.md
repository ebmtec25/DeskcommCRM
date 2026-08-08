# HANDOFF — Telefone de contato só-lid

> Sessão de 2026-08-08. Contexto: card do Kanban mostrava só o nome do lead, sem o telefone,
> pro atendente confundir com bug. Causa raiz: WhatsApp manda cada vez mais chats como `@lid`
> (identidade interna) em vez do número real — `contacts.phone_number` fica genuinamente `null`,
> não é a tela escondendo dado que existe.

## O que foi feito

1. **`fix(kanban)` (`58c66cd8`)** — card mostra "Número protegido pelo WhatsApp" em vez de "—"
   quando o lead só tem lid (`lead.contact.phone_hidden`, derivado de `contacts.wa_identity`
   começando com `lid:`). Cosmético, sem mudança de schema.
2. **`feat(whatsapp)` (`e0c2a4fd`)** — o engine NOWEB do WAHA mantém um mapa lid→telefone real
   (`GET /api/{session}/lids/{lid}`) quando o config `noweb.store.enabled/fullSync` está ligado.
   `startSession` (`lib/waha/client.ts`) passou a pedir esse store; `upsertContact`
   (`lib/waha/ingest.ts`) tenta resolver e gravar o telefone real toda vez que ingere um contato
   só-lid, best-effort — falha não derruba a mensagem.
3. **Sessão de produção reiniciada** (`PUT /api/sessions/org_ba044886_895e53`) pra aplicar o
   config novo. Confirmado: voltou `WORKING` sem pedir QR (credenciais preservadas).

Ambos os commits pushed pro fork (`meufork/main`, e0c2a4fd).

## Estado no fim da sessão — NÃO verificado até o fim

O `noweb.store` está ligado e o endpoint de lids responde (antes dava 400 pedindo o config,
agora não dá mais). Mas testei contra o lid real de produção (`182527536959716`, contato
"Emiliano") e voltou `pn: null` — **`GET /api/{session}/lids/count` mostrou 0 lids conhecidos**
minutos depois de ligar o store.

Duas explicações possíveis, não desambiguadas:
- **Sync ainda rodando** — `fullSync` pode levar mais que alguns minutos dependendo do
  histórico da sessão.
- **Esse contato específico pode não ser resolvível** — existe uma configuração real de
  privacidade do WhatsApp ("quem pode ver seu número") que alguns contatos têm ligada; nesse
  caso nem o `noweb.store` resolve.

## Próximo passo exato

1. Checar de novo: `GET /api/{session}/lids/count` e `GET /api/{session}/lids/182527536959716@lid`
   (via `docker exec` no container WAHA + `X-Api-Key: $WAHA_API_KEY` plaintext do `.env` — ver
   comando usado nesta sessão, funciona de dentro do container).
2. Se ainda `pn: null` depois de um tempo razoável (ex.: um dia): mandar uma mensagem NOVA do
   número real pro WhatsApp conectado — o ingest (`backfillPhoneFromLid`) tenta resolver a cada
   mensagem nova, então isso é o teste mais direto de "resolve ou não resolve".
3. Se nunca resolver pra ESSE contato específico, é esperado (privacidade do lado dele) — o
   mecanismo já está certo, só não é garantia universal. Vale checar outros contatos só-lid
   pra confirmar que o mecanismo funciona em geral, não só nesse caso possivelmente irresolvível.

## Pendência separada (não iniciada)

O Rafael/dono também pediu suporte a providers de IA "gratuitos" nos agentes (OpenRouter,
Ollama, Groq) — hoje só `anthropic`/`openai`/`google` (`ai_provider_credentials` CHECK
constraint, `lib/agent-engine/edge/llm/providers.ts`, `lib/ai/provider-validators.ts`). Mapeado
mas **não implementado**: Groq/OpenRouter são fáceis (API-compatíveis com OpenAI, endpoint
fixo); Ollama é mais complicado porque o endpoint é do próprio usuário (self-hosted), o que
quebra a doutrina de "endpoint canônico fixo por provider" que `providers.ts` assume hoje.
