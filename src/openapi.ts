import type { FastifyInstance } from 'fastify';
import swagger, { type FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

// Documentação OpenAPI (Swagger) servida em /docs (UI), /docs/json e /docs/yaml.
//
// Só o servidor HTTP (invoke-local.ts: `pnpm dev`, `pnpm start` e Docker)
// registra este módulo. O handler da Lambda não o importa: o
// @fastify/swagger-ui lê arquivos estáticos de dentro do próprio pacote em
// node_modules, que não existem no bundle do esbuild (com a UI registrada, o
// bundle responde 500 em todas as rotas).
//
// A spec é gerada a partir das rotas registradas (body/querystring/params de
// src/schemas/*.ts). O que as rotas não declaram (tags, resumo, autenticação
// e respostas) entra pelo `transform` abaixo, que altera apenas o documento
// gerado: a validação e a serialização das rotas continuam as mesmas.

type Schema = Record<string, unknown>;

const ref = (nome: string): Schema => ({ $ref: `#/components/schemas/${nome}` });

const json = (description: string, schema: Schema): Schema => ({
  description,
  content: { 'application/json': { schema } },
});

const html = (description: string): Schema => ({
  description,
  content: { 'text/html': { schema: { type: 'string' } } },
});

const erro = (description: string): Schema => json(description, ref('Erro'));

const sucesso = (dados: Record<string, Schema>): Schema => ({
  type: 'object',
  properties: { success: { type: 'boolean', enum: [true] }, ...dados },
});

const objectId = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' };

// Exigências de autenticação (ver components.securitySchemes).
const PROTEGIDA = [{ bearerAuth: [], apiKey: [] }];
const PUBLICA = [{ apiKey: [] }];

const ERRO_401 = erro('JWT ausente, inválido ou expirado');

const TAGS = [
  { name: 'Auth', description: 'Cadastro, login (e-mail/senha e Google), verificação de e-mail e senha' },
  { name: 'Eventos', description: 'Eventos publicados pelo processador NLP e seus comentários' },
  { name: 'Favoritos', description: 'Eventos favoritados pelo usuário do token' },
  { name: 'Comentários', description: 'Editar, excluir e curtir um comentário existente' },
  { name: 'Usuários', description: 'Perfil e avatar do usuário do token' },
  { name: 'Metadados', description: 'Listas usadas nos filtros' },
];

const DESCRICAO = `API REST do Rolê SC: eventos do litoral de Santa Catarina, autenticação (e-mail/senha e Google), favoritos, comentários e perfil.

**Autenticação**
- \`Authorization: Bearer <JWT>\`: token obtido em \`POST /auth/login\` ou \`POST /auth/google\`, validado pela própria API nas rotas protegidas.
- \`x-api-key\`: exigido **apenas em produção**, pelo API Gateway, em todas as rotas exceto \`GET /auth/verify-email\`. A aplicação não confere esse cabeçalho; rodando localmente ou no Docker ele pode ser omitido. Sem a chave, o API Gateway responde \`403 {"message":"Forbidden"}\` antes de a requisição chegar à API; acima da cota do Usage Plan, \`429\`.

**Origem**: o cabeçalho opcional \`x-client\` (\`web\` no site, \`app/<versão>\` no app) aparece como \`client\` nos logs da API. É só informativo e não altera a resposta.

**Erros** seguem \`{ "success": false, "message": "...", "code": "..." }\`. O \`code\` (UPPER_SNAKE_CASE) só aparece em erros de domínio; erros de validação de schema (400) e erros 5xx não o trazem.

**Campos extras** no corpo ou na query (schemas com \`additionalProperties: false\`) são descartados silenciosamente, sem erro 400.

**Produção**: \`https://<api-id>.execute-api.<regiao>.amazonaws.com/prod\` (saída \`ApiUrl\` da stack SAM). A Lambda não serve esta documentação.`;

const DOCUMENTO: NonNullable<FastifyDynamicSwaggerOptions['openapi']> = {
  openapi: '3.0.3',
  info: { title: 'Rolê SC API', version: '1.0.0', description: DESCRICAO },
  tags: TAGS,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'JWT HS256 com { userId, email }, emitido por POST /auth/login ou POST /auth/google. Validade: JWT_EXPIRES_IN (padrão 7d).',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description:
          'Chave do API Gateway, exigida só em produção (gerada pela stack SAM). Localmente e no Docker a API ignora este cabeçalho.',
      },
    },
    schemas: {
      Erro: {
        type: 'object',
        required: ['success', 'message'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          message: { type: 'string' },
          code: {
            type: 'string',
            description: 'Código de domínio (ex.: EMAIL_NOT_VERIFIED). Ausente em erros de validação e em 5xx.',
          },
        },
      },
      Mensagem: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
        },
      },
      Usuario: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          nome: { type: 'string' },
          email: { type: 'string', format: 'email' },
          emailVerified: { type: 'boolean' },
          avatarUrl: { type: 'string', description: 'Ausente se o usuário nunca enviou avatar' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Evento: {
        type: 'object',
        description:
          'Documento da coleção `eventos`, gravado pelo processador NLP e devolvido inteiro (sem projeção).',
        properties: {
          _id: { type: 'string' },
          titulo: { type: 'string' },
          descricao: { type: 'string', nullable: true },
          dataInicio: { type: 'string', format: 'date-time', nullable: true },
          dataFim: { type: 'string', format: 'date-time', nullable: true },
          horario: { type: 'string', nullable: true },
          local: { type: 'string', nullable: true },
          categoria: { type: 'string', nullable: true },
          imageUrl: { type: 'string', nullable: true },
          isEvent: { type: 'boolean' },
          municipio: { type: 'string' },
          site: { type: 'string' },
          url: { type: 'string' },
          publishedAt: { type: 'string' },
          processedAt: { type: 'string', format: 'date-time' },
          rawCrawlId: { type: 'string' },
          totalComentarios: { type: 'integer', description: 'Presente nas listagens' },
        },
      },
      Paginacao: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      Comentario: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          eventoId: { type: 'string' },
          texto: { type: 'string' },
          criadoEm: { type: 'string', format: 'date-time' },
          editadoEm: { type: 'string', format: 'date-time', nullable: true },
          curtidas: { type: 'integer' },
          curtidoPorMim: { type: 'boolean' },
          meu: { type: 'boolean', description: 'Se o usuário do token é o autor' },
          autor: {
            type: 'object',
            properties: {
              _id: { type: 'string' },
              nome: { type: 'string' },
              avatarUrl: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const MENSAGEM = ref('Mensagem');
const LOGIN = sucesso({ token: { type: 'string' }, user: ref('Usuario') });
const USUARIO = sucesso({ user: ref('Usuario') });
const LISTA_EVENTOS = sucesso({
  data: { type: 'array', items: ref('Evento') },
  pagination: ref('Paginacao'),
});
const COMENTARIO = sucesso({ data: ref('Comentario') });
const LISTA_STRINGS = sucesso({ data: { type: 'array', items: { type: 'string' } } });
const FAVORITO = sucesso({
  data: {
    type: 'object',
    properties: { eventoId: { type: 'string' }, favorito: { type: 'boolean' } },
  },
});
const CURTIDA = sucesso({
  data: {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      curtidas: { type: 'integer' },
      curtidoPorMim: { type: 'boolean' },
    },
  },
});

interface DocRota {
  tags: string[];
  summary: string;
  description?: string;
  security: Array<Record<string, string[]>>;
  response: Record<string, Schema>;
  // Só para rotas sem schema de entrada declarado na rota.
  params?: Schema;
  querystring?: Schema;
}

// Chave: "MÉTODO url" exatamente como registrada no Fastify (com prefixo).
const ROTAS: Record<string, DocRota> = {
  // --- Auth -----------------------------------------------------------------
  'POST /auth/register': {
    tags: ['Auth'],
    summary: 'Cria conta com e-mail e senha',
    description:
      'Cria o usuário com `emailVerified: false` e envia o link de verificação pelo SES. A força da senha (8+ caracteres, maiúscula, minúscula, dígito e caractere especial) é validada no serviço. Sem SES (ambiente local), responde 500 e desfaz o cadastro.',
    security: PUBLICA,
    response: {
      201: json('Conta criada; e-mail de verificação enviado', MENSAGEM),
      400: erro('Corpo inválido ou senha fraca (`WEAK_PASSWORD`)'),
      409: erro('E-mail já cadastrado'),
      500: erro('Falha ao enviar o e-mail de verificação (cadastro desfeito)'),
    },
  },
  'POST /auth/login': {
    tags: ['Auth'],
    summary: 'Login com e-mail e senha',
    security: PUBLICA,
    response: {
      200: json('Login realizado', LOGIN),
      400: erro('Corpo inválido ou conta criada pelo Google, sem senha (`PASSWORD_NOT_SET`)'),
      401: erro('E-mail ou senha inválidos'),
      403: erro('E-mail ainda não verificado (`EMAIL_NOT_VERIFIED`)'),
    },
  },
  'GET /auth/me': {
    tags: ['Auth'],
    summary: 'Dados do usuário do token',
    security: PROTEGIDA,
    response: {
      200: json('Usuário autenticado', USUARIO),
      401: ERRO_401,
      404: erro('Usuário não encontrado'),
    },
  },
  'GET /auth/verify-email': {
    tags: ['Auth'],
    summary: 'Confirma o e-mail (link enviado por e-mail)',
    description:
      'Aberta pelo navegador a partir do link do e-mail; responde HTML. Única rota que, em produção, não exige `x-api-key`.',
    security: [],
    querystring: {
      type: 'object',
      properties: { token: { type: 'string', description: 'Token recebido no link do e-mail' } },
    },
    response: {
      200: html('Página HTML de sucesso'),
      400: html('Página HTML de erro (token ausente, inválido ou expirado)'),
    },
  },
  'POST /auth/resend-verification': {
    tags: ['Auth'],
    summary: 'Reenvia o e-mail de verificação',
    description:
      'Resposta sempre genérica (não revela se o e-mail existe). Intervalo mínimo de 60 s entre envios para o mesmo usuário.',
    security: PUBLICA,
    response: {
      200: json('Resposta genérica', MENSAGEM),
      400: erro('Corpo inválido'),
    },
  },
  'POST /auth/forgot-password': {
    tags: ['Auth'],
    summary: 'Envia código de 6 dígitos para redefinir a senha',
    description: 'O código vale 15 minutos. Intervalo mínimo de 60 s entre pedidos para o mesmo usuário.',
    security: PUBLICA,
    response: {
      200: json('Código enviado (ou pedido recente ainda em espera)', MENSAGEM),
      400: erro('Corpo inválido'),
      403: erro('E-mail ainda não verificado (`EMAIL_NOT_VERIFIED`)'),
      404: erro('E-mail não cadastrado (`USER_NOT_FOUND`)'),
      500: erro('Falha ao enviar o e-mail'),
    },
  },
  'POST /auth/verify-reset-code': {
    tags: ['Auth'],
    summary: 'Troca o código de 6 dígitos por um resetToken',
    security: PUBLICA,
    response: {
      200: json('Código válido', sucesso({ resetToken: { type: 'string' } })),
      400: erro('Corpo inválido ou código incorreto/expirado (`INVALID_RESET_CODE`)'),
    },
  },
  'POST /auth/reset-password': {
    tags: ['Auth'],
    summary: 'Define nova senha usando o resetToken',
    security: PUBLICA,
    response: {
      200: json('Senha redefinida', MENSAGEM),
      400: erro('Corpo inválido, token inválido (`INVALID_RESET_TOKEN`) ou senha fraca (`WEAK_PASSWORD`)'),
    },
  },
  'POST /auth/change-password': {
    tags: ['Auth'],
    summary: 'Altera a senha do usuário logado',
    security: PROTEGIDA,
    response: {
      200: json('Senha alterada', MENSAGEM),
      400: erro('Senha atual incorreta (`INVALID_CURRENT_PASSWORD`) ou nova senha fraca/igual à atual (`WEAK_PASSWORD`)'),
      401: ERRO_401,
    },
  },
  'POST /auth/google': {
    tags: ['Auth'],
    summary: 'Login com Google (troca o id_token pelo JWT da API)',
    description:
      'Valida o `id_token` com a google-auth-library usando como audience `GOOGLE_ANDROID_CLIENT_ID` e/ou `GOOGLE_WEB_CLIENT_ID`. Vincula conta existente pelo e-mail ou cria uma nova, sem senha.',
    security: PUBLICA,
    response: {
      200: json(
        'Login realizado',
        sucesso({ token: { type: 'string' }, user: ref('Usuario'), isNewUser: { type: 'boolean' } }),
      ),
      400: erro('Token inválido (`INVALID_GOOGLE_TOKEN`) ou e-mail Google não verificado (`GOOGLE_EMAIL_NOT_VERIFIED`)'),
      500: erro('Nenhum Client ID do Google configurado no servidor'),
    },
  },

  // --- Eventos --------------------------------------------------------------
  'GET /eventos/': {
    tags: ['Eventos'],
    summary: 'Lista eventos com filtros e paginação',
    description:
      '`municipio` e `categoria` aceitam vários valores separados por vírgula. `dataInicio`/`dataFim` no formato `YYYY-MM-DD`. `search` busca no título e na descrição.',
    security: PROTEGIDA,
    response: {
      200: json('Página de eventos', LISTA_EVENTOS),
      400: erro('Query inválida'),
      401: ERRO_401,
    },
  },
  'GET /eventos/:id': {
    tags: ['Eventos'],
    summary: 'Detalhe de um evento',
    security: PROTEGIDA,
    params: {
      type: 'object',
      properties: { id: { type: 'string', description: 'ObjectId do evento' } },
      required: ['id'],
    },
    response: {
      200: json('Evento', sucesso({ data: ref('Evento') })),
      401: ERRO_401,
      404: erro('Evento não encontrado (inclusive id que não é ObjectId)'),
    },
  },
  'GET /eventos/:id/comentarios': {
    tags: ['Eventos'],
    summary: 'Lista os comentários de um evento',
    security: PROTEGIDA,
    response: {
      200: json(
        'Página de comentários',
        sucesso({ data: { type: 'array', items: ref('Comentario') }, pagination: ref('Paginacao') }),
      ),
      400: erro('Parâmetros inválidos'),
      401: ERRO_401,
    },
  },
  'POST /eventos/:id/comentarios': {
    tags: ['Eventos'],
    summary: 'Comenta um evento',
    security: PROTEGIDA,
    response: {
      201: json('Comentário criado', COMENTARIO),
      400: erro('Parâmetros inválidos ou texto vazio'),
      401: ERRO_401,
      404: erro('Evento não encontrado'),
    },
  },

  // --- Favoritos ------------------------------------------------------------
  'GET /favoritos/': {
    tags: ['Favoritos'],
    summary: 'Lista os eventos favoritados',
    security: PROTEGIDA,
    response: {
      200: json('Página de eventos favoritados', LISTA_EVENTOS),
      400: erro('Query inválida'),
      401: ERRO_401,
    },
  },
  'GET /favoritos/ids': {
    tags: ['Favoritos'],
    summary: 'Ids dos eventos favoritados',
    security: PROTEGIDA,
    response: {
      200: json('Lista de ids', LISTA_STRINGS),
      401: ERRO_401,
    },
  },
  'POST /favoritos/:eventoId': {
    tags: ['Favoritos'],
    summary: 'Favorita um evento (idempotente)',
    security: PROTEGIDA,
    response: {
      200: json('Evento favoritado', FAVORITO),
      400: erro('Parâmetro inválido'),
      401: ERRO_401,
      404: erro('Evento não encontrado'),
    },
  },
  'DELETE /favoritos/:eventoId': {
    tags: ['Favoritos'],
    summary: 'Remove um favorito (idempotente)',
    security: PROTEGIDA,
    response: {
      200: json('Favorito removido', FAVORITO),
      400: erro('Parâmetro inválido'),
      401: ERRO_401,
    },
  },

  // --- Comentários ----------------------------------------------------------
  'PATCH /comentarios/:comentarioId': {
    tags: ['Comentários'],
    summary: 'Edita o próprio comentário',
    security: PROTEGIDA,
    response: {
      200: json('Comentário editado', COMENTARIO),
      400: erro('Parâmetros inválidos ou texto vazio'),
      401: ERRO_401,
      403: erro('Comentário de outro usuário'),
      404: erro('Comentário não encontrado'),
    },
  },
  'DELETE /comentarios/:comentarioId': {
    tags: ['Comentários'],
    summary: 'Exclui o próprio comentário',
    security: PROTEGIDA,
    response: {
      200: json(
        'Comentário excluído',
        sucesso({
          data: {
            type: 'object',
            properties: { _id: { type: 'string' }, excluido: { type: 'boolean' } },
          },
        }),
      ),
      400: erro('Parâmetro inválido'),
      401: ERRO_401,
      403: erro('Comentário de outro usuário'),
      404: erro('Comentário não encontrado'),
    },
  },
  'POST /comentarios/:comentarioId/curtida': {
    tags: ['Comentários'],
    summary: 'Curte um comentário (idempotente)',
    security: PROTEGIDA,
    response: {
      200: json('Estado da curtida', CURTIDA),
      400: erro('Parâmetro inválido'),
      401: ERRO_401,
      404: erro('Comentário não encontrado'),
    },
  },
  'DELETE /comentarios/:comentarioId/curtida': {
    tags: ['Comentários'],
    summary: 'Remove a curtida (idempotente)',
    security: PROTEGIDA,
    response: {
      200: json('Estado da curtida', CURTIDA),
      400: erro('Parâmetro inválido'),
      401: ERRO_401,
      404: erro('Comentário não encontrado'),
    },
  },

  // --- Usuários -------------------------------------------------------------
  'PATCH /users/me': {
    tags: ['Usuários'],
    summary: 'Altera o nome de exibição',
    security: PROTEGIDA,
    response: {
      200: json('Perfil atualizado', USUARIO),
      400: erro('Nome inválido'),
      401: ERRO_401,
    },
  },
  'POST /users/me/avatar/upload-url': {
    tags: ['Usuários'],
    summary: 'Gera URL pré-assinada (PUT no S3, 5 min) para enviar o avatar',
    description:
      'Tipos aceitos: image/jpeg, image/png, image/webp, image/gif; até 5 MB. O cliente faz o PUT direto no S3 com os `headers` devolvidos e depois chama `/users/me/avatar/confirm`.',
    security: PROTEGIDA,
    response: {
      200: json(
        'URL de upload',
        sucesso({
          uploadUrl: { type: 'string' },
          key: { type: 'string' },
          headers: { type: 'object', properties: { 'Content-Type': { type: 'string' } } },
        }),
      ),
      400: erro('Tipo não aceito (`AVATAR_INVALID_TYPE`) ou arquivo grande demais (`AVATAR_TOO_LARGE`)'),
      401: ERRO_401,
    },
  },
  'POST /users/me/avatar/confirm': {
    tags: ['Usuários'],
    summary: 'Confirma o upload e grava a URL pública do avatar',
    security: PROTEGIDA,
    response: {
      200: json('Avatar atualizado', sucesso({ avatarUrl: { type: 'string' } })),
      400: erro('Upload não encontrado (`AVATAR_NOT_UPLOADED`), tipo (`AVATAR_INVALID_TYPE`) ou tamanho (`AVATAR_TOO_LARGE`) inválidos'),
      401: ERRO_401,
      500: erro('Falha ao consultar o S3'),
    },
  },

  // --- Metadados ------------------------------------------------------------
  'GET /municipios': {
    tags: ['Metadados'],
    summary: 'Municípios com eventos no banco',
    security: PROTEGIDA,
    response: { 200: json('Lista de municípios', LISTA_STRINGS), 401: ERRO_401 },
  },
  'GET /categorias': {
    tags: ['Metadados'],
    summary: 'Categorias aceitas (lista fixa)',
    security: PROTEGIDA,
    response: { 200: json('Lista de categorias', LISTA_STRINGS), 401: ERRO_401 },
  },
};

/** Registra a geração da spec e a UI em /docs. Chamar antes das rotas. */
export function registerOpenApi(app: FastifyInstance): void {
  app.register(swagger, {
    openapi: DOCUMENTO,
    transform: ({ schema, url, route }) => {
      const method = Array.isArray(route.method) ? route.method[0] : route.method;
      const doc = ROTAS[`${method} ${url}`];
      if (!doc) return { schema, url };

      const { params, querystring, ...resto } = doc;
      return {
        schema: {
          ...(params && !schema?.params ? { params } : {}),
          ...(querystring && !schema?.querystring ? { querystring } : {}),
          ...schema,
          ...resto,
        },
        // `/eventos/` e `/favoritos/` (rota "/" dentro do prefixo) também
        // atendem sem a barra final, que é como os clientes chamam.
        url: url.length > 1 ? url.replace(/\/$/, '') : url,
      };
    },
  });

  app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
}
