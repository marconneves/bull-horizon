# Architecture Memory State (Root)

> **Nota:** Este arquivo mantém obrigatoriamente as decisões arquiteturais globais, banco de dados, infraestrutura e os **Requisitos Não Funcionais**.
> *Fronteira:* NÃO COLOQUE regras sistêmicas de código, sintaxe ou restrições de formatação aqui (isso vai no `memorys/guidelines.md`) NEM regras de domínio ou fluxo de usuário/produto aqui (isso vai no `memorys/business.md`).
> **Fragmentação:** Memórias específicas de uma implementação técnica (ex: "Configuração do Redis Cluster", "Migração de Schema X") que não sejam decisões globais devem ser fragmentadas em arquivos específicos dentro de `memorys/implementations/` (ex: `memorys/implementations/redis-setup.md`) para manter este arquivo conciso.

## Requisitos Não Funcionais, Stack e Infra (O que sustenta o app)

- **Linguagem**: TypeScript (`strictNullChecks: true`, `target: ES2020`, `module: commonjs`). Compilação via `tsc` por pacote (`build`/`compile`/`dev --watch`).
- **Monorepo**: gerenciado por **Lerna 4** (`packages/*`), versão sincronizada entre todos os pacotes (atual: `6.0.0`, bump major em 2026-08-07 pela migração `@apollo/server` v4 — ver ADR-001). Convenção de release usa **Conventional Commits** para gerar `CHANGELOG.md`.
- **Lint/Format**: ESLint (`@typescript-eslint/recommended` + `plugin:prettier/recommended`) e Prettier (`singleQuote`, `semi`, `trailingComma: es5`, `arrowParens: always`). Regras relaxadas: `no-explicit-any`, `no-empty-function`, `no-non-null-assertion`, `ban-ts-comment` desligadas; `no-unused-vars` como warning (ignora prefixo `_`).
- **Testes**: Jest 26 + `ts-jest`, `testEnvironment: node`. Fixture de integração em `fixtures/bull-server/docker-compose.yml` (Redis + servidor Bull para testes locais).
- **CI/CD**: **NENHUM detectado** — sem `.github/workflows`, `.circleci` ou `.travis.yml`. Release é manual (lerna version + publish) e deploy da demo UI é via script `predeploy`/`deploy` usando `gh-pages` (publica `packages/ui/build` no GitHub Pages).
- **Node engine**: `>=14.16` (declarado em `packages/root`, bump em 2026-08-07 — piso mínimo do `@apollo/server` v4).
- **Escopo npm**: `@bull-horizon/*` (renomeado de `@bull-monitor/*` em 2026-08-07, primeira publicação sob o novo escopo — ver `memorys/business.md` § Contexto do Projeto Original). Binário do CLI: `bull-horizon` (era `bull-monitor`). Prefixo de chaves Redis (`bull_monitor::metrics::`) mantido igual por decisão consciente, para não quebrar continuidade de métricas de quem migrar do pacote antigo.
- **Comandos de referência para skills** (`delivery`, `security-audit`, `infrastructure`): gerenciador de pacotes `npm` + orquestração `lerna` (raiz). Build por pacote: `npm run build` (dentro de `packages/<pkg>`) ou `lerna run build`. Testes: `npx jest` (root) usando `jest.config.js` + `ts-jest`. Lint: `npx eslint . --ext .ts,.tsx`. Auditoria de dependências: `npm audit` (não há `pip`/`cargo`/`bundle` neste projeto — stack é 100% Node/TS).

## Fluxos de Dados e Decisão de Arquitetura Sistêmica (Como interage)

- **`packages/root`** (`@bull-horizon/root`) é o núcleo: exporta schema/resolvers GraphQL puros (`typeDefs`/`resolvers`) e `createContext()`, data sources que leem queues **Bull (v3/v4)** e **BullMQ (v1)** diretamente do Redis, coleta de métricas agendada via `toad-scheduler`, introspecção de Redis via `redis-info`, e busca/filtro de jobs via expressões `jsonata`. Não instancia `ApolloServer` (ver ADR-001) — isso é responsabilidade de cada adapter. Suporte dual a Bull e BullMQ é decisão arquitetural central (não é migração unidirecional).
- **Adapters de framework** (`packages/express`, `packages/koa`, `packages/fastify`) — cada um instancia seu próprio `@apollo/server` v4 e embrulha o schema GraphQL do `root` como middleware para o framework HTTP correspondente. `packages/hapi` permanece em `apollo-server-hapi` v3 (débito consciente, ver ADR-001).
- **`packages/cli`** — binário standalone (`bin: bull-horizon`) que sobe um servidor Express próprio embutindo `@bull-horizon/express` + `@bull-horizon/root`, sem exigir integração em app existente.
- **`packages/ui`** — frontend React 17 + MUI v5, build via Vite. Client GraphQL via `graphql-request` + `react-query`; estado local via `zustand`/`jotai`; edição de JSON via `codemirror`; gráficos de métricas via `recharts`. Possui modo demo (`VITE_ENABLE_MOCKS`) com mocks em `demo-mocks/` para o build publicado no GitHub Pages, sem dependência de Redis real.
- Fluxo ponta a ponta: UI → GraphQL (via adapter no framework HTTP do usuário) → `root` data sources → Redis (via cliente Bull/BullMQ) → resposta GraphQL → UI.

## Resumo do Ecossistema (Memory State de Deps Principais)

- **Fila/Job**: `bull` (^3.27 / ^4.0), `bullmq` (^1.57 / ^1.76) — suporte dual mantido propositalmente.
- **GraphQL**: `graphql` ^15.5, `apollo-server-core` + `apollo-server-{express,koa,hapi,fastify}` (Apollo Server v2/v3).
- **UI**: `react` ^17, `@mui/material` ^5, `vite` ^2, `graphql-request`, `react-query`, `zustand`, `jotai`, `recharts`, `codemirror`.
- **Utilitários**: `lodash`, `jsonata` (busca/filtro), `redis-info`, `toad-scheduler` (métricas), `dayjs`, `ms`.

## ⚠️ Débito Técnico Crítico Herdado

- **Apollo Server v2/v3 em EOL desde 2023-10-22.** Todos os 4 adapters (express/koa/hapi/fastify) dependem de `apollo-server-<framework>` (v2/v3), pacotes descontinuados sem patches de segurança futuros. Migração recomendada: `@apollo/server` (Apollo Server 4+), que exige reescrever a camada de integração de middleware em cada adapter.
- Este débito é apontado como a causa técnica mais provável por trás do arquivamento do repositório upstream (ver `memorys/business.md` → seção 4). **Priorizar antes de qualquer nova feature nos adapters.**
- **✅ Resolvido em 2026-08-07 (v6.0.0, commit `843915b`)** — ver ADR-001 abaixo e o detalhe de implementação em `memorys/implementations/apollo-server-v4-migration.md`.

## 📐 ADR-001 — Migração Apollo Server v2/v3 → @apollo/server v4 (2026-08-07)

**Contexto**: Não há uso de Apollo Client no repositório (a UI usa `graphql-request`) — a migração é 100% server-side. `apollo-server-core` e os 4 adapters `apollo-server-{express,fastify,koa,hapi}` estão todos em `^3.6.3`, em EOL.

**Decisão 1 — Hapi congelado em v3 (escopo desta migração)**: A Apollo descontinuou suporte first-party a Hapi no `@apollo/server` v4 (só Express é mantido oficialmente; Fastify/Koa dependem de pacotes comunitários `@as-integrations/*`). Decisão do usuário: **`packages/hapi` permanece em `apollo-server-hapi` v3 por enquanto**, registrado como débito técnico consciente, em vez de escrever uma integração custom não-oficial agora. Reavaliar quando/se a Apollo (ou a comunidade) publicar um caminho oficial para Hapi, ou se `packages/hapi` for descontinuado no futuro.
- **Impacto**: `packages/hapi` NÃO deve ser incluído no bump de `graphql` (`^15` → `^16`) feito para os demais pacotes, pois `apollo-server-hapi` v3 depende de `graphql ^15`. Isso cria um segundo ponto de drift de peer dependency no monorepo (além do já existente em `bull`/`bullmq`) — aceito conscientemente, não é um erro a "corrigir" em upgrades futuros sem nova decisão.
- **Não fazer**: não tentar forçar `packages/hapi` a rodar sobre `@apollo/server` v4 sem uma nova decisão explícita do usuário/Architect.

**Decisão 2 — Escopo do upgrade geral de dependências separado desta migração**: o usuário optou por tratar primeiro, como demanda separada de Ops, o **drift de versão `bull`/`bullmq` entre pacotes do monorepo** (`bull` ^3.x vs ^4.x; `bullmq` ^1.x vs ^4.x) antes de subir majors de tooling (TypeScript 4→5, Jest, ESLint, Vite, React 17→18, Express/Fastify majors). Não abrir tasks de upgrade geral de tooling até essa demanda ser explicitamente aberta.

**Plano técnico** (`packages/root`, `express`, `fastify`, `koa`):
1. Bump `graphql` `^15` → `^16` nesses pacotes + `packages/ui` (peer dependency obrigatória do `@apollo/server` v4).
2. `packages/root`: `apollo-server-core` (devDependency) → `@apollo/server`; substituir `import { gql } from 'apollo-server-core'` (6 arquivos em `src/gql/type-defs/`) por `graphql-tag` ou `parse` do `graphql`; redesenhar `BullMonitor<TServer extends ApolloServerBase>` (classe base não existe mais em v4 — API é uma classe única, não subclassada por integração); mover `dataSources` do construtor para dentro da função `context` por-requisição.
3. `packages/express`: `apollo-server-express` → `@apollo/server` + `@as-integrations/express4`; trocar `applyMiddleware` por `expressMiddleware`.
4. `packages/fastify`: `apollo-server-fastify` → `@apollo/server` + integração comunitária Fastify; trocar `createHandler`.
5. `packages/koa`: `apollo-server-koa` → `@apollo/server` + integração comunitária Koa; trocar `getMiddleware`.
6. `ApolloServerPluginDrainHttpServer` migra para `@apollo/server/plugin/drainHttpServer` nos 3 pacotes migrados (koa/express/root). `ApolloServerPluginStopHapiServer` fica intacto em `packages/hapi` (não migrado).
7. Atualizar `examples/{express,fastify,koa,nest}` (incluindo `with-basic-auth.ts`) para a nova API. `examples/hapi` permanece na API antiga.
8. Bump do piso de Node declarado (`engines.node` em `packages/root`, hoje `>=12`) para `>=14.16` (mínimo do `@apollo/server` v4) — ambiente de dev atual já roda Node 22.

**Risco de segurança identificado**: troca do ponto de montagem HTTP (`applyMiddleware`/`getMiddleware`/`createHandler` → `expressMiddleware`/integrações equivalentes) pode alterar a ordem em que middleware de auth do app consumidor intercepta a rota GraphQL. Ver `memorys/guidelines.md` para a regra de Security review obrigatória nesta migração.

**Consequência**: após esta migração, o monorepo terá **dois majors de `graphql` coexistindo intencionalmente** (`^16` em root/express/fastify/koa/ui, `^15` em hapi) — não é regressão, é o preço aceito de manter o adapter Hapi vivo sem integração oficial.

## 🛡️ Modelo de Ameaças (Security Specialist)

- **Sem autenticação/autorização nativa**: o middleware GraphQL exposto por qualquer adapter (e o CLI) não possui controle de acesso embutido. Qualquer requisição que alcance a rota montada tem acesso de leitura/escrita total às queues (dados de job, incluindo payloads que podem conter PII, e capacidade de retry/remoção de jobs).
- **Superfície de ataque**: rota HTTP montada (GraphQL endpoint) + UI estática servida junto. Sem rate limiting, sem CSRF/CORS configurados nativamente nos adapters (verificar caso a caso ao tocar essa camada).
- **Mitigação de referência**: fork comunitário (issue upstream `#82`) implementou Basic Auth via flags `--user`/`--password` no adapter Express — candidato a padrão inicial se a squad decidir endereçar isso.
- **Ação obrigatória**: qualquer task que toque os adapters (express/koa/hapi/fastify) ou o CLI deve acionar o **Security Specialist** para avaliação de auth/authz antes do release (regra do Manager: superfícies sensíveis).

## Segurança e Compliance

- Nenhum provedor de identidade integrado nativamente. Nenhum requisito regulatório específico identificado no código (projeto open-source de infraestrutura, sem dados de usuário final além do conteúdo dos jobs monitorados).

---
**Instrução para a Squad:** Sempre consulte e atualize este arquivo nas fases de Refinamento Técnico ou tomada de decisões de base técnica (Techlead e Architect). Requisitos técnicos não-funcionais devem ser mantidos como memória viva neste arquivo rigorosamente.
