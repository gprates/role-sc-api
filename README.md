# role-sc-api

API REST do **Rolê SC**, que reúne eventos culturais e municipais do litoral de Santa Catarina. Atende o app Android e o site: lista e filtra os eventos que o crawler coleta e o processador NLP grava no MongoDB, autentica usuários (e-mail e senha ou Google) e guarda os dados de cada usuário (favoritos, comentários, curtidas, nome e foto de perfil).

- **Stack:** Node.js 24, TypeScript, Fastify 5, MongoDB (driver oficial), AWS SDK v3 (SES e S3), `google-auth-library`, JWT (HS256) e bcrypt.
- **Produção:** uma AWS Lambda (Fastify via `@fastify/aws-lambda`) atrás de um API Gateway REST com API Key e Usage Plan, publicada com AWS SAM (`template.yaml`).
- **Local e Docker:** o mesmo app roda como servidor HTTP na porta 3000, com a documentação OpenAPI em `/docs`.

```
crawler ──► raw_crawls ──► processador NLP ──► eventos (MongoDB) ◄──► role-sc-api ◄── app Android / site
                                                                       │
                                                                       ├─ SES  (e-mails de verificação e de senha)
                                                                       ├─ S3   (fotos de perfil)
                                                                       └─ Google (validação do id_token)
```

São 27 rotas: 10 de autenticação (`/auth/*`), 4 de eventos e comentários do evento (`/eventos/*`), 4 de favoritos, 4 de comentários, 3 de usuário (`/users/me/*`) e 2 de metadados (`/municipios`, `/categorias`). O contrato completo está em `/docs`.

## Pré-requisitos

- Node.js 24 ou mais recente e pnpm (o projeto usa pnpm 12)
- Docker, para o MongoDB local (ou um MongoDB acessível de outra forma)

## Rodar localmente

```bash
# 1. MongoDB local
docker run -d --name role-sc-mongo -p 27017:27017 mongo:7

# 2. Dependências
pnpm install

# 3. Variáveis de ambiente (os valores do exemplo já apontam para o Mongo local)
cp .env.example .env

# 4. Servidor de desenvolvimento, com recarga automática
pnpm dev
```

A API sobe em `http://localhost:3000`, e a documentação fica em `http://localhost:3000/docs`. O servidor escuta em `0.0.0.0`, ou seja, também fica acessível pela rede local.

Para rodar a versão compilada: `pnpm build` e depois `pnpm start`.

### Credenciais AWS na máquina local

O código não lê credenciais AWS: quem lê é o AWS SDK, pela cadeia padrão (variáveis `AWS_*`, `~/.aws`, role da Lambda). **Se a sua máquina tiver credenciais AWS configuradas, a API local vai usá-las**: o cadastro passaria a enviar e-mail de verdade pelo SES e as URLs de upload de avatar apontariam para o bucket real. Para desenvolver sem tocar na AWS, rode com credenciais falsas (ou acrescente essas linhas ao `.env`):

```bash
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_REGION=us-east-1 \
AWS_EC2_METADATA_DISABLED=true AWS_SHARED_CREDENTIALS_FILE=/nonexistent AWS_CONFIG_FILE=/nonexistent \
AWS_ENDPOINT_URL=http://127.0.0.1:9 \
pnpm dev
```

`AWS_ENDPOINT_URL` aponta todas as chamadas do SDK para uma porta local fechada, garantindo que nenhuma requisição saia para a AWS.

### Usuário e eventos de teste

O repositório não tem *seed*, e o cadastro pela API não termina sem SES (veja as limitações abaixo). Para testar as rotas autenticadas, insira um usuário já verificado direto no Mongo, com a senha em hash bcrypt:

```bash
HASH=$(node -e "console.log(require('bcryptjs').hashSync('Teste@1234', 10))")
docker exec role-sc-mongo mongosh role_sc --quiet --eval "
  db.users.insertOne({ nome: 'Usuária Teste', email: 'teste@exemplo.com', senha: '$HASH', emailVerified: true, createdAt: new Date() })"
```

Em produção os eventos vêm do crawler e do processador NLP. Para ter algo em `GET /eventos` localmente:

```bash
docker exec role-sc-mongo mongosh role_sc --quiet --eval "
  db.eventos.insertOne({ titulo: 'Festival de Música', descricao: 'Shows ao ar livre', dataInicio: new Date(Date.now() + 5*864e5),
    dataFim: null, horario: '19h', local: 'Praça Central', categoria: 'Cultura', imageUrl: null, isEvent: true,
    municipio: 'Itajaí', site: 'exemplo', url: 'https://exemplo.com/evento', publishedAt: new Date().toISOString(),
    processedAt: new Date(), rawCrawlId: new ObjectId() })"
```

Depois é só fazer login e usar o token:

```bash
curl -s -X POST http://localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"teste@exemplo.com","senha":"Teste@1234"}'

curl -s http://localhost:3000/eventos -H 'authorization: Bearer <token>'
```

### Limitações do ambiente local

| Recurso | O que acontece localmente |
|---|---|
| SES (e-mail) | `POST /auth/register` responde **500** e desfaz o cadastro; `POST /auth/forgot-password` responde 500 e descarta o código; `resend-verification` devolve a resposta genérica sem enviar nada. Sem o código de `forgot-password`, a redefinição de senha não se completa. `change-password` funciona; só o aviso por e-mail falha (fica no log). |
| Google | `POST /auth/google` exige Client IDs reais e acesso ao Google. Com `GOOGLE_*_CLIENT_ID` vazios, responde 500. |
| S3 (avatar) | `upload-url` gera uma URL assinada localmente, que não serve para nada sem credenciais reais; `confirm` falha ao consultar o S3 (500). |
| `x-api-key` | Não é verificado: quem cobra a chave é o API Gateway, só em produção. |
| CORS | `@fastify/cors` sem opções: o pré-voo do navegador não libera PATCH e DELETE. O site, em desenvolvimento, usa o proxy do Vite e não é afetado. |

## Rodar com Docker

O `Dockerfile` gera uma imagem `node:24-alpine` (multi-stage) que roda o servidor HTTP (`node dist/server.js`) na porta **3000**, como usuário `node`, com *healthcheck* em `GET /docs/json`. O `.env` não entra na imagem: as variáveis são passadas na execução.

```bash
docker build -t role-sc-api .

docker network create role-sc
docker run -d --name role-sc-mongo --network role-sc mongo:7
docker run -d --name role-sc-api --network role-sc -p 3000:3000 \
  -e MONGODB_URI=mongodb://role-sc-mongo:27017 \
  -e MONGODB_DB_NAME=role_sc \
  -e JWT_SECRET=troque-por-uma-string-longa-e-aleatoria \
  -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local -e AWS_REGION=us-east-1 \
  -e AWS_EC2_METADATA_DISABLED=true -e AWS_ENDPOINT_URL=http://127.0.0.1:9 \
  role-sc-api
```

Também dá para usar `--env-file .env`. Nesse caso, lembre que `localhost` dentro do container é o próprio container: use o nome do container do Mongo na mesma rede, como acima, ou `host.docker.internal` para um Mongo publicado no host. Não monte `~/.aws` no container.

A API responde em `http://localhost:3000` e a documentação em `http://localhost:3000/docs`. O Mongo só é conectado na primeira requisição que precisa dele, então o container sobe (e o *healthcheck* passa) mesmo antes de o banco estar disponível.

## Variáveis de ambiente

No servidor HTTP (`pnpm dev`, `pnpm start`, Docker) elas vêm do ambiente ou do `.env` (carregado com `dotenv`). Na Lambda vêm dos parâmetros do `template.yaml`.

| Variável | Obrigatória | Valor no `.env.example` | Parâmetro SAM | Para que serve |
|---|---|---|---|---|
| `MONGODB_URI` | sim | `mongodb://localhost:27017` | `MongoDbUri` | Conexão com o MongoDB |
| `MONGODB_DB_NAME` | sim | `role_sc` | `MongoDbName` | Banco; precisa ser o mesmo do crawler e do processador NLP |
| `JWT_SECRET` | sim | texto de exemplo | `JwtSecret` | Segredo HS256 dos tokens. Sem ele, login responde 500 e as rotas protegidas, 401 |
| `JWT_EXPIRES_IN` | não (padrão `7d`) | `7d` | `JwtExpiresIn` | Validade do token |
| `SES_FROM_EMAIL` | para e-mails | `nao-responda@exemplo.com` | `SesFromEmail` | Remetente verificado no SES |
| `SES_AWS_REGION` | para e-mails | `us-east-1` | `SesAwsRegion` | Região do SES |
| `APP_BASE_URL` | para e-mails | `http://localhost:3000` | `AppBaseUrl` | URL pública da própria API, usada no link `/auth/verify-email` do e-mail |
| `S3_AVATARS_BUCKET` | para avatar | nome de exemplo | `S3AvatarsBucket` | Bucket das fotos de perfil |
| `S3_AVATARS_REGION` | para avatar | `sa-east-1` | `S3AvatarsRegion` | Região do bucket |
| `GOOGLE_ANDROID_CLIENT_ID` | para login Google | vazio | `GoogleAndroidClientId` | Audience aceita no `id_token` (app Android) |
| `GOOGLE_WEB_CLIENT_ID` | para login Google | vazio | `GoogleWebClientId` | Audience aceita no `id_token` (web e Expo Go) |

Os Client IDs do Google precisam ser os mesmos usados pelo app (`EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`) e pelo site (`VITE_GOOGLE_WEB_CLIENT_ID`). Basta um dos dois estar preenchido.

## Documentação da API (Swagger)

Com o servidor rodando (`pnpm dev`, `pnpm start` ou Docker):

- `GET /docs`: Swagger UI
- `GET /docs/json` e `GET /docs/yaml`: especificação OpenAPI 3.0

A especificação é gerada a partir das rotas registradas no Fastify: corpo, query e parâmetros saem dos schemas de `src/schemas/*.ts`. Tags, resumos, autenticação e respostas são descritos em `src/openapi.ts`, que só altera o documento gerado (a validação e as respostas das rotas não mudam).

**Autenticação descrita na especificação:**

- `bearerAuth`: `Authorization: Bearer <JWT>`, obtido em `POST /auth/login` ou `POST /auth/google`. No botão *Authorize* da UI, cole só o token.
- `apiKey`: cabeçalho `x-api-key`, exigido **apenas em produção** pelo API Gateway, em todas as rotas exceto `GET /auth/verify-email`. Sem ele, o API Gateway responde 403 antes de chegar à Lambda. Localmente e no Docker pode ficar em branco.

**`/docs` não existe em produção.** A UI é registrada só pelo servidor HTTP (`src/invoke-local.ts`); o handler da Lambda (`src/handler.ts`) não a carrega, porque o `@fastify/swagger-ui` serve arquivos estáticos do próprio pacote em `node_modules`, que não vão para o bundle do esbuild (com a UI no bundle, todas as rotas passavam a responder 500). Além disso, em produção `/docs` cairia na rota `/{proxy+}` do API Gateway, que exige `x-api-key`, cabeçalho que o navegador não envia. Uma chamada a `/docs` em produção recebe 403 sem a chave e 404 com ela.

## Scripts

| Comando | O que faz |
|---|---|
| `pnpm dev` | `tsx watch src/invoke-local.ts`: servidor HTTP na porta 3000, com recarga automática |
| `pnpm build` | esbuild: gera `dist/handler.js` (Lambda, com todas as dependências) e `dist/server.js` (servidor HTTP, usa `node_modules`) |
| `pnpm start` | `node dist/server.js` (rode `pnpm build` antes) |
| `npx tsc --noEmit` | Checagem de tipos (não há script nem testes automatizados) |

## Deploy (AWS SAM)

O deploy é feito da máquina do desenvolvedor com o AWS SAM CLI; não há CI/CD. O `template.yaml` cria:

- a função Lambda `ROLE_SC_API` (Node 24, 256 MB, timeout de 30 s), com o handler `src/handler.ts`;
- a API REST (estágio `prod`) com `ApiKeyRequired: true` e duas rotas: `GET /auth/verify-email` sem API Key (é aberta pelo link do e-mail) e `ANY /{proxy+}` com API Key;
- a API Key, o Usage Plan (50 req/s, rajada de 25, 10.000 req/dia) e o vínculo entre os dois;
- o bucket S3 de avatares, com leitura pública em `avatars/*`, e as permissões da função para SES e S3.

### Pré-requisitos

- Conta AWS e credenciais locais com permissão para CloudFormation, Lambda, API Gateway, S3 e IAM; AWS SAM CLI; Node 24 e pnpm.
- MongoDB acessível pela Lambda (por exemplo, MongoDB Atlas com a rede liberada), com usuário de leitura e escrita no banco, inclusive para criar índices.
- Remetente verificado no SES na região de `SesAwsRegion`. Em *sandbox*, o SES só entrega para destinatários também verificados.
- Client IDs OAuth no Google Cloud Console, se o login com Google for usado.

### Passo a passo

1. **Dependências:** `pnpm install`.
2. **Build:** `sam build`. O SAM empacota `src/handler.ts` com o esbuild configurado nos metadados da função no `template.yaml` (CommonJS, minificado, sem dependências externas) e grava o resultado em `.aws-sam/build/`. Ele não usa `dist/` nem o `esbuild.config.js`, então `pnpm build` não é necessário para o deploy (serve para conferir o bundle localmente).
3. **Primeiro deploy:** `sam deploy --guided`. O assistente pergunta o nome da stack, a região e os parâmetros do template (tabela de variáveis acima), pede confirmação para criar a role IAM (`CAPABILITY_IAM`) e salva as respostas em `samconfig.toml`, que não é versionado. Os parâmetros `NoEcho` (`MongoDbUri`, `JwtSecret`, `GoogleAndroidClientId`, `GoogleWebClientId`) **não** ficam no `samconfig.toml`: nos deploys seguintes o SAM reaproveita os valores já gravados na stack, mas para recriar a stack do zero é preciso informá-los de novo.
4. **Saídas da stack:** `ApiUrl` (`https://<api-id>.execute-api.<regiao>.amazonaws.com/prod`), `ApiKeyId`, `FunctionArn`, `AvatarsBucketName` e `AvatarsBucketUrl`.
5. **Segundo deploy, por causa do `AppBaseUrl`:** o link do e-mail de verificação é montado com `AppBaseUrl`, mas a URL da API só é conhecida depois do primeiro deploy. Coloque a `ApiUrl` (ou o domínio próprio, se houver) em `AppBaseUrl`, rodando `sam deploy --guided` de novo ou editando `parameter_overrides` no `samconfig.toml`, e faça `sam build && sam deploy`. Um domínio próprio (custom domain e mapeamento de caminho) não faz parte do template e precisa ser configurado à parte no API Gateway.
6. **API Key:** o valor não aparece nas saídas. Busque-o com
   ```bash
   aws apigateway get-api-key --api-key <ApiKeyId> --include-value --query value --output text --region <regiao>
   ```
   e configure nos clientes (`EXPO_PUBLIC_API_KEY` no app; cabeçalho `x-api-key` enviado pelo site).
7. **Deploys seguintes:** `sam build && sam deploy`. O `samconfig.toml` guarda as respostas e o SAM mostra o *changeset* para confirmação antes de aplicar. Trocar um segredo (`JwtSecret`, `MongoDbUri`) também é um novo `sam deploy` com o parâmetro atualizado: não há Secrets Manager nem SSM.

## Estrutura

```
src/
  handler.ts         entrada da Lambda (Fastify via @fastify/aws-lambda)
  invoke-local.ts    servidor HTTP (pnpm dev, pnpm start, Docker), com /docs
  app.ts             montagem do Fastify: CORS, rotas e tratamento de erros
  openapi.ts         configuração do Swagger (tags, autenticação, respostas)
  routes/            rotas por recurso
  schemas/           JSON Schema de entrada das rotas
  services/          regras de negócio, SES, S3 e Google
  database/          conexão MongoDB e repositórios
  hooks/ utils/ types/
template.yaml        infraestrutura (SAM)
esbuild.config.js    build local (pnpm build)
Dockerfile           imagem do servidor HTTP
docs/                documentos de contexto e coleções Insomnia
```
