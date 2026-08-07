# Task 001 — Migrar Apollo Server v2/v3 → @apollo/server v4

**Status:** ✅ Implementado — aprovado no Code Review, liberado para Ops
**Versão SDD:** 1.0
**Data:** 2026-08-07
**Squad:** PO (skip — sem impacto de negócio) → Architect (ADR-001) → TechLead → Developer → QA → Security → Ops

## Contexto
Não há uso de Apollo Client no repositório (a UI usa `graphql-request`) — a migração é 100% do lado servidor. Ver `memorys/architecture.md` → ADR-001 para o racional completo e o plano técnico detalhado.

## Decisões (referência: ADR-001)
- `packages/hapi` **NÃO** entra nesta migração — permanece em `apollo-server-hapi` v3 + `graphql ^15`, débito técnico consciente.
- Upgrade geral de outras dependências (TS, Jest, ESLint, Vite, React, etc.) é demanda separada — tratada depois, começando pelo drift `bull`/`bullmq`.

## Regras de Negócio
- N/A — migração de infraestrutura, sem mudança de comportamento funcional visível ao usuário final do dashboard.

## Tasks

### Foundation
- [x] T001 [P1] Bump `graphql` `^15` → `^16` em `packages/root` e `packages/ui` (NÃO em `packages/hapi`)
- [x] T002 [P1] Adicionar `@apollo/server` como dependency em `packages/root` (substituindo `apollo-server-core` como devDependency) e adicionar `graphql-tag` para o helper `gql`

### Business Logic — packages/root
- [x] T003 [P1] Substituir `import { gql } from 'apollo-server-core'` por `graphql-tag` nos 6 arquivos de `src/gql/type-defs/*.ts` (job, queue, metrics, redis-info, mutations, root-query)
- [x] T004 [P1] Redesenhar `BullMonitor<TServer>` em `src/main.ts`: remover dependência de `ApolloServerBase`/`Config as ApolloConfig` de `apollo-server-core`; mover `dataSources` do construtor para dentro de `context` por-requisição
- [x] T005 [P2] Ajustar tipos exportados de `packages/root` que dependiam de tipos do `apollo-server-core`

### Business Logic — adapters migrados
- [x] T006 [P1] `packages/express`: trocar `apollo-server-express` por `@apollo/server` + `@as-integrations/express4`; trocar `applyMiddleware` por `expressMiddleware`; migrar `ApolloServerPluginDrainHttpServer` para `@apollo/server/plugin/drainHttpServer`
- [x] T007 [P1] `packages/fastify`: trocar `apollo-server-fastify` por `@apollo/server` + integração comunitária Fastify; trocar `createHandler`
- [x] T008 [P1] `packages/koa`: trocar `apollo-server-koa` por `@apollo/server` + integração comunitária Koa; trocar `getMiddleware`; migrar plugin de drain
  - **Escolha de integração**: `@as-integrations/koa` (pacote comunitário oficial do time `apollo-server-integrations`, mesmo mantenedor do `@as-integrations/express4` usado em T006). Fixado em `^1.1.1` — é a última versão da linha `1.x`, cujo peer é `@apollo/server ^4.0.0` + `koa ^2.0.0`; a `2.0.0` (última publicada) já exige `@apollo/server ^5.0.0` + `koa ^3.0.0`, incompatível com esta migração (que fica em v4/koa 2.x). Exporta `koaMiddleware(server, options)`, que roda para **qualquer** verbo/rota (sem filtro de path embutido) e não faz CORS nem body parsing — por isso `@koa/cors` e `koa-bodyparser` foram adicionados como dependencies explícitas e mantidos montados apenas no `gqlBasePath` (via `router.get`/`router.post`), reproduzindo o que `apollo-server-koa@3.6.3` fazia por padrão dentro do próprio `getMiddleware()` (confirmado lendo o `dist/ApolloServer.js` publicado do pacote antigo: `@koa/cors({ origin: '*' })` + `koa-bodyparser()` escopados ao path do GraphQL).

### Débito Técnico Consciente — packages/hapi
- [x] T009 [P2] Registrar comentário/README em `packages/hapi` apontando o freeze em `apollo-server-hapi` v3 e referenciando ADR-001 (sem alterar código funcional do pacote)
  - **Achado durante a execução**: o refactor de `packages/root` (T004) removeu `createServer()`/`server`/o `BullMonitor<TServer>` genérico, dos quais `packages/hapi` dependia mesmo continuando em `apollo-server-hapi` v3. Foi necessário um ajuste mínimo em `packages/hapi/src/index.ts` (construir o `ApolloServer` localmente usando `typeDefs`/`resolvers`/`createContext()` exportados por `@bull-monitor/root`) só para acompanhar essa mudança de contrato — **não é migração para `@apollo/server` v4**, o pacote Apollo usado continua sendo `apollo-server-hapi` v3.

### Infra / Config
- [x] T010 [P2] Bump `engines.node` em `packages/root/package.json` de `>=12` para `>=14.16`
- [x] T011 [P2] Atualizar `examples/{express,fastify,koa,nest}` (incluindo `with-basic-auth.ts`) para a nova API. `examples/hapi` fica intocado.
  - Confirmado (grep por `apollo` em `examples/express`, `examples/fastify`, `examples/koa`, `examples/nest`): nenhum exemplo importa símbolos do Apollo diretamente, só os adapters `@bull-monitor/*`. A superfície pública consumida (`new BullMonitorX({...})`, `monitor.init(...)`, `monitor.router`/`monitor.plugin`) não mudou com a migração interna de nenhum adapter. Nenhuma alteração de código foi necessária em nenhum exemplo. Exceção conhecida e não relacionada a esta migração: `examples/fastify/with-basic-auth.ts` tem um bug pré-existente (chama `monitor.init()` sem o argumento `app` obrigatório) — sinalizado para o QA, não corrigido aqui por estar fora do escopo desta task.

### QA
- [x] T012 [P1] Rodar `lerna run build` / `tsc` / `jest` em `root`, `express`, `fastify`, `koa` e validar que `hapi` continua buildando isolado sem quebrar
- [x] T013 [P1] Validar manualmente introspecção GraphQL e drain/shutdown do servidor HTTP nos 3 adapters migrados

### Security
- [x] T014 [P1] Revisar mount-order pós-migração: confirmar que `with-basic-auth.ts` (express/fastify/koa) continua protegendo a rota `/graphql` — sem bypass de auth por mudança na ordem de registro do middleware

## Arquivos Alterados (preencher durante execução)
| Arquivo | Mudança |
|---|---|
| `packages/root/package.json` | `graphql` `^15.5.0` → `^16.0.0`; removida devDependency `apollo-server-core`; adicionada dependency `graphql-tag` `^2.12.6` (T001, T002). **Correção pós-review (Tech Lead)**: T002 originalmente também adicionou `@apollo/server` `^4.0.0` como dependency de `packages/root`, mas nenhum arquivo em `packages/root/src` importa desse pacote (a construção do `ApolloServer` ficou toda nos adapters, corretamente) — era dependência morta. Removida; `tsc --noEmit`/`npm run build` revalidados limpos após a remoção |
| `packages/ui/package.json` | `graphql` `^15.5.0` → `^16.0.0` (T001) |
| `packages/root/src/gql/type-defs/job.ts` | `import { gql } from 'apollo-server-core'` → `import gql from 'graphql-tag'` (T003) |
| `packages/root/src/gql/type-defs/metrics.ts` | idem (T003) |
| `packages/root/src/gql/type-defs/mutations.ts` | idem (T003) |
| `packages/root/src/gql/type-defs/queue.ts` | idem (T003) |
| `packages/root/src/gql/type-defs/redis-info.ts` | idem (T003) |
| `packages/root/src/gql/type-defs/root-query.ts` | idem (T003) |
| `packages/root/src/main.ts` | `BullMonitor` deixou de ser genérico sobre `TServer extends ApolloServerBase`; removidos `createServer`/`startServer`/campo `server` (dependiam de `apollo-server-core`); adicionado tipo exportado `BullMonitorContext` e método público `createContext()` que monta os data sources por-requisição (T004) |
| `packages/root/src/index.ts` | passou a exportar `typeDefs`, `resolvers` e o tipo `BullMonitorContext`, para consumo pelos adapters (T004) |
| `packages/root/src/gql/data-sources/bull/index.ts` | `BullDataSource` deixou de `extends DataSource` de `apollo-datasource` (dependência transitiva de `apollo-server-core`, agora removida) — virou classe simples (T005) |
| `packages/root/src/gql/data-sources/metrics/index.ts` | idem — `MetricsDataSource` (T005) |
| `packages/root/src/gql/data-sources/policies/index.ts` | idem — `PoliciesDataSource` (T005) |
| `packages/root/package-lock.json` | regenerado via `npm install --legacy-peer-deps` após o bump de deps |
| `packages/hapi/src/index.ts` | ajuste mínimo (não é migração para v4): constrói `ApolloServer` (ainda de `apollo-server-hapi` v3) localmente usando `typeDefs`/`resolvers`/`createContext()` do `@bull-monitor/root`, para acompanhar a remoção de `createServer()`/`server` da classe base; comentário adicionado referenciando ADR-001 (T009) |
| `packages/express/package.json` | removida dependency `apollo-server-express`; adicionadas dependencies `@apollo/server` `^4.0.0`, `@as-integrations/express4` `^1.1.0`, `cors` `^2.8.5`, `graphql` `^16.0.0` (peer explícito do `@apollo/server`, não confiar só na transitiva via `@bull-monitor/root`); adicionadas devDependencies `@types/cors` `^2.8.13` e `@types/node` `^18.19.0` (pin necessário — sem ele o npm resolvia `@types/node@26.x`, cujo `ffi.d.ts` quebra o parser mesmo sob `typescript@4.7`); bump de `typescript` `^4.2.4` → `^4.7.4` (piso real exigido pelos `.d.ts` do `@apollo/server` v4, que usam anotação de variância `in out` — feature TS 4.7+; não é o upgrade geral de tooling adiado pela ADR-001, é peer requirement direto desta migração) (T006) |
| `packages/express/src/index.ts` | `BullMonitorExpress` deixou de estender `BullMonitor<ApolloServer>` (genérico removido em root) e passou a estender `BullMonitor`; instancia `new ApolloServer<BullMonitorContext>({ typeDefs, resolvers, plugins })` (importados de `@bull-monitor/root`); `await server.start()` seguido de `expressMiddleware(server, { context: async () => this.createContext() })` no lugar de `server.applyMiddleware()`; `ApolloServerPluginDrainHttpServer` migrado de `apollo-server-core` para `@apollo/server/plugin/drainHttpServer`; adicionados `cors()` e (condicionado a `!disableBodyParser`) `Express.json()` explícitos antes do `expressMiddleware`, montados via `router.use(this.gqlBasePath, ...)` — reproduzindo os defaults que o `applyMiddleware` v3 aplicava implicitamente (T006) |
| `packages/express/package-lock.json` | regenerado via `npm install --legacy-peer-deps` |
| `packages/fastify/package.json` | removida dependency `apollo-server-fastify`; adicionadas dependencies `@apollo/server` `^4.0.0`, `graphql` `^16.0.0` (peer explícito do `@apollo/server`), `fastify-cors` `6.0.3` (pin exato, não `^6.0.0` — `6.1.0` é só um shim de deprecation que reexporta `6.0.3` e emite warning em todo boot); adicionada devDependency `@types/node` `^18.19.0` (mesmo pin do `packages/express`, necessário para o tipo `Readable.from` usado no adapter); bump de `typescript` `^4.2.4` → `^4.7.4` (mesmo piso descoberto pelo dev do `packages/express` — `.d.ts` do `@apollo/server` v4 usam variância `in out`, feature TS 4.7+; não é upgrade geral de tooling, é peer requirement direto) (T007) |
| `packages/fastify/src/index.ts` | **Decisão de integração Fastify**: não foi usado `@as-integrations/fastify` — nenhuma versão publicada (`0.9.1` a `3.1.0`) suporta Fastify 3.x (peer mínimo é `fastify ^4.4.0`; a partir de `3.0.0` exige `^5.3.0`), e bump de major do Fastify está fora do escopo desta migração (ADR-001, Decisão 2). Implementado um plugin Fastify fino direto sobre a API core do `@apollo/server` (`server.executeHTTPGraphQLRequest`), modelado no mesmo padrão usado internamente por `@as-integrations/fastify` (tradução request→`HTTPGraphQLRequest`/`HeaderMap`, cópia de headers/status/body da resposta), mas compatível com a API do Fastify 3. `BullMonitorFastify` deixou de estender `BullMonitor<ApolloServer>` (genérico removido em root) e passou a estender `BullMonitor`; instancia `new ApolloServer<BullMonitorContext>({ typeDefs, resolvers, plugins })` (importados de `@bull-monitor/root`), `await server.start()`, e registra a rota GraphQL via `instance.route(...)` no lugar de `server.createHandler(...)`. `ApolloServerPluginDrainHttpServer` migrado de `apollo-server-core` para `@apollo/server/plugin/drainHttpServer`. CORS preservado explicitamente com `fastify-cors` (a mesma dependência que `apollo-server-fastify@3.6.3` registrava por padrão dentro de `createHandler` quando `cors` não era desabilitado), registrado num sub-escopo (`instance.register(async (gqlScope) => {...})`) que cobre só a rota GraphQL — a rota da UI estática (`instance.get(this.uiEndpoint, ...)`) permanece fora desse escopo, sem CORS, igual ao comportamento anterior (T007) |
| `packages/fastify/package-lock.json` | regenerado via `npm install --legacy-peer-deps` |
| `packages/koa/package.json` | removida dependency `apollo-server-koa`; adicionadas dependencies `@apollo/server` `^4.0.0`, `@as-integrations/koa` `^1.1.1`, `@koa/cors` `^5.0.0`, `graphql` `^16.0.0` (peer explícito do `@apollo/server`, não confiar só na transitiva via `@bull-monitor/root`), `koa-bodyparser` `^4.4.1`; adicionadas devDependencies `@types/koa-bodyparser` `^4.3.13`, `@types/koa__cors` `^5.0.1`, `@types/node` `^18.19.0` (mesmo pin descoberto pelo dev do `packages/express` — sem ele o npm resolvia `@types/node@26.x`, cujo `ffi.d.ts` quebra o parser mesmo sob TS 4.7); bump de `typescript` `^4.2.4` → `^4.7.4` (mesmo piso descoberto no `packages/express`: `.d.ts` do `@apollo/server` v4 usam variância `in out`, feature TS 4.7+; não é upgrade geral de tooling, é peer requirement direto desta migração) (T008) |
| `packages/koa/src/index.ts` | `BullMonitorKoa` deixou de estender `BullMonitor<ApolloServer>` (genérico removido em root) e passou a estender `BullMonitor`; instancia `new ApolloServer<BullMonitorContext>({ persistedQueries: false, typeDefs, resolvers, introspection: this.config.gqlIntrospection, plugins })` (`typeDefs`/`resolvers`/`BullMonitorContext` importados de `@bull-monitor/root`, preservando as duas opções de config — `persistedQueries`/`introspection` — que o antigo `createServer()` de `packages/root` passava); `await server.start()` seguido de `koaMiddleware(server, { context: async () => this.createContext() })` no lugar de `server.getMiddleware({ path })`; `ApolloServerPluginDrainHttpServer` migrado de `apollo-server-core` para `@apollo/server/plugin/drainHttpServer`; adicionados `cors({ origin: '*' })` (literal, não o default de refletir o header `Origin` do `@koa/cors`, para não ficar *mais* permissivo que o comportamento anterior sob eventual uso futuro de `credentials`) e `bodyParser()` explícitos antes do `koaMiddleware`, montados via `router.get`/`router.post(this.gqlBasePath, ...)` — reproduzindo os defaults que `getMiddleware()` do `apollo-server-koa@3.6.3` aplicava implicitamente (T008) |
| `packages/koa/package-lock.json` | regenerado via `npm install --legacy-peer-deps` (lockfile antigo estava desatualizado — nome/versão do pacote no `""` raiz do lock não batiam com o `package.json` atual — e travava `graphql` numa versão `16.3.0` divergente da `16.14.2` resolvida em `packages/root`, causando erro de tipos por dupla instância de `graphql`; o lockfile foi apagado e regenerado do zero, ver nota abaixo) |
| `packages/root/package.json` | `engines.node` `>=12` → `>=14.16` (piso mínimo real do `@apollo/server` v4) (T010) |
| `packages/fastify/src/index.ts` | **Correção pós-review (Tech Lead)**: o dev do koa notou (nota acima, corrigida) uma suspeita de gap de paridade entre adapters; ao conferir os três (`express`, `koa`, `hapi` já tinham `persistedQueries: false` + `introspection: this.config.gqlIntrospection`), o gap real estava em `packages/fastify`, que faltava as duas opções — sem `introspection`, a opção de config pública `gqlIntrospection` do bull-monitor ficava silenciosamente ignorada nesse adapter. Adicionadas as duas opções ao `new ApolloServer(...)`; `npx tsc --noEmit` revalidado limpo (T007, achado de paridade) |
| `examples/fastify/with-basic-auth.ts` | **Correção pós-review (Tech Lead)**: bug pré-existente sinalizado por QA (T011) e reconfirmado por Security (T014) — `monitor.init()` era chamado sem o `app` obrigatório (`TypeError` no boot, `ApolloServerPluginDrainHttpServer({ httpServer: app.server })` com `app` undefined). Corrigido para `monitor.init({ app })`, alinhado ao tipo `InitParams` do adapter. Fix de uma linha, sem relação direta com a migração do Apollo em si (bug já existia antes) |

## QA

**Executado por:** QA Specialist — 2026-08-07
**Ambiente:** Node v22.19.0 / npm 10.8.2, sem workspaces (validação local via symlinks manuais, conforme `memorys/guidelines.md`). Docker disponível — usado Redis real (`redis:7-alpine`) para T013.

### T012 — Build/tsc/jest por pacote

Para cada pacote foi feito, na ordem: `npm install --legacy-peer-deps` → symlink de `node_modules/@bull-monitor/root` para o `packages/root` local (**depois** do install, nunca antes — o `npm install` sobrescreve o symlink com a versão publicada, mesma armadilha documentada em "Decisões Técnicas" abaixo) → `npx tsc --noEmit` → `npm run build`.

| Pacote | `npm install` | `tsc --noEmit` | `npm run build` | Observação |
|---|---|---|---|---|
| `root` | OK | ✅ limpo | ✅ limpo | Base para os demais. |
| `express` | OK | ✅ limpo | ✅ limpo | `graphql` já resolvia para `16.14.2` em ambos os lados (root/adapter) sem symlink extra. |
| `fastify` | OK | ❌ → ✅ após fix de setup | ✅ limpo | `node_modules/graphql` local estava em `16.3.0` vs `16.14.2` do root — duas instâncias estruturalmente incompatíveis de `DocumentNode`/`Kind` (exatamente o antipadrão descrito em "Decisões Técnicas"). Corrigido com symlink adicional `node_modules/graphql → ../../root/node_modules/graphql`; após isso `tsc`/`build` ficaram limpos. Ajuste de setup, não de código. |
| `koa` | OK | ✅ limpo | ✅ limpo | `graphql` já convergia para `16.14.2`; nenhum symlink extra necessário desta vez. |
| `hapi` | OK | ✅ limpo | ✅ limpo | Validado com o `@bull-monitor/root` **local** (symlink), não a versão antiga publicada no npm — importante porque `src/index.ts` do hapi já importa `typeDefs`/`resolvers`/`createContext()` do novo contrato do root (ajuste do T009). `apollo-server-hapi` `^3.6.3` declara peer `graphql: "^15.3.0 || ^16.0.0"`, então aceita conviver com o `graphql ^16` do root sem conflito de tipos — o débito técnico consciente da ADR-001 (freeze em v3) segue de pé, mas não quebra a compilação isolada. |

**Jest**: confirmado que não há nenhum arquivo `*.spec.ts`/`*.test.ts` em nenhum pacote (`root`, `express`, `fastify`, `koa`, `hapi`) nem em `examples/`. `npx jest` na raiz falha antes mesmo de coletar testes (`Preset ts-jest not found relative to rootDir` — dependências de dev da raiz não instaladas, monorepo sem workspaces). Não é uma regressão desta migração: já era o estado esperado (achado prévio do Architect, sem cobertura automatizada pré-existente sobre esta área). Não foi escrita suíte nova porque está fora do escopo desta task de QA.

### T013 — Validação manual em runtime

Redis real via `docker run --rm redis:7-alpine` (porta `16379`), sem usar o fixture `fixtures/bull-server/docker-compose.yml` (esse fixture builda uma imagem própria e monta os pacotes via bind-mount para `ts-node-dev`, mais pesado do que o necessário para um smoke test pontual). Em vez disso, scripts Node ad-hoc (não commitados, descartados após o teste) instanciaram `BullMonitorExpress` / `BullMonitorFastify` / `BullMonitorKoa` reais, cada um com uma fila `Bull` real conectada ao Redis do container via `BullAdapter` (de `@bull-monitor/root/dist/bull-adapter`), e fizeram requisições HTTP reais (`http.request`) contra o servidor subido.

Testados os **3 adapters migrados** (express, fastify e koa — o escopo mínimo pedido era express+fastify, koa foi incluído também):

| Adapter | Introspecção (`gqlIntrospection: true`) | Introspecção bloqueada (`gqlIntrospection: false`) | Query real (`{ queues { id name } }`) | Drain/close |
|---|---|---|---|---|
| express | ✅ 200, schema retornado | ✅ 400, `INTROSPECTION_DISABLED` | ✅ 200, fila real retornada | ✅ fechou em ~2-6ms, sem pendurar |
| fastify | ✅ 200, schema retornado | ✅ 400, `INTROSPECTION_DISABLED` | ✅ 200, fila real retornada | ✅ fechou em ~1-5ms, sem pendurar |
| koa | ✅ 200, schema retornado | ✅ 400, `INTROSPECTION_DISABLED` | ✅ 200, fila real retornada | ✅ fechou em ~1-5ms, sem pendurar |

`packages/hapi` não foi validado em runtime (fora do escopo do T013 — só os 3 adapters migrados para `@apollo/server` v4; hapi permanece em `apollo-server-hapi` v3, já coberto pelo T012).

**Achado durante o setup do teste do koa (não é bug de código, é reforço do antipadrão já documentado)**: ao instalar `koa`/`koa-router` (peer dependencies não instaladas por padrão em `packages/koa/node_modules`) para o smoke test, o `npm install` subsequente **sobrescreveu o symlink `node_modules/@bull-monitor/root`** de volta para a versão antiga publicada no npm, causando um erro de runtime (`Cannot find module 'apollo-datasource'`, dependência transitiva que só existe na versão antiga do root). Corrigido refazendo o symlink. Reforça a nota já existente em `memorys/guidelines.md`/"Decisões Técnicas": **qualquer `npm install` posterior num adapter exige refazer o symlink do `@bull-monitor/root`**, e isso vale também para instalar peer dependencies (`koa`, `koa-router`) depois do fato, não só na primeira validação.

### Riscos/achados para considerar no code review (Security / Tech Lead)

1. **Não é bug novo, mas reforça o escopo do T014**: os 3 adapters migrados agora montam CORS e body-parsing **explicitamente** (antes eram implícitos dentro de `applyMiddleware`/`getMiddleware`/`createHandler` da v2/v3). O comportamento funcional foi preservado (validado acima), mas a ordem exata de registro do middleware é justamente o que o Security precisa revisar no T014 (mount-order/bypass de auth) — QA não avaliou auth porque não há auth nativa nos exemplos testados (`with-basic-auth.ts` não foi exercitado neste smoke test).
2. **Bug pré-existente, não corrigido (fora do escopo de QA)**: `examples/fastify/with-basic-auth.ts` chama `monitor.init()` sem o argumento `app` obrigatório (já sinalizado pelo dev do T011 na tabela "Arquivos Alterados"). QA confirma que o bug é real e está fora do código de produção (só afeta o exemplo), mas recomenda ao Tech Lead abrir uma task de correção rápida antes do próximo release, já que é o único exemplo com auth e pode confundir quem for copiar o padrão.
3. **Sem cobertura automatizada**: nenhum `.spec.ts` cobre `packages/root`/adapters. Toda a validação desta task foi manual/ad-hoc. Recomenda-se ao Tech Lead avaliar abrir uma task de `test-scaffold` para os data sources e para o bootstrap dos 3 adapters migrados, dado que é infraestrutura crítica (GraphQL sem auth nativa, conforme o Modelo de Ameaças em `memorys/architecture.md`).
4. **`fastify`**: precisa do symlink extra de `graphql` (além do de `@bull-monitor/root`) para compilar localmente contra o root da branch — já documentado em "Decisões Técnicas" para `fastify`, QA apenas reproduziu e confirma que o problema é puramente de ambiente de validação local (sem workspaces), não indica bug de runtime (o `npm publish` real não teria essa duplicação, pois o consumidor final resolveria `@bull-monitor/root` do registry com seu próprio `graphql` já compatível).

**Resultado geral: T012 e T013 aprovados.** Nenhum bug funcional de comportamento foi encontrado nos 4 pacotes migrados nem no `packages/hapi` congelado. Liberado para o Tech Lead seguir para Security (T014) e o Code Review pré-commit.

## Security

**Executado por:** Security Specialist — 2026-08-07
**Relatório completo:** `docs/todo/001-migrar-apollo-server/security-review.md`

### T014 — Mount-order pós-migração (CORS/body-parsing explícitos vs. auth do consumidor)

Analisado o código pós-migração de `packages/{express,fastify,koa}/src/index.ts` (montagem explícita de CORS/body-parsing, ausente na v2/v3 dos `apollo-server-*`) e `packages/hapi/src/index.ts` (não migrado) contra os 4 exemplos `examples/*/with-basic-auth.ts`, traçando o caminho real da requisição até o resolver GraphQL. Verificação **empírica** (HTTP real, sem mocks, reutilizando os symlinks de validação local já preparados pelo QA em T012/T013) para express, koa e fastify; verificação por diff para hapi (código de auth por-rota nem tocado nesta migração).

| Adapter | Método | Resultado |
|---|---|---|
| express | smoke test HTTP real (`app.use(baseUrl, basicAuth())` antes de `app.use(baseUrl, monitor.router)`) | 401 sem auth (UI e GraphQL), passa com auth — **sem bypass** |
| koa | smoke test HTTP real (`router.use(middleware)` antes de `router.get/post(gqlBasePath, ...)`) | 401 sem auth (UI e GraphQL), passa com auth — **sem bypass** |
| fastify | smoke test HTTP real (hook `preHandler` registrado antes de `instance.register(monitor.plugin)`, propagação de hook Fastify por escopo) | 401 sem auth (UI e GraphQL), passa com auth — **sem bypass**. Ressalva: `examples/fastify/with-basic-auth.ts` tem bug pré-existente (`monitor.init()` sem `app`, já sinalizado por QA em T011) que impede rodar o exemplo literal — teste rodado com a chamada corrigida **apenas no script de teste descartável**, não no repositório. O bug falha fechado (crash no boot), não é um bypass. |
| hapi | diff estático (`git diff packages/hapi/src/index.ts`) | Wiring de `route.auth`/`applyMiddleware({ route: { auth } })` byte-a-byte idêntico ao pré-migração — apenas a construção do `ApolloServer` mudou — **sem alteração de comportamento** |

**Achados secundários (Low/Medium, não bloqueantes, débito já conhecido)**:
- CORS permissivo (`cors()`/`cors({ origin: '*' })`/`fastify-cors` default) em express/koa/fastify — reproduz o comportamento herdado das libs `apollo-server-*` v2/v3 (não é regressão), já coberto pelo Modelo de Ameaças em `memorys/architecture.md`.
- Ausência de auth/rate limiting nativos — débito pré-existente, já documentado, sem mudança nesta migração.
- Recomendado ao Tech Lead abrir task de correção rápida para `examples/fastify/with-basic-auth.ts` (`monitor.init()` sem `app`), já sinalizado por QA em T011.

**Nenhum achado Critical/High.** Nenhum bug corrigido nesta revisão (fora do escopo do Security Specialist) e nenhum código de produção alterado.

**Resultado: T014 aprovado. Liberado para o Tech Lead prosseguir com o Code Review pré-commit.**

## 📝 Code Review Report — Task 001

**Revisor:** 👑 Tech Lead
**Data:** 2026-08-07
**Veredito:** ✅ APPROVED

### Spec Compliance
- [✅] T001–T014 — todos implementados e verificados (ver checkboxes acima). Nenhum item da spec ficou sem cobertura.
- [✅] Escopo respeitado: nenhuma migração de Apollo Client (não existe no repo), `packages/hapi` corretamente deixado fora da migração para `@apollo/server` v4, upgrade geral de dependências corretamente não iniciado (fica para task futura, ver `memorys/architecture.md` → ADR-001 Decisão 2).
- [⚠️→✅ corrigido] Gap de paridade entre adapters (`introspection`/`persistedQueries` faltando em `packages/fastify`) e dependência morta (`@apollo/server` em `packages/root/package.json`) — ambos achados durante este review e corrigidos antes da aprovação (ver linhas correspondentes na tabela "Arquivos Alterados").
- [✅] Bug pré-existente em `examples/fastify/with-basic-auth.ts` (fora do escopo original da task, sinalizado por QA/Security) corrigido durante este review por ser trivial (uma linha) e deixar um exemplo publicado quebrado seria pior do que corrigir.

### Guidelines Compliance
- [✅] Sem CI configurado — build/tsc/jest rodados manualmente por QA em todos os pacotes afetados, conforme `memorys/guidelines.md`.
- [✅] Achado novo registrado em `memorys/guidelines.md` sobre ausência de `workspaces`/hoisting e o procedimento de symlink manual para validação local — vira conhecimento reutilizável para próximas tasks neste monorepo.
- [✅] TypeScript estrito mantido; nenhum `any` implícito introduzido pela migração.

### Architecture Compliance
- [✅] ADR-001 seguido à risca pelos 3 developers dos adapters migrados e pelo developer do `packages/hapi` (freeze consciente, sem tentativa de forçar v4 no Hapi).
- [✅] Contrato novo exportado por `packages/root` (`typeDefs`, `resolvers`, `BullMonitorContext`, `createContext()`) é consistente e foi consumido de forma uniforme pelos 4 adapters (após a correção de paridade do fastify).
- [✅] `engines.node` do `packages/root` alinhado ao piso real exigido pelo `@apollo/server` v4.
- [ℹ️] Descobertas não previstas no ADR original documentadas corretamente como tal (piso de TypeScript 4.7+, pin de `@types/node`, mecanismo de link local sem workspaces) — não são desvio de arquitetura, são detalhes de implementação que o ADR não tinha como antecipar.

### Business Compliance
- N/A — migração de infraestrutura sem regra de negócio envolvida (confirmado, `memorys/business.md` não precisou de atualização).

### Higiene de Código
- `packages/root/package.json` — dependência morta `@apollo/server` removida (achado deste review).
- `packages/fastify/src/index.ts` — bem documentado (comentários justificam o *porquê* da abordagem manual sobre a API core, não o *o quê*), consistente com o padrão dos demais adapters.
- Import de `BullMonitorContext` como valor (não `import type`) em `express`/`koa`/`hapi` — inconsistência estilística menor (funciona, `tsc` não reclama, mas destoa do `import type { BullMonitorContext }` explícito usado em `fastify`). Não bloqueante, sinalizado para padronização numa limpeza futura (ex: ao abrir a task de upgrade geral de tooling/lint).
- Nenhum código morto, import não utilizado ou duplicação relevante encontrada nos 5 pacotes revisados.

### Veredito Final
Migração completa, testada (QA com Redis real) e revisada por Security (smoke tests HTTP reais, sem bypass de auth encontrado). Dois achados de hygiene (dependência morta, gap de paridade fastify) e um bug pré-existente de exemplo foram corrigidos durante este review. Nenhum achado Critical/High pendente. **Aprovado para o Ops fechar o ciclo.**

## Decisões Técnicas
- Ver `memorys/architecture.md` → ADR-001 (fonte de verdade do racional e plano técnico).
- **Validação local de `packages/koa` sem workspaces**: mesmo problema documentado abaixo para `packages/fastify` — `npm install --legacy-peer-deps` dentro de `packages/koa` resolve `@bull-monitor/root` a partir do **registry público** (versão antiga, pré-migração), não do código local. Diferente do fluxo manual usado em `fastify`, aqui foi usado o mecanismo "oficial" do próprio monorepo: `npx lerna bootstrap --scope=@bull-monitor/koa --include-filtered-dependencies -- --legacy-peer-deps` (alvo `lerna.bootstrap` do `Makefile` da raiz), rodado **depois** do `npm install` — a ordem importa, porque o `npm install` sobrescreve o symlink criado por um bootstrap anterior com a cópia real do registry. O próprio `lerna bootstrap` reclama disso (`WARN EREPLACE_EXIST @bull-monitor/root is already installed for @bull-monitor/koa. Replacing with symlink...`) e corrige sozinho. Esse bootstrap também resolveu de graça o problema de dupla instância de `graphql` (symlink automático + lockfile regenerado do zero convergiram os dois pacotes para `graphql@16.14.2`), sem precisar dos symlinks manuais que o dev do `fastify` teve que criar à mão.
- **`@types/node`/`typescript` em `packages/koa`**: mesmos pins (`@types/node ^18.19.0`, `typescript ^4.7.4`) descobertos independentemente pelos devs de `packages/express`/`packages/fastify` para o mesmo peer requirement do `@apollo/server` v4 — aplicados aqui por consistência, sem necessidade de nova investigação.
- **Validação local de `packages/fastify` sem workspaces**: `npm install --legacy-peer-deps` dentro de `packages/fastify` resolve `@bull-monitor/root` a partir do **registry público** (a versão antiga já publicada, pré-migração), não do código local — este monorepo Lerna não usa workspaces/hoisting, então não há link automático. Para validar contra o `packages/root` local (já migrado nesta task), foi necessário reproduzir manualmente o que `lerna bootstrap`/`lerna link` fariam: `rm -rf packages/fastify/node_modules/@bull-monitor/root && ln -s ../../../root packages/fastify/node_modules/@bull-monitor/root`. Isso expôs um segundo problema clássico de monorepo GraphQL — duas cópias físicas de `graphql` (uma em `packages/root/node_modules`, outra em `packages/fastify/node_modules`) tornam `DocumentNode`/`Kind` estruturalmente incompatíveis para o TypeScript, mesmo sendo a mesma versão `^16`. Resolvido com o mesmo tipo de symlink para deduplicar a instância: `rm -rf packages/fastify/node_modules/graphql && ln -s ../../root/node_modules/graphql packages/fastify/node_modules/graphql`. **Nenhum desses dois symlinks foi commitado** (são artefatos de `node_modules`) — quem for rodar `npm install` de novo neste pacote antes de um `lerna bootstrap`/publish real vai precisar refazer os dois symlinks manualmente para o `tsc`/build local bater com o `packages/root` da branch, ou rodar via `lerna bootstrap` de verdade (que resolve isso automaticamente).
