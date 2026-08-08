"use client";
import { useState } from "react";
import Link from "next/link";
import { formatRelative } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DotsThree, Trash } from "@/lib/ui/icons";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { ROLE_RANK } from "@/lib/auth/types";
import { AnonymizeDialog } from "./AnonymizeDialog";
import type { Contact } from "@/lib/types/contacts";

interface Props {
  contacts: Contact[];
}

function displayName(c: Contact): string {
  return c.display_name?.trim() || c.name?.trim() || "—";
}

export function ContactsTable({ contacts }: Props) {
  const { user, activeOrg } = useAuth();
  const isAdmin =
    user.is_platform_admin || (activeOrg && ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin);
  const [excluirId, setExcluirId] = useState<string | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Telefone</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Última atividade</TableHead>
            <TableHead>Status</TableHead>
            {isAdmin && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((c) => (
            <TableRow key={c.id} className="cursor-pointer">
              <TableCell className="font-medium">
                <Link href={`/app/contacts/${c.id}`} className="hover:underline">
                  {displayName(c)}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {c.email ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {c.phone_number ?? "—"}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {c.tags.length === 0
                    ? <span className="text-muted-foreground text-xs">—</span>
                    : c.tags.map((t) => (
                        <Badge key={t} variant="neutral">{t}</Badge>
                      ))}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {c.last_activity_at
                  ? formatRelative(new Date(c.last_activity_at), new Date(), { locale: ptBR })
                  : "—"}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {c.is_anonymized && <Badge variant="destructive">Anonimizado</Badge>}
                  {c.is_blocked && <Badge variant="warning">Bloqueado</Badge>}
                  {!c.is_anonymized && !c.is_blocked && (
                    <Badge variant="success">Ativo</Badge>
                  )}
                </div>
              </TableCell>
              {isAdmin && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Ações do contato"
                      >
                        <DotsThree size={16} weight="bold" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-error-fg focus:text-error-fg"
                        onSelect={() => setExcluirId(c.id)}
                      >
                        <Trash size={14} className="mr-2" /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/*
       * "Excluir" aqui é anonimizar + sumir da tela, não DROP de linha —
       * decisão do dono do produto: mantém rastro auditável (a mesma exigência
       * de 5 anos que o resto do audit log já cumpre), reaproveita o mecanismo
       * de LGPD que já existe em vez de um caminho de delete paralelo, e
       * "número que volta vira lead novo" já é o comportamento de quem tem
       * telefone anulado (wa_identity deixa de casar no upsert). O diálogo é o
       * MESMO da aba LGPD do contato — não uma cópia.
       */}
      {excluirId && (
        <AnonymizeDialog
          contactId={excluirId}
          open={excluirId !== null}
          onOpenChange={(v) => !v && setExcluirId(null)}
        />
      )}
    </>
  );
}
