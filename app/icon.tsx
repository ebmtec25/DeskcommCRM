import { ImageResponse } from "next/og";
import { branding } from "@/lib/branding";

// A marca (nome/inicial) vem do `.env` em RUNTIME (ver lib/branding.ts) — a
// imagem self-host é pré-buildada, então sem isso o Next resolveria o ícone
// uma vez no `next build` e travaria na marca padrão "DeskcommCRM" (inicial
// "D") pra sempre, ignorando o APP_NAME real de cada instalação.
export const dynamic = "force-dynamic";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  const { initial } = branding();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#506d48",
          color: "#ffffff",
          fontSize: 22,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        {initial}
      </div>
    ),
    size,
  );
}
