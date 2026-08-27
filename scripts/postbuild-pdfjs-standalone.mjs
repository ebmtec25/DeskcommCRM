#!/usr/bin/env node
/**
 * Pos-build: conserta dois buracos do file tracing do Next (output
 * "standalone") em volta do pdfjs-dist, achados testando o upload de
 * documento pela tela contra o server.js standalone real (não next dev).
 * Nenhum dos dois aparece com `next dev`; os dois são silenciosos até
 * alguém subir um PDF de verdade.
 *
 * 1) @napi-rs/canvas (binário nativo, optionalDependency do pdfjs-dist)
 *
 * outputFileTracingIncludes (next.config.ts) copia CONTEÚDO REAL (não
 * symlink) para cada destino que casa o glob. Em desenvolvimento o pnpm
 * resolve os pacotes de plataforma (@napi-rs/canvas-linux-x64-gnu e -musl)
 * via um symlink que só existe ao lado do pacote @napi-rs/canvas ORIGINAL —
 * a cópia que acaba dentro de
 * node_modules/pdfjs-dist@.../node_modules/@napi-rs/canvas/ não tem esse
 * symlink nem os pacotes irmãos, e o require('@napi-rs/canvas-linux-x64-*')
 * de dentro dela falha com "Cannot find native binding", mesmo com o pacote
 * de plataforma presente em OUTRO lugar da árvore.
 *
 * A correção não tenta reproduzir a resolução de pacote: o próprio
 * js-binding.js do @napi-rs/canvas tenta, ANTES de tudo, um require
 * RELATIVO (require('./skia.linux-x64-gnu.node')) — um arquivo do lado dele
 * mesmo. Bastando o .node estar fisicamente ao lado do js-binding.js em CADA
 * cópia, o resto da cadeia de fallback nem entra em jogo.
 *
 * 2) pdf.worker.mjs (o "fake worker" que o pdf.js usa em Node)
 *
 * Sem Worker de browser disponível, o pdf.js roda o worker em processo —
 * mas mesmo esse caminho precisa IMPORTAR o módulo pdf.worker.mjs. Sob
 * Turbopack, o pdf.mjs vira um chunk bundlado em .next/server/chunks/, e o
 * pdf.js computa o caminho do worker como um IRMÃO desse chunk (baseado no
 * import.meta.url do módulo BUNDLADO, não do arquivo original) — resultando
 * em "Setting up fake worker failed: Cannot find module
 * '.../.next/server/chunks/pdf.worker.mjs'". Nem outputFileTracingIncludes
 * (o arquivo original nunca é copiado pra dentro de .next/server/chunks/,
 * que não é um destino que o tracing escreve) nem GlobalWorkerOptions.workerSrc
 * nem import.meta.resolve ajudam aqui — todos os três foram tentados e
 * medidos falhando. A correção é colocar o arquivo fisicamente onde o
 * bundle o procura.
 *
 * Roda como "postbuild" (package.json) — automático depois de todo
 * next build, sem passo manual pro self-hoster nem pro CI que publica a
 * imagem.
 */
import { readdirSync, existsSync, copyFileSync } from "node:fs";
import { join, sep } from "node:path";

const STANDALONE = join(process.cwd(), ".next", "standalone");
if (!existsSync(STANDALONE)) {
  console.log("[postbuild-pdfjs] .next/standalone não existe (build sem output standalone?) — pulando.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1) binários nativos do @napi-rs/canvas
// ---------------------------------------------------------------------------

const BINARIOS_CANVAS = [
  { pacote: "canvas-linux-x64-gnu", arquivo: "skia.linux-x64-gnu.node" },
  { pacote: "canvas-linux-x64-musl", arquivo: "skia.linux-x64-musl.node" },
];

function encontrarFonteCanvas(nomePacote, nomeArquivo) {
  const pnpmDir = join(process.cwd(), "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return null;
  const candidato = readdirSync(pnpmDir).find((d) => d.startsWith(`@napi-rs+${nomePacote}@`));
  if (!candidato) return null;
  const caminho = join(pnpmDir, candidato, "node_modules", "@napi-rs", nomePacote, nomeArquivo);
  return existsSync(caminho) ? caminho : null;
}

/** Toda pasta chamada "canvas" dentro de qualquer node_modules/@napi-rs/, em qualquer profundidade. */
function encontrarDestinosCanvas(raiz) {
  const alvo = sep + "node_modules" + sep + "@napi-rs";
  const destinos = [];
  function varrer(dir) {
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entradas) {
      if (!e.isDirectory()) continue;
      const caminho = join(dir, e.name);
      if (e.name === "canvas" && dir.endsWith(alvo)) {
        destinos.push(caminho);
        continue;
      }
      varrer(caminho);
    }
  }
  varrer(raiz);
  return destinos;
}

const pnpmDirStandalone = join(STANDALONE, "node_modules", ".pnpm");
let canvasCopiados = 0;
let destinosCanvas = [];

if (existsSync(pnpmDirStandalone)) {
  destinosCanvas = encontrarDestinosCanvas(pnpmDirStandalone);
  for (const { pacote: nomePacote, arquivo: nomeArquivo } of BINARIOS_CANVAS) {
    const fonte = encontrarFonteCanvas(nomePacote, nomeArquivo);
    if (!fonte) {
      console.log(`[postbuild-pdfjs] fonte não encontrada para ${nomePacote} — pulando esse binário (plataforma não instalada?).`);
      continue;
    }
    for (const destinoDir of destinosCanvas) {
      copyFileSync(fonte, join(destinoDir, nomeArquivo));
      canvasCopiados++;
    }
  }
}

if (destinosCanvas.length === 0) {
  console.log("[postbuild-pdfjs] nenhuma pasta @napi-rs/canvas no standalone — ok, nada a copiar.");
} else {
  console.log(`[postbuild-pdfjs] ${canvasCopiados} arquivo(s) .node copiado(s) para ${destinosCanvas.length} cópia(s) de @napi-rs/canvas.`);
}

// ---------------------------------------------------------------------------
// 2) pdf.worker.mjs ao lado de todo chunk bundlado que carrega pdfjs-dist
// ---------------------------------------------------------------------------

function encontrarWorkerFonte() {
  const pnpmDir = join(process.cwd(), "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return null;
  const candidato = readdirSync(pnpmDir).find((d) => d.startsWith("pdfjs-dist@"));
  if (!candidato) return null;
  const caminho = join(pnpmDir, candidato, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs");
  return existsSync(caminho) ? caminho : null;
}

/** Todo diretório de chunks do servidor (onde o Turbopack/webpack bundla as Route Handlers). */
function encontrarDiretoriosDeChunks() {
  const candidatos = [
    join(STANDALONE, ".next", "server", "chunks"),
    join(STANDALONE, ".next", "server", "app"),
  ];
  return candidatos.filter((c) => existsSync(c));
}

const workerFonte = encontrarWorkerFonte();
if (!workerFonte) {
  console.log("[postbuild-pdfjs] pdf.worker.mjs não encontrado no node_modules — pulando (pdfjs-dist não instalado?).");
} else {
  const diretorios = encontrarDiretoriosDeChunks();
  let workerCopiados = 0;
  for (const dir of diretorios) {
    const destino = join(dir, "pdf.worker.mjs");
    copyFileSync(workerFonte, destino);
    workerCopiados++;
  }
  console.log(`[postbuild-pdfjs] pdf.worker.mjs copiado pra ${workerCopiados} diretório(s) de chunks.`);
}
