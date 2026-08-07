# Security Review — T014: Mount-order pós-migração `@apollo/server` v4

**Executado por:** Security Specialist — 2026-08-07
**Escopo:** `packages/express`, `packages/fastify`, `packages/koa` (migrados nesta task para `@apollo/server` v4) e `packages/hapi` (não migrado, verificado por completude). Foco: bypass de autenticação por reordenação/mudança do ponto de montagem de CORS, body-parsing e middleware do adapter em relação ao middleware de auth registrado pelo app consumidor (`examples/*/with-basic-auth.ts`).

## Metodologia

1. Leitura estática do código pós-migração de cada adapter (`packages/{express,fastify,koa,hapi}/src/index.ts`) e do respectivo exemplo `with-basic-auth.ts`, traçando o caminho real da requisição até o resolver GraphQL.
2. Verificação empírica (smoke test HTTP real, sem mocks) para **express**, **koa** e **fastify**, reproduzindo os exemplos oficiais contra um servidor real na máquina local (queues vazias, igual aos próprios exemplos — não depende de Redis). Scripts descartáveis em `/tmp/qa-apollo-runtime/authtest/` (fora do repositório, não commitados). Ambiente: symlinks de validação local já preparados pelo QA em T012/T013 (`node_modules/@bull-monitor/root` apontando para o `packages/root` da branch); instalei apenas `express-basic-auth`, `koa-basic-auth`, `fastify-basic-auth`, `koa`/`koa-router` com `--no-save --no-package-lock` para rodar os testes — confirmado via `mtime` dos lockfiles e `git status` que nenhum arquivo do repositório foi alterado.
3. **Nenhum código de produção foi alterado.** Nenhum bug foi corrigido — apenas documentado.

## Achados

### 1. `packages/express` — SEM bypass (verificado empiricamente)

Fluxo real: `app.use(baseUrl, basicAuth(...))` é registrado **antes** de `app.use(baseUrl, monitor.router)`. O Express executa middlewares casados pelo mesmo prefixo de path na ordem de registro, independente do que existe dentro do router montado depois. Isso significa que **nenhuma rota interna do `monitor.router`** (nem `router.get('/')` da UI, nem `router.use(gqlBasePath, cors(), express.json(), expressMiddleware(...))` do GraphQL) é alcançada sem antes passar pelo `basicAuth` do app consumidor.

Teste HTTP real (`test-express.js`):
| Requisição | Status |
|---|---|
| UI sem auth | 401 |
| UI com auth | 200 |
| GraphQL sem auth | 401 |
| GraphQL com auth | 400 (chega à camada Apollo — GET sem `query` — comportamento esperado, não é bloqueio de auth) |

CORS/body-parsing explícitos (`cors()`, `express.json()`) ficam **dentro** do `router.use(gqlBasePath, ...)`, ou seja, depois do ponto onde o auth do consumidor já filtrou a requisição. Não há caminho alternativo.

**Veredito: sem bypass.**

### 2. `packages/koa` — SEM bypass (verificado empiricamente)

Fluxo real: `monitor.init({ middleware: basicAuth(...) })` registra `router.use(middleware)` **antes** de `router.get/post(gqlBasePath, cors(), bodyParser(), koaMiddleware(...))` e antes de `router.get('/', ...)` (UI). Em `koa-router`, layers casados pelo mesmo caminho são compostos na ordem de registro (`this.stack`); um `router.use()` sem path casa com todas as rotas do router e roda primeiro. `app.use(monitor.router.routes())` não introduz nenhum desvio.

Teste HTTP real (`test-koa.js`):
| Requisição | Status |
|---|---|
| UI sem auth | 401 |
| UI com auth | 200 |
| GraphQL sem auth | 401 |
| GraphQL com auth | 400 (mesmo motivo do express — GET sem `query`) |

**Veredito: sem bypass.**

### 3. `packages/fastify` — SEM bypass (verificado empiricamente, com ressalva sobre o exemplo)

**Achado colateral confirmado (não é escopo do T014, já sinalizado por QA em T011)**: `examples/fastify/with-basic-auth.ts` chama `monitor.init()` **sem** o argumento `app`, obrigatório em `InitParams`. Isso faz o adapter lançar `TypeError` em `ApolloServerPluginDrainHttpServer({ httpServer: app.server })` (`app` é `undefined`) — o exemplo, como está, **não sobe**. Confirmado empiricamente ao tentar rodar o exemplo literal.

Para avaliar a pergunta real do T014 (ordem de montagem de auth vs. CORS/hooks), rodei um script de teste equivalente que corrige **apenas no script de teste** (fora do repositório) essa chamada para `monitor.init({ app })`, conforme o próprio tipo `InitParams` exige — sem tocar em `examples/` nem em `packages/fastify/src`.

Fluxo real (com a chamada corrigida): `instance.addHook('preHandler', app.basicAuth)` é registrado **antes** de `instance.register(monitor.plugin)`. O modelo de encapsulamento do Fastify propaga hooks de um escopo pai para todo escopo filho registrado **depois** do `addHook` — isso vale recursivamente, então tanto a rota da UI (`instance.get(this.uiEndpoint, ...)`, registrada dentro do plugin) quanto a rota GraphQL (registrada um nível mais profundo, dentro do sub-escopo `instance.register(async (gqlScope) => {...})` usado só para escopar o CORS) herdam o `preHandler` de auth. O CORS (`fastify-cors`, registrado no sub-escopo) atua em `onRequest`, que sempre roda antes de `preHandler` no ciclo de vida do Fastify — mas isso não expõe dados: CORS apenas adiciona headers/responde preflight, não executa o resolver.

Teste HTTP real (`test-fastify.js`, com a correção local do `init({ app })`):
| Requisição | Status |
|---|---|
| UI sem auth | 401 |
| UI com auth | 200 |
| GraphQL sem auth | 401 |
| GraphQL com auth | 400 (mesmo motivo — GET sem `query`) |

**Veredito: sem bypass**, condicionado à correção do bug de chamada no exemplo (que é responsabilidade do Developer/Tech Lead, não deste review). Enquanto o bug não for corrigido, o exemplo falha **fechado** (crash no boot), não aberto (não existe cenário em que ele suba e sirva GraphQL sem auth) — portanto o bug em si não é uma vulnerabilidade de bypass, é um defeito de disponibilidade/DX do exemplo.

### 4. `packages/hapi` — SEM alteração de comportamento (confirmado via diff, não migrado nesta task)

`git diff packages/hapi/src/index.ts` confirma que a única mudança foi a forma de construir o `ApolloServer` (agora localmente, usando `typeDefs`/`resolvers`/`createContext()` exportados por `@bull-monitor/root`, para acompanhar a remoção de `createServer()` da classe base). A montagem das rotas — `app.route({ method: 'GET', options: { auth }, path: uiEndpoint, ... })` e `server.applyMiddleware({ app, path: gqlEndpoint, route: { auth } })` — está **byte-a-byte idêntica** ao código anterior. O modelo de auth por-rota do Hapi (`route.auth`) é resolvido pelo próprio ciclo de vida do framework (auth roda antes do handler independentemente de ordem de `server.register`), não por ordenação de middleware — não é afetado por esta migração.

**Veredito: sem mudança de comportamento, sem bypass.**

### 5. CORS permissivo (`origin: '*'` / default) — Low, débito conhecido, não bloqueante

- `express`: `cors()` sem opções → default permissivo (`Access-Control-Allow-Origin: *`).
- `koa`: `cors({ origin: '*' })` — literal, explicitamente documentado no código como decisão deliberada (não usar o default de refletir `Origin`, para não ficar mais permissivo em caso de uso futuro de `credentials`).
- `fastify`: `fastify-cors` sem opções → mesmo default permissivo.

Isso reproduz o comportamento das libs `apollo-server-*` v2/v3 descontinuadas (confirmado pelos devs em `tasks.md` ao inspecionar o `dist/ApolloServer.js` publicado das versões antigas) — **não é regressão desta migração**. Já está documentado em `memorys/architecture.md` → "🛡️ Modelo de Ameaças" ("Sem autenticação/autorização nativa... sem CSRF/CORS configurados nativamente"). CORS não concede acesso por si (não é controle de autorização) — só relaxa a same-origin policy do navegador. Combinado com a ausência de auth nativa (débito já conhecido e aceito), o risco real já está coberto pelo Modelo de Ameaças existente.

**Severidade: Low.** Não bloqueia esta migração — é debt pré-existente, não introduzido por ela.

### 6. Ausência de auth nativa / rate limiting — já conhecido, fora de escopo

Reafirma o Modelo de Ameaças já documentado: nenhum adapter tem controle de acesso embutido; qualquer requisição que alcance a rota tem leitura/escrita total sobre as queues. Isso é pré-existente ao upstream original e já está registrado como débito técnico consciente — não é introduzido nem agravado por esta migração.

**Severidade: Medium (residual, já aceito)** — mantido como está, sem ação nesta task.

## Resumo de Severidade

| # | Achado | Severidade | Bloqueia release? |
|---|---|---|---|
| 1 | Bypass de auth no mount-order (express/koa/fastify/hapi) | — | **Nenhum bypass encontrado** |
| 2 | `examples/fastify/with-basic-auth.ts`: `monitor.init()` sem `app` (crash no boot, fail-closed) | Low (DX/disponibilidade do exemplo, não é vulnerabilidade) | Não — recomendado abrir task de correção rápida (já sinalizado por QA em T011) |
| 3 | CORS permissivo em express/koa/fastify | Low (débito conhecido, documentado) | Não |
| 4 | Ausência de auth/rate limiting nativos | Medium (residual, já aceito no Modelo de Ameaças) | Não |

## Veredito

**Nenhum achado Critical ou High.** Nenhum bypass real de autenticação foi encontrado em nenhum dos 4 adapters — confirmado empiricamente para express, koa e fastify (HTTP real, sem mocks) e via diff para hapi. A mudança de montagem explícita de CORS/body-parsing introduzida por esta migração **não altera a ordem relativa entre o middleware/hook de auth do app consumidor e a lógica do adapter** em nenhum dos frameworks avaliados.

**T014 aprovado. Liberado para o Tech Lead prosseguir com o Code Review pré-commit.**

Recomendações não-bloqueantes para o Tech Lead considerar em tasks futuras:
- Corrigir `examples/fastify/with-basic-auth.ts` (`monitor.init({ app })`) antes do próximo release — já sinalizado por QA, reforçado aqui.
- Nenhuma ação adicional de segurança necessária para fechar esta migração.
