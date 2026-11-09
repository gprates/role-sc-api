import type { FastifyRequest } from 'fastify';

// Decoração `awsLambda` criada pelo @fastify/aws-lambda (src/handler.ts).
// Só existe na Lambda; no servidor HTTP local fica indefinida.
declare module 'fastify' {
  interface FastifyRequest {
    awsLambda?: {
      event?: { requestContext?: { identity?: { sourceIp?: string } } };
    };
  }
}

// Na Lambda o IP vem de requestContext.identity.sourceIp, preenchido pelo
// próprio API Gateway (o cliente não consegue forjar, ao contrário do
// X-Forwarded-For). Fora da Lambda (pnpm dev, Docker) usa o IP da conexão.
export function getClientIp(request: FastifyRequest): string {
  return request.awsLambda?.event?.requestContext?.identity?.sourceIp ?? request.ip;
}
