# Architecture Memory State (Root)

> **Nota:** Este arquivo mantém obrigatoriamente as decisões arquiteturais globais, banco de dados, infraestrutura e os **Requisitos Não Funcionais**.
> *Fronteira:* NÃO COLOQUE regras sistêmicas de código, sintaxe ou restrições de formatação aqui (isso vai no `memorys/guidelines.md`) NEM regras de domínio ou fluxo de usuário/produto aqui (isso vai no `memorys/business.md`).
> **Fragmentação:** Memórias específicas de uma implementação técnica (ex: "Configuração do Redis Cluster", "Migração de Schema X") que não sejam decisões globais devem ser fragmentadas em arquivos específicos dentro de `memorys/implementations/` (ex: `memorys/implementations/redis-setup.md`) para manter este arquivo conciso.

## Requisitos Não Funcionais, Stack e Infra (O que sustenta o app)

- **Linguagem**: TypeScript (`strictNullChecks: true`, `target: ES2020`, `module: commonjs`). Compilação via `tsc` por pacote (`build`/`compile`/`dev --watch`).
- **Monorepo**: gerenciado por **Lerna 4** (`packages/*`), versão sincronizada entre todos os pacotes (atual: `5.4.0`). Convenção de release usa **Conventional Commits** para gerar `CHANGELOG.md`.
- **Lint/Format**: ESLint (`@typescript-eslint/recommended` + `plugin:prettier/recommended`) e Prettier (`singleQuote`, `semi`, `trailingComma: es5`, `arrowParens: always`). Regras relaxadas: `no-explicit-any`, `no-empty-function`, `no-non-null-assertion`, `ban-ts-comment` desligadas; `no-unused-vars` como warning (ignora prefixo `_`).
- **Testes**: Jest 26 + `ts-jest`, `testEnvironment: node`. Fixture de integração em `fixtures/bull-server/docker-compose.yml` (Redis + servidor Bull para testes locais).
- **CI/CD**: **NENHUM detectado** — sem `.github/workflows`, `.circleci` ou `.travis.yml`. Release é manual (lerna version + publish) e deploy da demo UI é via script `predeploy`/`deploy` usando `gh-pages` (publica `packages/ui/build` no GitHub Pages).
- **Node engine**: `>=12` (declarado em `packages/root`).
- **Comandos de referência para skills** (`delivery`, `security-audit`, `infrastructure`): gerenciador de pacotes `npm` + orquestração `lerna` (raiz). Build por pacote: `npm run build` (dentro de `packages/<pkg>`) ou `lerna run build`. Testes: `npx jest` (root) usando `jest.config.js` + `ts-jest`. Lint: `npx eslint . --ext .ts,.tsx`. Auditoria de dependências: `npm audit` (não há `pip`/`cargo`/`bundle` neste projeto — stack é 100% Node/TS).

## Fluxos de Dados e Decisão de Arquitetura Sistêmica (Como interage)

- **`packages/root`** (`@bull-monitor/root`) é o núcleo: schema/resolvers GraphQL (`apollo-server-core`), data sources que leem queues **Bull (v3/v4)** e **BullMQ (v1)** diretamente do Redis, coleta de métricas agendada via `toad-scheduler`, introspecção de Redis via `redis-info`, e busca/filtro de jobs via expressões `jsonata`. Suporte dual a Bull e BullMQ é decisão arquitetural central (não é migração unidirecional).
- **Adapters de framework** (`packages/express`, `packages/koa`, `packages/hapi`, `packages/fastify`) — cada um embrulha o schema GraphQL do `root` como middleware Apollo Server para o framework HTTP correspondente. Todos dependem de `apollo-server-<framework>` (Apollo Server v2/v3).
- **`packages/cli`** — binário standalone (`bin: bull-monitor`) que sobe um servidor Express próprio embutindo `@bull-monitor/express` + `@bull-monitor/root`, sem exigir integração em app existente.
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

## 🛡️ Modelo de Ameaças (Security Specialist)

- **Sem autenticação/autorização nativa**: o middleware GraphQL exposto por qualquer adapter (e o CLI) não possui controle de acesso embutido. Qualquer requisição que alcance a rota montada tem acesso de leitura/escrita total às queues (dados de job, incluindo payloads que podem conter PII, e capacidade de retry/remoção de jobs).
- **Superfície de ataque**: rota HTTP montada (GraphQL endpoint) + UI estática servida junto. Sem rate limiting, sem CSRF/CORS configurados nativamente nos adapters (verificar caso a caso ao tocar essa camada).
- **Mitigação de referência**: fork comunitário (issue upstream `#82`) implementou Basic Auth via flags `--user`/`--password` no adapter Express — candidato a padrão inicial se a squad decidir endereçar isso.
- **Ação obrigatória**: qualquer task que toque os adapters (express/koa/hapi/fastify) ou o CLI deve acionar o **Security Specialist** para avaliação de auth/authz antes do release (regra do Manager: superfícies sensíveis).

## Segurança e Compliance

- Nenhum provedor de identidade integrado nativamente. Nenhum requisito regulatório específico identificado no código (projeto open-source de infraestrutura, sem dados de usuário final além do conteúdo dos jobs monitorados).

---
**Instrução para a Squad:** Sempre consulte e atualize este arquivo nas fases de Refinamento Técnico ou tomada de decisões de base técnica (Techlead e Architect). Requisitos técnicos não-funcionais devem ser mantidos como memória viva neste arquivo rigorosamente.
