/**
 * "resetar" digitado no campo de mensagem do TestPanel é atalho pro mesmo
 * reset do botão — sem precisar soltar o teclado. Espaço em volta e caixa
 * não importam ("Resetar", " resetar ").
 */
export function isComandoResetar(texto: string): boolean {
  return texto.trim().toLowerCase() === "resetar";
}
