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
3. Envia emails de verificação via **AWS SES v2** e confirma a conta pela própria Lambda (HTML)
4. Permite **recuperação de senha** por código de 6 dígitos enviado por email
5. Protege rotas com verificação de token JWT + `emailVerified`
6. Fornece metadados auxiliares (lista de municípios e categorias)

A API é **somente leitura** em relação a eventos — ela consulta a coleção `eventos` populada pelo NLP Processor. A escrita ocorre em `users` (cadastro/verificação/troca de senha), `emailVerificationTokens`, `passwordResetCodes` e `passwordResetTokens` (todas com TTL).

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
| @aws-sdk/client-sesv2 | ^3.1036 | Envio de email de verificação (AWS SES v2) |
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
| `SES_FROM_EMAIL` | Remetente verificado no SES (email pessoal do dev ou do domínio) |
| `SES_AWS_REGION` | Região do SES (usar `us-east-1`; `sa-east-1` não tem SES) |
| `APP_BASE_URL` | Base URL pública da API, usada para montar o link no email (sem barra final) |

### Segurança do API Gateway

A API é protegida por 3 camadas:

| Camada | Protege contra | Onde atua | Resposta |
|--------|---------------|-----------|----------|
| **API Key** | Requests sem chave autorizada | API Gateway (Lambda não é invocada) | 403 Forbidden |
| **Throttling + Quota** | Abuso e DDoS | API Gateway | 429 Too Many Requests |
| **JWT + emailVerified** | Acesso não autenticado a dados ou conta não verificada | Lambda/Fastify | 401 / 403 (`EMAIL_NOT_VERIFIED`) |

> **Exceção intencional:** `GET /auth/verify-email` é público (sem `x-api-key`), pois é aberto pelo browser a partir do link do email. Isso é configurado com um Event SAM dedicado (`ApiKeyRequired: false`). Todas as outras rotas continuam exigindo a chave.

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
  email: string;           // índice único
  senha: string;           // hash bcrypt (nunca retornar em responses)
  emailVerified: boolean;  // false no cadastro, true após clicar no link do email
  createdAt: Date;
}
```

**Índices (criados automaticamente pela API na inicialização):**
- `{ email: 1 }` — único

### Coleção `emailVerificationTokens` (escrita)

```typescript
interface EmailVerificationToken {
  _id?: ObjectId;
  userId: ObjectId;   // referência ao user
  token: string;      // hex de 64 chars (crypto.randomBytes(32))
  expiresAt: Date;    // now + 24h
  createdAt: Date;
}
```

**Índices (criados automaticamente pela API na inicialização):**
- `{ expiresAt: 1 }` com `expireAfterSeconds: 0` — **TTL**, auto-deleta documentos expirados
- `{ token: 1 }` — único, lookup rápido na rota de verificação
- `{ userId: 1 }` — cleanup rápido ao reenviar verificação

> **Observação sobre o TTL:** o monitor TTL do MongoDB roda a cada ~60s, então um token expirado pode ficar no banco por até 60s antes de ser deletado. A rota `GET /auth/verify-email` checa `expiresAt > now` explicitamente além de confiar no TTL.

### Coleção `passwordResetCodes` (escrita)

```typescript
interface PasswordResetCode {
  _id?: ObjectId;
  userId: ObjectId;   // referência ao user
  code: string;       // 6 dígitos numéricos (crypto.randomInt)
  expiresAt: Date;    // now + 15min
  createdAt: Date;
}
```

**Índices (criados automaticamente pela API na inicialização):**
- `{ expiresAt: 1 }` com `expireAfterSeconds: 0` — **TTL**, auto-deleta documentos expirados
- `{ userId: 1 }` — lookup por (userId, code) e cleanup

> **Por que NÃO há índice único em `code`:** códigos curtos (6 dígitos = 1M possibilidades) não devem ser globalmente únicos. O lookup correto é sempre por `(userId, code)` — buscar só por `code` permitiria brute force trivial.

### Coleção `passwordResetTokens` (escrita)

```typescript
interface PasswordResetToken {
  _id?: ObjectId;
  userId: ObjectId;   // referência ao user
  token: string;      // hex de 64 chars (crypto.randomBytes(32))
  expiresAt: Date;    // now + 15min
  createdAt: Date;
}
```

**Índices (criados automaticamente pela API na inicialização):**
- `{ expiresAt: 1 }` com `expireAfterSeconds: 0` — **TTL**, auto-deleta documentos expirados
- `{ token: 1 }` — único, lookup rápido na rota de troca de senha
- `{ userId: 1 }` — cleanup ao gerar novo token / após reset bem-sucedido

> **Separação de concerns:** o `code` (6 dígitos, curto, fácil de digitar) prova "você é dono desse email". Após validar, emite-se um `resetToken` (32 bytes hex) que é a credencial efetiva pra trocar a senha. Os dois ficam em coleções separadas com TTLs próprios. Ambos são single-use.

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

Após o insert, a API gera um token hex de 32 bytes, salva em `emailVerificationTokens` com `expiresAt = now + 24h` e dispara um email via SES. O usuário **não recebe JWT** no cadastro — precisa verificar o email antes de poder logar.

**Response 201:**
```json
{
  "success": true,
  "message": "Conta criada. Verifique seu email para ativar sua conta."
}
```

**Response 409 (email duplicado):**
```json
{
  "success": false,
  "message": "Email já cadastrado"
}
```

> Se o email já está cadastrado porém não verificado, a resposta continua sendo 409. O usuário deve usar `POST /auth/resend-verification`.

**Response 500 (falha no envio do email):**

Se o SES falhar, a API **desfaz** a inserção do user e do token (compensação manual) antes de responder:

```json
{
  "success": false,
  "message": "Falha ao enviar email de verificação. Tente novamente em alguns minutos."
}
```

#### `POST /auth/login`

Autentica e retorna JWT. **Exige `emailVerified: true` no usuário.**

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
    "emailVerified": true,
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

**Response 403 (email não verificado):**
```json
{
  "success": false,
  "code": "EMAIL_NOT_VERIFIED",
  "message": "Email ainda não verificado. Verifique sua caixa de entrada ou solicite um novo link."
}
```

> O campo `code` é **obrigatório** nesse caso — o frontend usa pra detectar esse 403 específico e redirecionar pra tela de verificação.

#### `POST /auth/resend-verification`

Reenvia o email de verificação. **Público (sem JWT).** Rate-limited em 1 reenvio por email a cada 60s.

**Request body:**
```json
{ "email": "gabriel@email.com" }
```

**Response 200 (sempre — mesmo se o email não existe, para evitar enumeration):**
```json
{
  "success": true,
  "message": "Se o email estiver cadastrado e pendente de verificação, você receberá um novo link em alguns minutos."
}
```

**Comportamento interno:**
- Email não cadastrado → retorna 200 sem enviar nada
- Email já verificado → retorna 200 sem enviar nada
- Token mais recente tem `< 60s` → retorna 200 sem reenviar (rate limit)
- Caso contrário: deleta tokens antigos, gera novo token (32 bytes hex, `expiresAt = now + 24h`), envia SES

#### `GET /auth/verify-email?token=XXX`

Endpoint **público** (sem `x-api-key`, sem JWT). Aberto pelo browser a partir do link do email. Resposta **sempre** `text/html; charset=utf-8`.

- **200** (sucesso): página HTML de confirmação. Marca `users.emailVerified = true` e deleta o token da coleção.
- **400** (token ausente/inválido/expirado): página HTML de erro com instrução pra solicitar novo link.

Além do TTL do Mongo, a rota valida `expiresAt > now` explicitamente.

#### `POST /auth/forgot-password`

Inicia o fluxo de recuperação de senha. **Público (sem JWT).** Sempre retorna mensagem genérica (anti-enumeration).

**Request body:**
```json
{ "email": "gabriel@email.com" }
```

**Response 200 (sempre):**
```json
{
  "success": true,
  "message": "Se o email estiver cadastrado, você receberá um código em alguns minutos."
}
```

**Comportamento interno:**
- Email não cadastrado → 200 sem fazer nada
- Email cadastrado mas `emailVerified: false` → 200 sem fazer nada
- Último código gerado tem `< 60s` (rate limit) → 200 sem reenviar
- Caso contrário: deleta códigos antigos do user, gera código de 6 dígitos via `crypto.randomInt(100000, 1000000)`, salva em `passwordResetCodes` com `expiresAt = now + 15min` e dispara email via SES com o código

#### `POST /auth/verify-reset-code`

Valida o código digitado e devolve um `resetToken` que será usado na troca de senha. Diferentemente dos outros endpoints, **pode** retornar erro específico — sem isso a UX seria inviável (usuário ficaria preso sem saber se o código está errado).

**Request body:**
```json
{
  "email": "gabriel@email.com",
  "code": "374829"
}
```

**Validações:**
- `email`: formato válido
- `code`: string com exatamente 6 dígitos (regex `^[0-9]{6}$`)

**Response 200:**
```json
{
  "success": true,
  "resetToken": "a1b2c3d4...64chars"
}
```

**Response 400 (código errado/expirado/inexistente):**
```json
{
  "success": false,
  "code": "INVALID_RESET_CODE",
  "message": "Código inválido ou expirado."
}
```

> Mesmo erro retornado se o email não existir — pra não vazar a existência da conta. O lookup é sempre `(userId, code)`, não só por `code` (proteção contra brute force).

**Side effects ao validar com sucesso:**
- Deleta o código (single-use)
- Deleta tokens antigos do mesmo `userId` em `passwordResetTokens`
- Gera `resetToken` (32 bytes hex) com `expiresAt = now + 15min`

#### `POST /auth/reset-password`

Efetiva a troca de senha. Exige um `resetToken` válido (obtido em `verify-reset-code`).

**Request body:**
```json
{
  "email": "gabriel@email.com",
  "resetToken": "a1b2c3d4...64chars",
  "novaSenha": "MinhaNovaSenh@123"
}
```

**Validações server-side da `novaSenha` (mesmas do client em `src/utils/passwordValidator.ts`):**
- Mínimo 8 caracteres
- Pelo menos 1 letra maiúscula `[A-Z]`
- Pelo menos 1 letra minúscula `[a-z]`
- Pelo menos 1 dígito `[0-9]`
- Pelo menos 1 caractere especial `[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?~`]`

**Response 200:**
```json
{
  "success": true,
  "message": "Senha alterada com sucesso."
}
```

**Response 400 (token inválido/expirado/inexistente):**
```json
{
  "success": false,
  "code": "INVALID_RESET_TOKEN",
  "message": "O processo de recuperação expirou. Solicite um novo código."
}
```

**Response 400 (senha fraca):**
```json
{
  "success": false,
  "code": "WEAK_PASSWORD",
  "message": "A senha não cumpre todos os requisitos de segurança."
}
```

**Side effects ao trocar a senha com sucesso:**
- `users.senha` recebe novo hash bcrypt (10 rounds)
- Cleanup completo: deleta TODOS os `passwordResetTokens` E `passwordResetCodes` do `userId`
- Envia email de notificação "sua senha foi alterada" via SES (não-bloqueante: se o SES falhar, log o erro mas ainda retorna 200 — a senha já foi trocada)

> **JWTs antigos continuam válidos.** Hoje os tokens são stateless e não há blacklist. Implementar `tokenVersion` no payload é um follow-up planejado mas fora desta fase.

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
    "emailVerified": true,
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

## 7. FLUXO DE AUTENTICAÇÃO (JWT + verificação de email)

### Fluxo completo

```
1. POST /auth/register
   → Valida dados (JSON Schema do Fastify)
   → Verifica email duplicado
   → Hash bcryptjs da senha (salt rounds: 10)
   → Insere user com emailVerified: false
   → Gera token hex (crypto.randomBytes(32)) e salva em emailVerificationTokens
     com expiresAt = now + 24h
   → Envia email via AWS SES (SendEmail v2) com link {APP_BASE_URL}/auth/verify-email?token=...
   → Se o SES falhar: compensa (deleta token + user) e retorna 500
   → Sucesso: retorna 201 SEM JWT

2. GET /auth/verify-email?token=XXX  (aberto no browser, público)
   → Busca token em emailVerificationTokens
   → Não encontrado OU expiresAt <= now → HTML de erro
   → Encontrado → marca users.emailVerified = true, deleta token, HTML de sucesso

3. POST /auth/resend-verification   (público, sem JWT, rate-limited 60s)
   → Sempre retorna 200 com mensagem genérica (anti-enumeration)
   → Se o user existe E !emailVerified E último token tem >= 60s:
       deleta tokens antigos, gera novo, envia email

4. POST /auth/login
   → Busca user por email
   → Compara senha com bcrypt.compare()
   → Se user.emailVerified !== true → 403 { code: 'EMAIL_NOT_VERIFIED' }
   → Gera JWT com payload { userId, email }
   → Retorna 200 com token + dados do user (sem senha, com emailVerified)

5. Requisição protegida
   → App envia headers: x-api-key + Authorization: Bearer <token>
   → API Gateway valida a API Key (403 se inválida)
   → auth.hook.ts extrai o token do header Authorization
   → Verifica com jwt.verify(token, JWT_SECRET)
   → Decodifica { userId, email } e injeta no request
   → Se inválido/expirado → 401
   → Se válido → prossegue para o handler da rota

6. Recuperação de senha (todas públicas, sem JWT)
   POST /auth/forgot-password
     → Sempre 200 com mensagem genérica (anti-enumeration)
     → Se user existe E emailVerified E último código tem >= 60s:
         deleta códigos antigos, gera 6 dígitos via crypto.randomInt,
         salva em passwordResetCodes (expiresAt = now + 15min),
         envia email via SES com o código

   POST /auth/verify-reset-code
     → Lookup em passwordResetCodes por (userId, code) com expiresAt > now
     → Inválido/expirado → 400 { code: 'INVALID_RESET_CODE' }
     → Válido: deleta o código + tokens antigos do user, gera resetToken
       (32 bytes hex, expiresAt = now + 15min) e salva em passwordResetTokens
     → Retorna 200 com resetToken

   POST /auth/reset-password
     → Lookup em passwordResetTokens por token (e userId casa) com expiresAt > now
     → Inválido/expirado → 400 { code: 'INVALID_RESET_TOKEN' }
     → Valida força da senha (regex == frontend)
       Falhou → 400 { code: 'WEAK_PASSWORD' }
     → Hash bcrypt (10 rounds), updatePassword no users
     → Cleanup completo: deleta TODOS os tokens E códigos do user
     → Envia email "sua senha foi alterada" (não-bloqueante)
     → Retorna 200
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
├── app.ts                      ← setup Fastify, plugins, registro de rotas, error handler (propaga `code` UPPER_SNAKE_CASE)
├── invoke-local.ts             ← servidor local para desenvolvimento (pnpm dev)
├── routes/
│   ├── auth.routes.ts          ← POST /auth/register, POST /auth/login, GET /auth/me,
│   │                             GET /auth/verify-email (HTML), POST /auth/resend-verification,
│   │                             POST /auth/forgot-password, POST /auth/verify-reset-code,
│   │                             POST /auth/reset-password
│   ├── evento.routes.ts        ← GET /eventos, GET /eventos/:id
│   └── metadata.routes.ts      ← GET /municipios, GET /categorias
├── services/
│   ├── auth.service.ts         ← register, login, verifyEmail, resendVerification, getMe,
│   │                             forgotPassword, verifyResetCode, resetPassword
│   ├── email.service.ts        ← sendVerificationEmail, sendResetCodeEmail,
│   │                             sendPasswordChangedEmail (AWS SES v2)
│   └── evento.service.ts       ← queries com filtros, paginação, busca
├── hooks/
│   └── auth.hook.ts            ← preHandler do Fastify que verifica JWT
├── database/
│   ├── mongodb.connection.ts   ← conexão singleton (reutilizada entre invocações Lambda)
│   └── repositories/
│       ├── user.repository.ts  ← findByEmail, findById, insertUser, deleteById,
│       │                         markEmailVerified, updatePassword
│       ├── emailVerification.repository.ts ← create, findByToken, deleteByUserId,
│       │                                       deleteByToken, findLatestByUserId (+ TTL index)
│       ├── passwordResetCode.repository.ts ← create, findByUserAndCode, deleteByUserId,
│       │                                       findLatestByUserId (+ TTL index)
│       ├── passwordResetToken.repository.ts ← create, findByToken, deleteByUserId
│       │                                       (+ TTL index, unique no token)
│       └── evento.repository.ts ← findEventos, findEventoById, getDistinctMunicipios
├── types/
│   ├── user.types.ts           ← User, UserInsert, UserPublic (inclui emailVerified)
│   ├── emailVerification.types.ts ← EmailVerificationToken, EmailVerificationTokenInsert
│   ├── passwordReset.types.ts  ← PasswordResetCode, PasswordResetToken (+ Insert)
│   ├── evento.types.ts         ← Evento, Categoria, CATEGORIAS_VALIDAS
│   └── auth.types.ts           ← LoginBody, RegisterBody, ResendVerificationBody,
│                                  VerifyEmailQuery, JwtPayload, VerifyEmailResult,
│                                  ForgotPasswordBody, VerifyResetCodeBody, ResetPasswordBody
├── schemas/
│   ├── auth.schemas.ts         ← JSON Schema: register, login, resendVerification,
│   │                             forgotPassword, verifyResetCode, resetPassword
│   │                             (verify-email NÃO usa schema — handler retorna HTML)
│   └── evento.schemas.ts       ← JSON Schema para query params de listagem
└── utils/
    ├── jwt.utils.ts            ← signToken, verifyToken, extractTokenFromHeader
    ├── emailVerifyPages.ts     ← renderSuccessPage, renderErrorPage, escapeHtml
    ├── passwordValidator.ts    ← isStrongPassword (regex em sincronia com o frontend)
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
| 403 | Email ainda não verificado (payload inclui `code: 'EMAIL_NOT_VERIFIED'`) |
| 404 | Evento ou usuário não encontrado |
| 409 | Email já cadastrado |
| 500 | Erro interno (mensagem genérica, sem expor detalhes) |

**Convenção do campo `code`:** O error handler propaga `error.code` no payload JSON quando:
- `statusCode < 500`
- `code` casa com `^[A-Z][A-Z0-9_]*$` (UPPER_SNAKE_CASE do nosso domínio)
- `code` não começa com `FST_` (Fastify) nem `ERR_` (Node)

Códigos ativos: `EMAIL_NOT_VERIFIED`, `INVALID_RESET_CODE`, `INVALID_RESET_TOKEN`, `WEAK_PASSWORD`.

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

Os parâmetros do deploy (`MongoDbUri`, `MongoDbName`, `JwtSecret`, `JwtExpiresIn`, `SesFromEmail`, `SesAwsRegion`, `AppBaseUrl`) são salvos automaticamente em `samconfig.toml` após o primeiro `--guided`. Deploys subsequentes: `sam build && sam deploy`.

**Pré-requisitos do SES antes do primeiro deploy:**

1. No console do SES (região `us-east-1`), verificar o email do dev em **Verified identities** (modo sandbox).
2. Verificar também cada email destinatário de teste (sandbox só envia para identidades verificadas).
3. A Lambda já tem permissão IAM para `ses:SendEmail` / `ses:SendRawEmail` via `Policies` no `template.yaml`.
4. Após o primeiro deploy, pegar a `ApiUrl` do output e colocar em `AppBaseUrl` (re-deploy).

---

## 11. TRATAMENTO DE ERROS

- Validação via JSON Schema do Fastify (retorna 400 automaticamente com detalhes)
- Erros de autenticação: 401
- Email não verificado no login: 403 com `code: 'EMAIL_NOT_VERIFIED'`
- Recurso não encontrado: 404
- Email duplicado: 409
- Erros internos: 500 com mensagem genérica (sem expor detalhes)
- Falha no SES durante `/auth/register`: 500 após compensação (rollback do user e do token)
- `GET /auth/verify-email` **nunca** retorna JSON — erros viram HTML (status 400 ou 200 conforme o caso)
- Erros de negócio usam `throw` com `statusCode` (e opcionalmente `code`) no objeto Error, capturados pelo error handler centralizado

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
