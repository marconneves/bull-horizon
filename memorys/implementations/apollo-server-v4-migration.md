# Implementação: Migração apollo-server v2/v3 → @apollo/server v4

> Detalhe técnico de implementação da Task 001 (commit `843915b`, v6.0.0). Racional e decisões de arquitetura ficam em `memorys/architecture.md` → ADR-001; este arquivo guarda o "como", útil para quem for tocar `packages/root`/adapters de novo ou migrar `packages/hapi` no futuro.

## Contrato entre `packages/root` e os adapters

`packages/root` não instancia mais `ApolloServer`. Exporta:
- `typeDefs`, `resolvers` — schema puro.
- `BullMonitorContext` (type) — formato do contexto GraphQL (`{ dataSources: { bull, metrics, policies } }`).
- `BullMonitor.createContext()` (método público de instância) — monta os data sources por-requisição a partir do estado interno (`_queues`, `_queuesMap`, `_metricsCollector`).

Cada adapter instancia seu próprio `new ApolloServer<BullMonitorContext>({ persistedQueries: false, typeDefs, resolvers, introspection: this.config.gqlIntrospection, plugins })`, chama `server.start()`, e passa `context: async () => this.createContext()` para a integração de middleware do framework. **As duas opções `persistedQueries: false` e `introspection: this.config.gqlIntrospection` são obrigatórias em todo adapter novo** — sem `introspection`, a opção pública de config do bull-horizon fica silenciosamente ignorada (achado do code review, gap que existiu temporariamente em `packages/fastify`).

## Escolha de integração por framework

| Framework | Pacote usado | Por quê |
|---|---|---|
| Express | `@as-integrations/express4` `^1.1.0` | Único framework com integração first-party mantida pela própria Apollo. |
| Koa | `@as-integrations/koa` `^1.1.1` (fixado, não `^2`) | `2.0.0` exige `@apollo/server ^5` + `koa ^3` — fora do escopo (major bump de Koa não decidido). |
| Fastify | Nenhum pacote — plugin manual sobre `server.executeHTTPGraphQLRequest` | Nenhuma versão publicada de `@as-integrations/fastify` (`0.9.1`–`3.1.0`) suporta Fastify 3.x (mínimo `^4.4.0`, depois `^5.3.0`). Implementação em `packages/fastify/src/index.ts` traduz `FastifyRequest` → `HTTPGraphQLRequest` manualmente (headers via `HeaderMap`, `search` via `new URL()`, resposta `complete`/`chunked` via `Readable.from`). |
| Hapi | Não migrado — `apollo-server-hapi` v3 mantido | Apollo descontinuou suporte first-party a Hapi na v4. Ver ADR-001. |

`@apollo/server` v4 não faz CORS nem body-parsing (ao contrário de `applyMiddleware`/`getMiddleware`/`createHandler` na v2/v3) — todo adapter migrado monta isso explicitamente:
- Express: `cors()` + `express.json()` (condicionado a `!disableBodyParser`).
- Koa: `cors({ origin: '*' })` (literal, não o default de refletir `Origin` — evita ficar mais permissivo que antes sob uso futuro de `credentials`) + `koa-bodyparser()`.
- Fastify: `fastify-cors` (pin exato `6.0.3` — `^6.0.0` resolve `6.1.0`, que é só um shim de deprecation com warning de boot) registrado num sub-escopo que cobre só a rota GraphQL.

## Peer requirements descobertos (não estavam no plano original)

- **TypeScript ≥ 4.7** em qualquer pacote que importe `@apollo/server` diretamente (express/fastify/koa) — os `.d.ts` do pacote usam anotação de variância `in out`, sintaxe TS 4.7+. `packages/root` não precisa disso porque não importa `@apollo/server` (só re-exporta `typeDefs`/`resolvers`/`createContext`).
- **Fixar `@types/node`** (`^18.19.0` usado aqui) nos mesmos 3 pacotes — sem isso o npm pode resolver `@types/node@26.x` via alguma transitiva `"@types/node": "*"`, cujo `ffi.d.ts` quebra o parser mesmo sob TS 4.7.
- `graphql` precisa estar em `^16` em todo pacote que fala com `@apollo/server` v4 (root, express, fastify, koa, ui). `packages/hapi` fica propositalmente em `graphql ^15` (peer de `apollo-server-hapi` v3) — dois majors de `graphql` coexistem no monorepo por design, não é regressão.

## Validação local sem workspaces (procedimento)

Ver também a nota curta em `memorys/guidelines.md`. Passo a passo completo:
1. `cd packages/root && npm install --legacy-peer-deps && npm run build` — sempre primeiro, todo adapter depende do `dist/` atualizado.
2. Em cada adapter: `npm install --legacy-peer-deps` (isso resolve `@bull-horizon/root` do registry público, versão antiga — esperado).
3. Sobrescrever com link local, **usando caminhos absolutos**: `rm -rf <adapter>/node_modules/@bull-horizon/root && ln -s <abs>/packages/root <abs>/packages/<adapter>/node_modules/@bull-horizon/root`.
4. Se `tsc` reclamar de `DocumentNode`/`Kind` estruturalmente incompatíveis (duas instâncias físicas de `graphql`): `rm -rf <adapter>/node_modules/graphql && ln -s <abs>/packages/root/node_modules/graphql <abs>/packages/<adapter>/node_modules/graphql`.
5. **Cuidado**: qualquer `npm install` subsequente no adapter (inclusive para instalar uma peer dependency nova) sobrescreve o symlink do passo 3 de volta para a versão do registry — refazer o symlink depois.
6. Alternativa mais "oficial" que resolve os dois symlinks de uma vez: `npx lerna bootstrap --scope=@bull-horizon/<adapter> --include-filtered-dependencies -- --legacy-peer-deps`, rodado **depois** do `npm install` (a ordem importa — o inverso não funciona).

Nenhum desses symlinks foi commitado (artefatos de `node_modules`, cobertos por `.gitignore`).

## Pendências conscientes deixadas para depois

- `examples/fastify/with-basic-auth.ts` tinha um bug pré-existente (`monitor.init()` sem `app`) — corrigido no code review desta task, sem relação com a migração em si.
- `packages/hapi` congelado em `apollo-server-hapi` v3 — ver ADR-001 para os termos da reavaliação futura.
- Upgrade geral de dependências (TS 5, Jest, ESLint, Vite, React, majors de Express/Fastify/Hapi) e o drift `bull`/`bullmq` entre pacotes ficaram fora desta task, como demanda futura separada (decisão do usuário).
