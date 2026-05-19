# Contrato de integração — Login com Google (OAuth2 / OIDC)

Documento compartilhado entre o agente do **backend** (`api`) e o agente do **frontend** (`role-sc-frontend`). Define a arquitetura, a configuração no Google Cloud Console, e o contrato de API para autenticação social via conta Google no Rolê SC.

> **Para o agente de backend:** esse é o documento autoritativo. O frontend já está implementado e funcional, esperando o endpoint. Qualquer divergência deve ser discutida antes de implementar.

> Documentos irmãos: `CONTRATO_VERIFICACAO_EMAIL.md`, `CONTRATO_RECUPERACAO_SENHA.md`, `CONTRATO_ALTERAR_SENHA.md`, `CONTRATO_AVATAR.md`, `CONTRATO_EDITAR_PERFIL.md`.

---

## 1. Contexto

O app já tem cadastro/login com email + senha. A funcionalidade nova é permitir que o usuário **entre ou se cadastre com a conta do Google**, sem precisar de senha.

Benefícios:
- Reduz atrito no onboarding (não precisa lembrar mais uma senha)
- Email vem **pré-verificado** pelo Google (não precisa do fluxo de verificação)
- Padrão da indústria, esperado em apps modernos

---

## 2. Decisões arquiteturais

| Decisão | Escolhido | Por quê |
|---------|-----------|---------|
| Fluxo OAuth | **OpenID Connect (id_token)** via `expo-auth-session` | Mais simples que troca de authorization_code server-side. O Google emite um JWT (`id_token`) assinado, o backend só valida. |
| Onde acontece a autenticação com Google | **No app** (frontend) | App abre browser do sistema, completa OAuth, recebe `id_token`. Backend nunca fala diretamente com Google nessa etapa. |
| O que o frontend envia ao backend | **`{ idToken: string }`** | Backend recebe, valida, e devolve nosso JWT |
| Validação do id_token no backend | **`google-auth-library`** (lib oficial do Google) | Valida assinatura, audience, expiração, etc. Em uma chamada. |
| Linking automático com email existente | **Sim, automático** se email bater | Decisão do produto (UX simples). Detalhes na seção 4.1. |
| Avatar do Google | **Usar a URL do Google direto** (`avatarUrl = picture do id_token`) | Zero custo, sempre atualizado. Sem cópia pro S3. |
| Email verificado | **Marcar como verificado automaticamente** | Google já valida o email antes de devolver. |
| Adicionar senha pra users-Google | **Fora do escopo** | Documentado como follow-up. Quem entrou via Google só loga via Google. |
| Escopo OAuth | **`openid email profile`** | Mínimo necessário. Sem atritos, sem revisão da Google. |

---

## 3. Setup no Google Cloud Console

Esse setup é **manual, feito uma vez** no console web da Google.

### 3.1 Criar projeto

1. Acessar https://console.cloud.google.com/
2. Criar novo projeto: "Rolê SC"
3. Selecionar o projeto recém-criado

### 3.2 Configurar OAuth Consent Screen

1. Menu: **APIs & Services → OAuth consent screen**
2. Escolher **External** (qualquer conta Google pode logar)
3. Preencher:
   - App name: `Rolê SC`
   - User support email: o email do dev
   - Developer contact: idem
   - App logo: opcional pro TCC
4. Em "Scopes", adicionar:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
5. Em "Test users", adicionar seu email + emails da banca + qualquer um que vá testar (enquanto o app estiver em "Testing mode")
6. Salvar. Fica em **Testing mode** (basta pra TCC, não precisa passar por verificação da Google).

### 3.3 Criar OAuth Client IDs

Precisa criar **DOIS** clients no mesmo projeto:

**A) Web application client** (usado pelo Expo Go em desenvolvimento, via `auth.expo.io` proxy)

1. Menu: **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Tipo: **Web application**
3. Name: `Rolê SC — Web (dev/Expo Go)`
4. Authorized redirect URIs:
   - `https://auth.expo.io/@<expo-owner>/role-sc`
   - (Substituir `<expo-owner>` pelo username no expo.dev — já está como `josephlucene` no `app.json`)
5. Criar. Copiar o **Client ID** gerado.
6. **Variável de ambiente do frontend:** `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`

**B) Android application client** (usado pelo APK próprio em produção)

1. Repetir o processo, mas tipo: **Android**
2. Name: `Rolê SC — Android (prod)`
3. Package name: `com.rolesc.app` (igual ao `android.package` em `app.json`)
4. SHA-1 fingerprint:
   - **Em build EAS Production:** rodar `eas credentials` → selecionar Android → Production → o SHA-1 aparece lá
   - Alternativa: download direto do `.aab` do EAS, extrair `keystore` e rodar `keytool -list -v -keystore <path>`
5. Criar. Copiar o **Client ID** gerado.
6. **Variável de ambiente do frontend:** `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

> ⚠️ O Android Client ID **NÃO TEM** "client secret" — Google entende que apps mobile não conseguem manter segredo, e o SHA-1 fingerprint serve como prova de autenticidade.

### 3.4 Qual Client ID o backend deve validar

A regra real é simples: **o `audience` do id_token é exatamente o `client_id` que foi usado na request OAuth pelo cliente**.

| Cenário | `client_id` na request | `audience` do id_token |
|---------|-------------------------|------------------------|
| Expo Go (dev), via `auth.expo.io` | `WEB_CLIENT_ID` | `WEB_CLIENT_ID` |
| APK próprio (prod), via scheme `rolesc://` | `ANDROID_CLIENT_ID` | `ANDROID_CLIENT_ID` |

**Decisão para o Rolê SC nesta fase:** **só APK de produção**. Não vamos testar Google Sign-In no Expo Go.

Portanto:
- **Backend valida audience contra apenas `ANDROID_CLIENT_ID`**
- Variável de ambiente do backend: **`GOOGLE_ANDROID_CLIENT_ID`** (mesmo valor que o frontend usa em `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`)
- Não precisa criar Web Client agora. Se um dia for testar no Expo Go, criar e adicionar como segundo audience (`google-auth-library` aceita array).

> ⚠️ **Consequência prática:** o botão "Continuar com Google" só vai funcionar em APK gerado via EAS Build (preview ou production). No Expo Go ele aparece (porque o `ANDROID_CLIENT_ID` está configurado) mas dará erro porque o `auth.expo.io` proxy não consegue usar Android Client. Está OK — testa pela primeira vez direto num build preview.

---

## 4. Alterações no modelo de dados

### 4.1 Coleção `users` — alterações

```ts
interface User {
  _id?: ObjectId;
  nome: string;
  email: string;
  emailVerified: boolean;
  // 🆕 Senha agora é OPCIONAL.
  // Users criados via Google não têm senha (ainda).
  senha?: string;
  // 🆕 ID único do usuário no Google. Permite linkar conta existente
  //    e detectar duplicatas em logins futuros.
  googleId?: string;
  avatarUrl?: string;
  createdAt: Date;
  // 🆕 Quando foi a última vez que linkamos/atualizamos pelo Google.
  //    Não é estritamente necessário, mas útil pra debug e auditoria.
  googleLinkedAt?: Date;
}
```

**Índice novo (não único):**
```js
db.collection('users').createIndex({ googleId: 1 }, { sparse: true });
```

> `sparse: true` porque a maioria dos users não vai ter `googleId` (entraram via email/senha).

### 4.2 Coleção `users` — validações que mudam

- `senha`: **antes** era obrigatória no insert. **Agora** é opcional. Tem que ajustar o schema do `register` pra não exigir, ou criar um repositório separado.
- `login` por email/senha: **rejeitar com mensagem clara** se o user existe mas não tem senha cadastrada (ex: criou só via Google). Detalhe na seção 4.3.

### 4.3 Regras de linking (lógica do endpoint `/auth/google`)

Quando o backend recebe um id_token válido:

```
1. Extrair { googleId, email, name, picture, email_verified } do id_token
2. Buscar user por googleId:
   ↓ existe? → login normal, retorna JWT
   ↓ não existe →

3. Buscar user por email:
   ↓ existe? → LINKING AUTOMÁTICO:
     • Set user.googleId = googleId
     • Set user.googleLinkedAt = now
     • Se user.emailVerified === false → marcar como true (Google já validou)
     • Se user.avatarUrl não existe → preencher com picture do Google
     • Retorna JWT, isNewUser: false
   ↓ não existe →

4. CRIAR novo user:
   • nome = name do Google
   • email = email do Google
   • emailVerified = true (Google já validou)
   • googleId = id
   • avatarUrl = picture
   • senha = undefined (não definida)
   • Retorna JWT, isNewUser: true
```

> **Cuidado de segurança no linking automático**: nós confiamos no `email_verified: true` do id_token do Google. Se por algum motivo `email_verified: false` (raro, mas possível), **NÃO fazer linking automático** — retornar erro pedindo ao usuário verificar o email no Google primeiro. Detalhe na seção 5.1.

### 4.4 Login via email/senha — ajuste

No `POST /auth/login`, se o user encontrado tem `senha === undefined`:

**Response 400 (NOVO caso):**
```json
{
  "success": false,
  "code": "PASSWORD_NOT_SET",
  "message": "Essa conta foi criada com Google. Entre com o Google."
}
```

> O frontend vai tratar esse código mostrando alert com sugestão. Tudo no contrato anterior continua valendo pra users que TÊM senha.

---

## 5. Contrato de API

### 5.1 `POST /auth/google` — novo

Troca um id_token do Google por um JWT nosso. Endpoint **público** (não autenticado).

**Request body:**
```json
{
  "idToken": "eyJhbGciOiJSUzI1NiIs..."
}
```

**Validações:**
- `idToken`: string, obrigatória

**Lógica:**

1. Validar o id_token usando `google-auth-library`:
   ```ts
   import { OAuth2Client } from 'google-auth-library';
   const client = new OAuth2Client();
   const ticket = await client.verifyIdToken({
     idToken,
     audience: process.env.GOOGLE_ANDROID_CLIENT_ID,
   });
   const payload = ticket.getPayload();
   if (!payload) throw new Error('Invalid token');
   ```

   > Se um dia for suportar mais clients (Web pra Expo Go, iOS, etc), passar array no `audience`: `[ANDROID_CLIENT_ID, WEB_CLIENT_ID, ...]`. A lib aceita.
2. Extrair: `payload.sub` (googleId), `payload.email`, `payload.email_verified`, `payload.name`, `payload.picture`
3. Se `email_verified !== true` → retornar **400** com `code: GOOGLE_EMAIL_NOT_VERIFIED`
4. Aplicar a lógica de linking da seção 4.3
5. Gerar nosso JWT (mesma assinatura/payload do `/auth/login`)
6. Retornar 200

**Response 200 (login ou criação ok):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "_id": "664a...",
    "nome": "Gabriel Prates",
    "email": "gabriel@gmail.com",
    "emailVerified": true,
    "avatarUrl": "https://lh3.googleusercontent.com/...",
    "createdAt": "2026-04-14T12:00:00.000Z"
  },
  "isNewUser": false
}
```

**Response 400 (id_token inválido / expirado / audience errado):**
```json
{
  "success": false,
  "code": "INVALID_GOOGLE_TOKEN",
  "message": "Não foi possível verificar suas credenciais Google."
}
```

**Response 400 (email não verificado no Google — raro):**
```json
{
  "success": false,
  "code": "GOOGLE_EMAIL_NOT_VERIFIED",
  "message": "Verifique seu email no Google antes de continuar."
}
```

> 🚨 **Importante**: o backend SEMPRE valida criptograficamente o id_token. NÃO confiar em payload decodificado sem `verifyIdToken`. Atacante pode forjar um JWT com email arbitrário se o backend não validar a assinatura.

---

### 5.2 `POST /auth/login` — modificação

Adicionar tratamento pra user sem senha (ver seção 4.4):

**Response 400 (NOVO):**
```json
{
  "success": false,
  "code": "PASSWORD_NOT_SET",
  "message": "Essa conta foi criada com Google. Entre com o Google."
}
```

Quando atual:
- Continua retornando 401 INVALID_CREDENTIALS pra senha errada ou user inexistente (antienumeration mantida no login)
- O caso `PASSWORD_NOT_SET` é diferenciado quando o user EXISTE mas não tem senha

> **Nota sobre antienumeration:** retornar `PASSWORD_NOT_SET` aqui revela que o email existe. Trade-off aceitável pela UX (o user precisa saber que tem uma conta Google e tentar por lá). Coerente com a decisão de "não somos um banco" da seção `CONTRATO_RECUPERACAO_SENHA.md` de não fazer antienumeration em `forgot-password`.

---

### 5.3 `GET /auth/me` — sem mudança contratual

Já retorna o user completo. O `avatarUrl` populado pelo Google funciona como qualquer outra URL pública.

---

## 6. Variáveis de ambiente

### 6.1 Backend

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `GOOGLE_ANDROID_CLIENT_ID` | OAuth Android Client ID do Google Console (mesmo valor que `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` do frontend) | `1234567890-abcdefg.apps.googleusercontent.com` |

### 6.2 Frontend (já configurado)

| Variável | Descrição |
|----------|-----------|
| `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` | Android Client ID (já criado no GCP) — usado em APK próprio |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Opcional nesta fase. Só será necessário se quisermos testar no Expo Go (dev). |

---

## 7. Permissões IAM

Nenhuma alteração na infra AWS. Google Sign-In acontece direto entre o app, o Google e o backend, sem AWS no meio.

---

## 8. Checklist de implementação para o agente do backend

- [ ] Instalar `google-auth-library`: `pnpm add google-auth-library`
- [ ] Adicionar `googleId?: string`, `googleLinkedAt?: Date` e tornar `senha` opcional no tipo `User` em `src/types/user.types.ts`
- [ ] Atualizar `UserPublic` se necessário (não inclui googleId no retorno — é metadado interno)
- [ ] Criar índice `{ googleId: 1, sparse: true }` na inicialização da conexão
- [ ] Atualizar `src/services/auth.service.ts`:
  - [ ] Novo método `googleLogin(idToken)` com toda a lógica das seções 4.3 e 5.1
  - [ ] Modificar `login`: se user existe mas não tem senha → 400 `PASSWORD_NOT_SET`
- [ ] Atualizar `src/routes/auth.routes.ts`:
  - [ ] `POST /auth/google` (público)
  - [ ] Schema do response de `/auth/login` aceita o novo `code: PASSWORD_NOT_SET`
- [ ] Atualizar `src/schemas/auth.schemas.ts` com schema do body `/auth/google`
- [ ] Adicionar `GOOGLE_ANDROID_CLIENT_ID` no `template.yaml` e `.env` (mesmo valor do `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` do frontend)
- [ ] **Setup manual no Google Cloud Console**: seguir seção 3 deste documento (criar projeto, OAuth Consent Screen, dois Client IDs)
- [ ] Atualizar `CONTEXTO_API_BACKEND.md` com o novo endpoint
- [ ] Testar manualmente:
  - Login Google em conta nova → cria user, retorna `isNewUser: true`
  - Login Google em conta existente → linka, retorna `isNewUser: false`
  - Login email/senha em conta que só tem Google → retorna `PASSWORD_NOT_SET`

---

## 9. Status do frontend (já implementado)

- ✅ `package.json` — adicionado `expo-auth-session ~7.0.9` e `expo-crypto ~15.0.7`
- ✅ `.env.example` — variáveis `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` e `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- ✅ `src/types/auth.types.ts` — tipos `GoogleLoginBody`, `GoogleLoginResponse` (com `isNewUser`)
- ✅ `src/services/auth.service.ts` — método `googleLogin(idToken)` → `POST /auth/google`
- ✅ `src/contexts/AuthContext.tsx` — método `signInWithGoogle(googleIdToken)` que orquestra o exchange e atualiza estado
- ✅ `src/hooks/useGoogleSignIn.ts` — encapsula OAuth + erro handling. Detecta automaticamente se CLIENT_IDs estão configurados.
- ✅ `src/components/GoogleSignInButton.tsx` — botão padronizado (logo `logo-google` do Ionicons em azul `#4285F4`, fundo branco)
- ✅ Telas atualizadas:
  - `LoginScreen` — botão "Continuar com Google" abaixo do divisor "OU"
  - `CadastroScreen` — botão "Continuar com Google" no topo do form + divisor "OU"
  - Ambas escondem o botão se `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` não estiver configurado (UX degrada graciosamente)

Comportamento esperado do app frente aos códigos do backend:

| Status / `code` | Comportamento do app |
|-----------------|----------------------|
| `200` em `/auth/google` (isNewUser: false) | Login normal, vai pra Home |
| `200` em `/auth/google` (isNewUser: true) | Login normal, vai pra Home (UX: poderia mostrar toast "Bem-vindo!" — futuro) |
| `400 INVALID_GOOGLE_TOKEN` | Alert genérico |
| `400 GOOGLE_EMAIL_NOT_VERIFIED` | Alert com mensagem específica do backend |
| `400 PASSWORD_NOT_SET` em `/auth/login` | (a tratar — alert com sugestão "Entre com Google") |

---

## 10. Princípios

- **id_token SEMPRE validado criptograficamente** server-side. Nunca confiar no payload sem `verifyIdToken`.
- **Audience correto** — sempre validar contra `GOOGLE_ANDROID_CLIENT_ID` (e qualquer outro client que vier a existir, em array).
- **`email_verified` obrigatório no id_token** — se vier false, recusar (caso de borda, raro).
- **Linking automático só quando seguro** — o critério é "mesmo email + email_verified=true no Google". Se essas duas condições não baterem, NÃO linkar.
- **Senha vira opcional, não nullable em código** — usar `senha?: string` (TypeScript). Nas queries, validar `if (!user.senha)` antes de comparar com bcrypt.
- **Avatar URL do Google é confiável** — Google serve `https://lh3.googleusercontent.com/...` que é estável e cacheável. Não tentar fazer proxy/copy.

---

## 11. Pontos em aberto (decisão futura)

- **Adicionar senha a user-Google**: hoje quem entrou só via Google só consegue logar via Google. Próximo passo seria um endpoint `POST /auth/set-password` (autenticado) que aceita só `{ senha }` se `user.senha === undefined`. Documentar e pular nesta fase.
- **Toast "Bem-vindo!" pra `isNewUser: true`**: o frontend ignora o flag hoje. Quando tiver toaster no app, plugar aqui.
- **Sign in with Apple**: análogo, mesma arquitetura mas com Apple ID em vez de Google. Necessário se um dia o app for pra iOS. Fora do escopo (Android only).
- **Revocação de credenciais Google**: se o user revogar o acesso pelo console do Google, ainda assim ele consegue logar com nosso JWT (porque o JWT é stateless, 7 dias). Fora do escopo. Padrão é só expirar o JWT.

---

*Documento v1 — criado pelo agente do frontend após implementação. Qualquer mudança requer comunicação entre os dois lados.*
