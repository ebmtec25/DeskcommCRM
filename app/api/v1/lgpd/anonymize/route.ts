/**
 * POST /api/v1/lgpd/anonymize
 *
 * Irreversible cascade nullify (Spec 05 §LGPD). Only `admin` role within the
 * tenant or platform_admin can execute. Idempotent: re-anonymizing returns
 * 200 with `action: "already_anonymized"`.
 *
 * A mutação usa a cascata canônica `fn_lgpd_cascade_redact_contact`: dados do
 * contato, conversas, mensagens, negócios, atividades e mídias são tratados em
 * conjunto, com auditoria dentro da mesma transação do banco.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { cascadeRedactContact } from "@/lib/lgpd/redact-cascade";
import { logger } from "@/lib/logger";
import { lgpdAnonymizeSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  let input;
  try {
    input = await validateRequest(lgpdAnonymizeSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  // Fetch contact (RLS scoped).
  const { data: existing, error: selErr } = await supabase
    .from("contacts")
    .select("id, organization_id, is_anonymized, anonymized_at")
    .eq("id", input.contact_id)
    .maybeSingle();
  if (selErr) {
    return fail("internal_error", selErr.message, 500, { requestId });
  }
  if (!existing) {
    return fail("not_found", "Contato não encontrado.", 404, { requestId });
  }

  // Permission: admin NA ORG DO CONTATO (pode diferir da org ativa do cookie)
  // OR platform_admin. Org do contato vem de query RLS-scoped (fonte confiável).
  const authz = await requireRole("admin", {
    requestId,
    resource: "contact",
    allowPlatformAdmin: true,
    organizationId: existing.organization_id,
  });
  if (!authz.ok) return authz.response;

  // Idempotency.
  if (existing.is_anonymized) {
    return ok(
      {
        contact_id: existing.id,
        anonymized_at: existing.anonymized_at,
        action: "already_anonymized",
      },
      { requestId },
    );
  }

  try {
    await cascadeRedactContact({
      organizationId: existing.organization_id,
      contactId: existing.id,
      requestId,
    });
  } catch (err) {
    logger.error("[lgpd.anonymize] cascata falhou", {
      requestId,
      organizationId: existing.organization_id,
      error: err instanceof Error ? err.message : "unknown",
    });
    return fail("internal_error", "Falha ao anonimizar contato.", 500, { requestId });
  }

  // O evento mantém os consumidores assíncronos informados. A auditoria densa
  // já foi gravada dentro da transação da cascata e não é duplicada aqui.
  await supabase
    .rpc("emit_event", {
      p_event_type: "contact.anonymized",
      p_entity_kind: "contact",
      p_entity_id: existing.id,
      p_payload: {
        contact_id: existing.id,
        actor_user_id: user.id,
        justification: input.justification,
      },
      p_metadata: { request_id: requestId },
      p_organization_id: existing.organization_id,
    })
    .then(({ error }) => {
      if (error) {
        logger.error("[lgpd.anonymize] evento não gravado", { requestId, error: error.message });
      }
    });

  const { data: redacted } = await supabase
    .from("contacts")
    .select("anonymized_at")
    .eq("id", existing.id)
    .eq("organization_id", existing.organization_id)
    .maybeSingle();

  return ok(
    {
      contact_id: existing.id,
      anonymized_at: redacted?.anonymized_at ?? null,
      action: "anonymized" as const,
    },
    { requestId },
  );
}
