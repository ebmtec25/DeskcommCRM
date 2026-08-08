"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/** O tipo vem da ROTA — ver o porquê em `useAtRiskLeads.ts`. */
export type { LeadPerdido } from "@/app/api/v1/leads/perdidos/route";
import type { LeadPerdido } from "@/app/api/v1/leads/perdidos/route";

export interface PerdidosFilter {
  lost_reason?: string;
  from?: string;
  to?: string;
  pipeline_id?: string;
}

export interface PerdidosData {
  items: LeadPerdido[];
  total: number;
}

export function usePerdidos(filter: PerdidosFilter) {
  const params = new URLSearchParams();
  if (filter.lost_reason) params.set("lost_reason", filter.lost_reason);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.pipeline_id) params.set("pipeline_id", filter.pipeline_id);
  const qs = params.toString();

  return useQuery({
    queryKey: ["leads-perdidos", filter],
    queryFn: () =>
      apiClient
        .get<{ data: PerdidosData }>(`/api/v1/leads/perdidos${qs ? `?${qs}` : ""}`)
        .then((r) => r.data),
  });
}
