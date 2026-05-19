// Logger usado pelos services/repositories. Sempre escreve em `console.log`
// (stdout) com o nível embutido na própria mensagem.
//
// Por que NÃO usamos console.warn / console.error?
// - Em alguns runtimes do Lambda (Node.js 18+), se a função estiver
//   configurada com ApplicationLogLevel != "DEBUG"/"INFO", calls de
//   `console.warn` e `console.error` podem ser tratadas em streams separadas
//   ou filtradas — e o usuário fica achando que o log "sumiu".
// - `console.log` é universal: sempre vai pro stdout, sempre aparece no
//   CloudWatch, sem filtro de nível.
//
// Por que prefixar com `[Module] LEVEL`?
// - Fica fácil de filtrar no CloudWatch (ex.: pesquisar `[AuthService] WARN`).
// - Convive bem com os logs JSON do pino do Fastify (que ficam em entries
//   separados mas com o mesmo `reqId` quando logamos via `request.log`).
export function createLogger(module: string) {
  const prefix = `[${module}]`;
  return {
    info: (...args: unknown[]) => console.log(prefix, 'INFO ', ...args),
    warn: (...args: unknown[]) => console.log(prefix, 'WARN ', ...args),
    error: (...args: unknown[]) => console.log(prefix, 'ERROR', ...args),
  };
}
