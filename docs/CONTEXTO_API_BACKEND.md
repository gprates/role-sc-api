# Contexto Completo — API Backend (role-sc-api)

Documento de contexto para transferência entre chats/agentes e documentação do TCC. Leia tudo antes de começar qualquer implementação que dependa desta API.

---

## 1. VISÃO GERAL DO ECOSSISTEMA

Este projeto faz parte de um TCC cujo objetivo é um **aplicativo mobile em React Native (Expo)** que exibe automaticamente **eventos culturais e municipais** dos municípios: **Itajaí, Camboriú, Porto Belo, Itapema e Bombinhas** (SC).

O ecossistema é dividido em 4 projetos com responsabilidades isoladas:

| Projeto | Responsabilidade | Status |
|---------|-----------------|--------|
| **role-sc-web-crawler** | Crawling com Playwright → salva texto bruto no MongoDB Atlas | Implementado (AWS Lambda) |
| **role-sc-processador-nlp-webcrawls** | Lê `raw_crawls`, processa com IA (Groq/Llama), gera eventos estruturados | Implementado (AWS Lambda) |
| **role-sc-api** (este) | Expõe a coleção `eventos` via REST + autenticação JWT | Implementado (AWS Lambda) |
| **role-sc-app** | React Native (Expo) — exibe eventos com filtros por região | A implementar |

**Fluxo completo:**
```
Sites municipais → Lambda Crawler → MongoDB (raw_crawls)
                                           ↓
                              Lambda NLP (Groq/Llama 3.1 8B)
                                           ↓
                              MongoDB (eventos processados)
                                           ↓
                              API Gateway REST (API Key + Throttling)
                                           ↓
                              Lambda API (Fastify) ← ESTE PROJETO
                                           ↓
                                    App React Native (Expo)
```

---

## 2. O QUE A API FAZ

É uma **AWS Lambda** com **Fastify** que:

1. Expõe a coleção `eventos` via endpoints REST com filtros e paginação
2. Gerencia autenticação de usuários (cadastro, login) com JWT
3. Protege rotas com verificação de token JWT
4. Fornece metadados auxiliares (lista de municípios e categorias)

A API é **somente leitura** em relação a eventos — ela consulta a coleção `eventos` populada pelo NLP Processor. A única escrita que a API faz é na coleção `users` (cadastro de usuários).

---

## 3. STACK TECNOLÓGICA

| Tecnologia | Versão | Uso |
|-----------|--------|-----|
| TypeScript | ^6.0 | Linguagem principal |
| Node.js | 24.x | Runtime |
| pnpm | latest | Package manager |
| Fastify | ^5.8 | Framework HTTP |
| @fastify/aws-lambda | ^6.4 | Adapter Lambda |
| @fastify/cors | ^11.2 | CORS |
| mongodb | ^7.1 | Cliente MongoDB |
| bcryptjs | ^3.0 | Hash de senhas (puro JS, sem binários nativos) |
| jsonwebtoken | ^9.0 | JWT |
| dotenv | ^17.4 | Variáveis de ambiente (dev local) |
| tsx | ^4.21 | Execução local TypeScript |
| esbuild | ^0.28 | Bundler para Lambda |

**Decisão técnica:** Usamos `bcryptjs` (JavaScript puro) em vez de `bcrypt` (C++ nativo) porque o esbuild não consegue empacotar binários nativos. A API de ambos é idêntica — `hash()` e `compare()`.

**Build:** O esbuild gera um único arquivo `dist/handler.js` em formato CommonJS (CJS), que é o formato esperado pela Lambda. O formato ESM não funciona na Lambda sem configuração adicional.

---

## 4. INFRAESTRUTURA AWS

### Recursos criados pelo SAM (template.yaml)

| Recurso | Nome | Tipo |
|---------|------|------|
| Lambda | `ROLE_SC_API` | `AWS::Serverless::Function` |
| API Gateway | `role-sc-api` | `AWS::Serverless::Api` (REST API) |
| API Key | `role-sc-api-key` | `AWS::ApiGateway::ApiKey` |
| Usage Plan | `role-sc-usage-plan` | `AWS::ApiGateway::UsagePlan` |

### Configuração da Lambda

| Parâmetro | Valor |
|-----------|-------|
| Runtime | Node.js 24.x |
| Handler | `handler.handler` |
| Memória | 256 MB |
| Timeout | 30 segundos |

### Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `MONGODB_URI` | Connection string do MongoDB Atlas |
| `MONGODB_DB_NAME` | Nome do banco (`role_sc`) |
| `JWT_SECRET` | Secret para assinar tokens JWT |
| `JWT_EXPIRES_IN` | Tempo de expiração do token (padrão: `7d`) |

### Segurança do API Gateway

A API é protegida por 3 camadas:

| Camada | Protege contra | Onde atua | Resposta |
|--------|---------------|-----------|----------|
| **API Key** | Requests sem chave autorizada | API Gateway (Lambda não é invocada) | 403 Forbidden |
| **Throttling + Quota** | Abuso e DDoS | API Gateway | 429 Too Many Requests |
| **JWT** | Acesso não autenticado a dados | Lambda/Fastify | 401 Unauthorized |

**Throttling:**
- Rate limit: 50 requests/segundo
- Burst: 25 requests
- Quota diária: 10.000 requests

**CORS configurado:**
- Origins: `*`
- Headers: `Authorization`, `Content-Type`, `x-api-key`
- Methods: `GET`, `POST`, `OPTIONS`

### URL da API

Formato: `https://<id>.execute-api.sa-east-1.amazonaws.com/prod`

**Toda request precisa do header:** `x-api-key: <valor-da-api-key>`

Para obter o valor da API Key após deploy:
```bash
aws apigateway get-api-key --api-key <id-do-output> --include-value
```

---

## 5. BANCO DE DADOS

- **Cluster:** MongoDB Atlas (mesmo do crawler e NLP)
- **Banco:** `role_sc`
- **Coleções:** `eventos` (leitura), `users` (escrita)

### Coleção `eventos` (somente leitura)

Populada pelo NLP Processor. A API apenas consulta.

```typescript
interface Evento {
  _id?: ObjectId;
  titulo: string;
  descricao: string | null;
  dataInicio: Date | null;
  dataFim: Date | null;
  horario: string | null;
  local: string | null;
  categoria: string | null;
  isEvent: boolean;
  municipio: string;
  site: string;
  url: string;
  publishedAt: string;
  processedAt: Date;
  rawCrawlId: ObjectId;
}
```

**Índices existentes (criados pelo NLP Processor):**
- `{ url: 1 }` — único
- `{ municipio: 1, isEvent: 1 }` — composto
- `{ dataInicio: 1 }`

**Observação:** Documentos com `isEvent: false` são notícias que a IA classificou como não-eventos. A API filtra automaticamente por `isEvent: true` em todas as queries.

### Coleção `users` (escrita)

```typescript
interface User {
  _id?: ObjectId;
  nome: string;
  email: string;       // índice único
  senha: string;       // hash bcrypt (nunca retornar em responses)
  createdAt: Date;
}
```

**Índices (criados automaticamente pela API na inicialização):**
- `{ email: 1 }` — único

### Categorias válidas

```typescript
const CATEGORIAS_VALIDAS = [
  'Cultura', 'Esporte', 'Gastronomia', 'Educação', 'Saúde',
  'Meio Ambiente', 'Turismo', 'Religião', 'Outro',
] as const;
```

### Municípios ativos (com crawlers implementados)

`"Camboriú"`, `"Itajaí"`

---

## 6. CONTRATO DA API — ENDPOINTS

### Headers obrigatórios em TODAS as requests

```
x-api-key: <api-key-do-api-gateway>
```

### 6.1 Autenticação (rotas públicas — não precisam de JWT)

#### `POST /auth/register`

Cria uma nova conta de usuário.

**Request body:**
```json
{
  "nome": "Gabriel Prates",
  "email": "gabriel@email.com",
  "senha": "minhasenha123"
}
```

**Validações:**
- `nome`: string, mínimo 2 caracteres, obrigatório
- `email`: string, formato email válido, obrigatório, único
- `senha`: string, mínimo 6 caracteres, obrigatório

**Response 201:**
```json
{
  "success": true,
  "message": "Usuário criado com sucesso"
}
```

**Response 409 (email duplicado):**
```json
{
  "success": false,
  "message": "Email já cadastrado"
}
```

#### `POST /auth/login`

Autentica e retorna JWT.

**Request body:**
```json
{
  "email": "gabriel@email.com",
  "senha": "minhasenha123"
}
```

**Response 200:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "_id": "664a1b2c3d4e5f6a7b8c9d0e",
    "nome": "Gabriel Prates",
    "email": "gabriel@email.com",
    "createdAt": "2026-04-14T12:00:00.000Z"
  }
}
```

**Response 401 (credenciais inválidas):**
```json
{
  "success": false,
  "message": "Email ou senha inválidos"
}
```

---

### 6.2 Rotas protegidas (JWT obrigatório)

Todas as rotas abaixo exigem o header adicional:
```
Authorization: Bearer <token>
```

Se o token for inválido ou ausente, retorna **401**:
```json
{
  "success": false,
  "message": "Token inválido ou ausente"
}
```

#### `GET /auth/me`

Retorna os dados do usuário logado.

**Response 200:**
```json
{
  "success": true,
  "user": {
    "_id": "664a1b2c3d4e5f6a7b8c9d0e",
    "nome": "Gabriel Prates",
    "email": "gabriel@email.com",
    "createdAt": "2026-04-14T12:00:00.000Z"
  }
}
```

#### `GET /eventos`

Lista eventos com filtros e paginação. Retorna **apenas** documentos com `isEvent: true`.

**Query parameters (todos opcionais):**

| Param | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `municipio` | string | Filtrar por município | `Itajaí` |
| `categoria` | string | Filtrar por categoria | `Cultura` |
| `dataInicio` | string (YYYY-MM-DD) | Eventos a partir dessa data | `2026-04-01` |
| `dataFim` | string (YYYY-MM-DD) | Eventos até essa data | `2026-04-30` |
| `search` | string | Busca textual no título e descrição | `festival` |
| `page` | number | Página (default: 1) | `1` |
| `limit` | number | Itens por página (default: 20, max: 50) | `20` |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "664b...",
      "titulo": "3ª edição do Festival Sabores do Mar",
      "descricao": "Festival gastronômico com mais de 30 expositores na Praça Central.",
      "dataInicio": "2026-03-22T00:00:00.000Z",
      "dataFim": null,
      "horario": "10h às 22h",
      "local": "Praça Central, Camboriú",
      "categoria": "Gastronomia",
      "municipio": "Camboriú",
      "site": "Camboriú",
      "url": "https://camboriu.sc.gov.br/noticia/festival-sabores-do-mar",
      "publishedAt": "14 de março de 2026",
      "processedAt": "2026-03-14T09:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 47,
    "totalPages": 3
  }
}
```

**Ordenação padrão:** `{ dataInicio: -1 }` (eventos mais recentes primeiro).

#### `GET /eventos/:id`

Retorna os detalhes de um evento específico.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "_id": "664b...",
    "titulo": "Exposição Fotográfica Litoral Vivo",
    "descricao": "Exposição com fotos do litoral catarinense...",
    "dataInicio": "2026-03-15T00:00:00.000Z",
    "dataFim": "2026-04-15T00:00:00.000Z",
    "horario": "19h",
    "local": "Centro Cultural Itajaí",
    "categoria": "Cultura",
    "municipio": "Itajaí",
    "site": "Fundação Cultural de Itajaí",
    "url": "https://fundacaocultural.itajai.sc.gov.br/noticias/exposicao-litoral-vivo",
    "publishedAt": "10 de março de 2026",
    "processedAt": "2026-03-10T09:30:00.000Z"
  }
}
```

**Response 404:**
```json
{
  "success": false,
  "message": "Evento não encontrado"
}
```

#### `GET /municipios`

Retorna a lista de municípios que possuem eventos cadastrados.

**Response 200:**
```json
{
  "success": true,
  "data": ["Camboriú", "Itajaí"]
}
```

**Lógica:** `db.collection('eventos').distinct('municipio', { isEvent: true })`

#### `GET /categorias`

Retorna a lista fixa de categorias válidas.

**Response 200:**
```json
{
  "success": true,
  "data": ["Cultura", "Esporte", "Gastronomia", "Educação", "Saúde", "Meio Ambiente", "Turismo", "Religião", "Outro"]
}
```

---

## 7. FLUXO DE AUTENTICAÇÃO (JWT)

### Fluxo completo

```
1. POST /auth/register
   → Valida dados (JSON Schema do Fastify)
   → Verifica email duplicado
   → Hash bcryptjs da senha (salt rounds: 10)
   → Salva no MongoDB (coleção users)
   → Retorna 201

2. POST /auth/login
   → Busca user por email
   → Compara senha com bcrypt.compare()
   → Gera JWT com payload { userId, email }
   → Retorna 200 com token + dados do user (sem senha)

3. Requisição protegida
   → App envia headers: x-api-key + Authorization: Bearer <token>
   → API Gateway valida a API Key (403 se inválida)
   → auth.hook.ts extrai o token do header Authorization
   → Verifica com jwt.verify(token, JWT_SECRET)
   → Decodifica { userId, email } e injeta no request
   → Se inválido/expirado → 401
   → Se válido → prossegue para o handler da rota
```

### Configuração JWT
- **Algoritmo:** HS256 (padrão do jsonwebtoken)
- **Payload:** `{ userId: string, email: string }`
- **Expiração:** configurável via `JWT_EXPIRES_IN` (padrão: `"7d"`)
- **Secret:** variável de ambiente `JWT_SECRET`

---

## 8. ARQUITETURA DO CÓDIGO

```
src/
├── handler.ts                  ← entry point da Lambda
├── app.ts                      ← setup Fastify, plugins, registro de rotas, error handler
├── invoke-local.ts             ← servidor local para desenvolvimento (pnpm dev)
├── routes/
│   ├── auth.routes.ts          ← POST /auth/register, POST /auth/login, GET /auth/me
│   ├── evento.routes.ts        ← GET /eventos, GET /eventos/:id
│   └── metadata.routes.ts      ← GET /municipios, GET /categorias
├── services/
│   ├── auth.service.ts         ← lógica de registro, login, geração JWT
│   └── evento.service.ts       ← queries com filtros, paginação, busca
├── hooks/
│   └── auth.hook.ts            ← preHandler do Fastify que verifica JWT
├── database/
│   ├── mongodb.connection.ts   ← conexão singleton (reutilizada entre invocações Lambda)
│   └── repositories/
│       ├── user.repository.ts  ← findByEmail, findById, insertUser
│       └── evento.repository.ts ← findEventos, findEventoById, getDistinctMunicipios
├── types/
│   ├── user.types.ts           ← User, UserInsert, UserPublic
│   ├── evento.types.ts         ← Evento, Categoria, CATEGORIAS_VALIDAS
│   └── auth.types.ts           ← LoginBody, RegisterBody, JwtPayload
├── schemas/
│   ├── auth.schemas.ts         ← JSON Schema para validação do Fastify (register, login)
│   └── evento.schemas.ts       ← JSON Schema para query params de listagem
└── utils/
    ├── jwt.utils.ts            ← signToken, verifyToken, extractTokenFromHeader
    └── logger.utils.ts         ← createLogger (mesmo padrão do NLP)
```

### Design Patterns

- **Repository Pattern** — acesso ao banco encapsulado em funções isoladas
- **Service Layer** — lógica de negócio separada das rotas
- **Fastify Hooks** — `preHandler` para autenticação (não middleware Express-style)
- **JSON Schema Validation** — validação nativa do Fastify nos endpoints
- **Singleton** — conexão MongoDB reutilizada entre invocações Lambda

### Error Handler centralizado (app.ts)

| Código | Quando |
|--------|--------|
| 400 | Validação do JSON Schema falha (automático do Fastify) |
| 401 | Token JWT inválido/ausente ou credenciais erradas |
| 404 | Evento ou usuário não encontrado |
| 409 | Email já cadastrado |
| 500 | Erro interno (mensagem genérica, sem expor detalhes) |

---

## 9. COMO RODAR LOCALMENTE

```bash
# 1. Instalar dependências
pnpm install

# 2. Copiar .env.example para .env e preencher
cp .env.example .env

# 3. Rodar servidor de desenvolvimento
pnpm dev
# API disponível em http://localhost:3000
```

**Obs:** Localmente não precisa de API Key (o API Gateway não está no caminho). Apenas o JWT é necessário nas rotas protegidas.

---

## 10. COMO FAZER DEPLOY

```bash
# 1. Build (gera dist/handler.js)
pnpm build

# 2. Build do SAM
sam build

# 3. Deploy (primeira vez: --guided para configurar parâmetros)
sam deploy --guided

# 4. Obter valor da API Key (ID aparece no output do deploy)
aws apigateway get-api-key --api-key <ApiKeyId> --include-value
```

Os parâmetros do deploy (`MongoDbUri`, `MongoDbName`, `JwtSecret`, `JwtExpiresIn`) são salvos automaticamente em `samconfig.toml` após o primeiro `--guided`. Deploys subsequentes: `sam build && sam deploy`.

---

## 11. TRATAMENTO DE ERROS

- Validação via JSON Schema do Fastify (retorna 400 automaticamente com detalhes)
- Erros de autenticação: 401
- Recurso não encontrado: 404
- Email duplicado: 409
- Erros internos: 500 com mensagem genérica (sem expor detalhes)
- Erros de negócio usam `throw` com `statusCode` no objeto Error, capturados pelo error handler centralizado

---

## 12. FUNCIONALIDADES FUTURAS (não implementadas)

Estas funcionalidades estão no roadmap, mas **não foram implementadas nesta fase**. A arquitetura foi pensada para facilitar a adição futura:

- **Favoritos** — usuário salva eventos favoritos (`POST /favoritos`, `GET /favoritos`)
- **Notificações push** — avisar sobre novos eventos por município
- **Compartilhamento** — gerar link de compartilhamento de evento
- **Filtro por proximidade** — eventos próximos à localização do usuário

---

## 13. INFORMAÇÕES PARA O APP MOBILE

O app React Native (Expo) que consumirá esta API precisa:

1. **Armazenar a API Key** como constante/env no app (é fixa, não muda)
2. **Enviar `x-api-key`** em todas as requests
3. **Fluxo de auth:** register → login → armazenar token → enviar `Authorization: Bearer <token>` nas rotas protegidas
4. **Base URL:** `https://<id>.execute-api.sa-east-1.amazonaws.com/prod`
5. **Paginação:** usar `page` e `limit` nos query params, exibir total de páginas a partir de `pagination.totalPages`
6. **Filtros:** enviar como query params (`municipio`, `categoria`, `dataInicio`, `dataFim`, `search`)

---

*Documento gerado em abril de 2026 para transferência de contexto entre chats e documentação do TCC.*
