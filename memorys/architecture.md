# Architecture Memory State (Root)

> **Nota:** Este arquivo mantém obrigatoriamente as decisões arquiteturais globais, banco de dados, infraestrutura e os **Requisitos Não Funcionais**.
> *Fronteira:* NÃO COLOQUE regras sistêmicas de código, sintaxe ou restrições de formatação aqui (isso vai no `memorys/guidelines.md`) NEM regras de domínio ou fluxo de usuário/produto aqui (isso vai no `memorys/business.md`).
> **Fragmentação:** Memórias específicas de uma implementação técnica (ex: "Configuração do Redis Cluster", "Migração de Schema X") que não sejam decisões globais devem ser fragmentadas em arquivos específicos dentro de `memorys/implementations/` (ex: `memorys/implementations/redis-setup.md`) para manter este arquivo conciso.

## Requisitos Não Funcionais, Stack e Infra (O que sustenta o app)

- **Linguagem**: TypeScript (`strictNullChecks: true`, `target: ES2020`, `module: commonjs`). Compilação via `tsc` por pacote (`build`/`compile`/`dev --watch`).
- **Monorepo**: workspaces declarados em `lerna.json` (`packages/*`). **Lerna 4 ficou restrito a orquestração de tarefas** (`lerna run build`, `lerna add`, `lerna bootstrap`) — versionamento e publicação migraram para **Changesets** (ver ADR-002). Versão sincronizada entre todos os 7 pacotes (atual: `6.2.0` no repo; registry npm ainda em `6.1.0` — a `6.2.0` foi versionada em `b451bf6` e nunca publicada).
- **Lint/Format**: ESLint (`@typescript-eslint/recommended` + `plugin:prettier/recommended`) e Prettier (`singleQuote`, `semi`, `trailingComma: es5`, `arrowParens: always`). Regras relaxadas: `no-explicit-any`, `no-empty-function`, `no-non-null-assertion`, `ban-ts-comment` desligadas; `no-unused-vars` como warning (ignora prefixo `_`).
- **Testes**: Jest 26 + `ts-jest`, `testEnvironment: node`. Fixture de integração em `fixtures/bull-server/docker-compose.yml` (Redis + servidor Bull para testes locais). Primeiros testes do repo chegaram em 2026-08-11 (`packages/root/src/__tests__/`). `jest.config.js` ignora `dist/`/`build/`/`examples/`, e `packages/root/tsconfig.json` exclui `__tests__` do build — sem isso os testes eram emitidos para `dist/` e entravam no tarball publicado.
- **CI/CD**: **`.github/workflows/ci.yml`** (adicionado em 2026-08-11) roda lint + jest + `lerna bootstrap` + `lerna run build` em PR e push na main. O `bootstrap` é obrigatório no CI: sem npm workspaces, cada adapter resolveria `@bull-horizon/root` do registry em vez do código local. Release continua manual e local (`make version` → `make publish`, ambos via Changesets) e deploy da demo UI é via script `predeploy`/`deploy` usando `gh-pages` (publica `packages/ui/build` no GitHub Pages). Guia completo em `docs/RELEASING.md`.
- **Release restrito à branch `main`** — antes garantido por `lerna.json` (`command.version.allowBranch`), agora pelo target `guard.main` do `Makefile`, que aborta `make version` e `make publish` fora da main. Em tasks trabalhadas fora da main, o ciclo do Ops (skill `delivery`) deve se limitar a build check + commit com Conventional Commits **+ criação do changeset** (`make changeset`); versionamento/publicação ficam para um ciclo separado após o merge.
- **Node engine**: `>=14.16` (declarado em `packages/root`, bump em 2026-08-07 — piso mínimo do `@apollo/server` v4).
- **Escopo npm**: `@bull-horizon/*` (renomeado de `@bull-monitor/*` em 2026-08-07, primeira publicação sob o novo escopo — ver `memorys/business.md` § Contexto do Projeto Original). Binário do CLI: `bull-horizon` (era `bull-monitor`). Prefixo de chaves Redis (`bull_monitor::metrics::`) mantido igual por decisão consciente, para não quebrar continuidade de métricas de quem migrar do pacote antigo.
- **Comandos de referência para skills** (`delivery`, `security-audit`, `infrastructure`): gerenciador de pacotes `npm` + orquestração `lerna` (raiz). Build por pacote: `npm run build` (dentro de `packages/<pkg>`) ou `lerna run build`. Testes: `npx jest` (root) usando `jest.config.js` + `ts-jest`. Lint: `npx eslint . --ext .ts,.tsx`. Auditoria de dependências: `npm audit` (não há `pip`/`cargo`/`bundle` neste projeto — stack é 100% Node/TS). **Release**: `make changeset` (declarar mudança) → `make version` (aplicar bump) → `make publish` (build + publish). A skill `delivery` NÃO deve mais invocar `lerna version`/`lerna publish`.

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

## 📐 ADR-003 — Observabilidade: throughput próprio + Prometheus pull (2026-08-11)

**Contexto**: as métricas eram snapshots de `getJobCounts()` a cada 1h (máx 100 pontos). `counts.completed` é o tamanho do set `completed` no Redis — encolhe com `removeOnComplete` e some quando a fila é limpa, logo nunca foi sinal de vazão.

**Decisão 1 — série de throughput própria, contada por eventos.** A API nativa `queue.getMetrics()` do BullMQ (usada pelo bull-board) não existe no `bullmq@1.76` instalado nem em nenhuma versão do Bull v3/v4; adotá-la exigiria subir BullMQ para v5 e abandonar quem usa Bull. Detalhe em `memorys/implementations/metrics-throughput.md`.

**Decisão 2 — Prometheus pull, sem `prom-client`, default off.** Alloy e Grafana Cloud raspam o mesmo formato; um `GET /metrics` cobre os três. Push (OTLP) só se aparecer demanda de serverless. Renderizado à mão para não adicionar dependência ao pacote core. Nasce desligado: rota sem auth que publica nome de fila como label.

**Decisão 3 — leitura de métricas por janela.** `Query.metrics` ganhou `since`/`maxPoints`; a leitura virou slice de cauda + downsampling server-side em vez de `lrange 0 -1`. Obrigatório depois que o intervalo caiu para 1 min.

**Não fazer**: não trocar a contagem própria pela API nativa do BullMQ sem reabrir a decisão; não versionar a chave `bull_monitor::metrics::` (descartaria histórico existente sem ganho); não ligar `/metrics` por default.

## ⚠️ Débito Técnico de Build/Tooling (aberto)

- **`@graphql-codegen/cli@^1` incompatível com `graphql@^16`** (`packages/root`, `packages/ui`): o codegen v1 declara peer `graphql@^14 || ^15`, mas os pacotes subiram para `^16` na migração Apollo v4. Efeito colateral: `npm install` por pacote aborta com `ERESOLVE`, e o `make lerna.bootstrap` precisa rodar com `--legacy-peer-deps` (já configurado no `Makefile`). Correção definitiva: subir para `@graphql-codegen/cli@^5` — é devDependency de geração de tipos, não entra no bundle publicado. **Task ainda não aberta.**
- **`@types/node` precisa ficar pinado**: `^14.14.41` no `package.json` da raiz e `^18.19.0` em `packages/cli`. Sem os pins, o npm resolve a v26 e o TypeScript 4.x quebra ao parsear os `.d.ts` (`TS1109`/`TS1005`). Os pins tornam explícito o que antes era só um acaso dos lockfiles — não remover sem antes subir o TypeScript para 5.x.
- **Code-splitting da UI não implementado (P4 do `docs/ROADMAP.md`)**: `packages/ui/vite.config.ts` usa `manualChunks: {}`, `cssCodeSplit: false` e `entryFileNames: main.js` — MUI + recharts + codemirror + jsonata num arquivo só (~1.4MB). A correção exige apontar o `base` do Vite para a URL do jsDelivr que `packages/root/src/ui.ts` monta, e **só é verificável depois de publicar no npm**: se errar, o dashboard abre em branco em produção enquanto o dev local funciona. Precisa de uma task própria, com publish de verificação.
- **`packages/*/package-lock.json` removidos do versionamento (2026-08-09)**. Estavam obsoletos (declaravam `@bull-monitor/root@^5.4.0`) e fixavam versões divergentes de deps compartilhadas entre pacotes irmãos — `graphql@16.3.0` em `fastify` vs `16.14.2` em `root`; `@types/express@4.17.13` em `cli` vs `4.17.25` em `express`. Como cada pacote compila contra os tipos do próprio `node_modules`, isso gerava erros de **identidade de tipos** entre pacotes e quebrava `lerna run build` (logo, quebrava o publish). Lock autoritativo passa a ser só o da raiz; `packages/*/package-lock.json` está no `.gitignore`.

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

## 📐 ADR-002 — Versionamento e publicação via Changesets (2026-08-09)

**Contexto**: o release era feito com `lerna version --conventional-commits` + `lerna publish from-package` (Lerna 4). O changelog era derivado automaticamente das mensagens de commit, o que produzia entradas de baixo valor para quem consome os pacotes (`**Note:** Version bump only for package X`) e acoplava a qualidade do CHANGELOG à disciplina de commit. Lerna 4 também está defasado (o projeto passou para a Nx e o fluxo `version/publish` deixou de ser o caminho recomendado da comunidade).

**Decisão**: adotar **Changesets** (`@changesets/cli` ^2.31) como única ferramenta de versionamento e publicação. Lerna permanece **exclusivamente** como orquestrador de tarefas (`lerna run build`, `lerna add`, `lerna bootstrap`) e como declarador de workspaces — `@manypkg/get-packages` (usado internamente pelo Changesets) detecta `lerna.json` → `packages/*` nativamente, então **não foi necessário migrar para npm workspaces**.

**Configuração adotada** (`.changeset/config.json`):
- `fixed: [["@bull-horizon/*"]]` — todos os 7 pacotes sobem juntos, preservando o comportamento do lerna fixed mode. **Isto é obrigatório, não estético**: `packages/root/src/ui.ts` monta a URL do bundle da UI no jsDelivr usando a própria versão (`@bull-horizon/ui@<versão>/build/main.js`). Versões divergentes entre `root` e `ui` quebram o carregamento do dashboard em produção.
- `access: "public"` + `publishConfig.access: "public"` nos 7 `packages/*/package.json` — pacotes escopados são privados por padrão no npm; sem isso o publish falha com `E402`.
- `changelog: "@changesets/cli/changelog"` (formato simples, sem token). A alternativa `@changesets/changelog-github` exige `GITHUB_TOKEN` no momento do `version` — descartada por não haver CI.
- `baseBranch: "main"`. Como `lerna.json` deixou de ter `command.version.allowBranch`, o guard de branch passou para o target `guard.main` do `Makefile`.

**Mudanças de superfície**:
- `Makefile`: `make changeset` / `make changeset.status` / `make version` / `make publish` (build + publish). `make version` não roda mais `lerna version`.
- `package.json` (raiz): marcado como `private: true` (era publicável por acidente) + scripts `changeset`, `version-packages`, `release`.
- `lerna.json`: reduzido a `packages` + `version: "independent"` (o número fixo virou responsabilidade do Changesets).
- `packages/*/CHANGELOG.md`: removido o preâmbulo do lerna (`All notable changes...`), que ficava encalhado no meio do arquivo depois da primeira entrada do Changesets.
- `CHANGELOG.md` da raiz: **congelado** no formato antigo. Changesets escreve apenas por pacote.

**Consequência operacional**: o Ops passa a exigir um `.changeset/*.md` commitado junto com o código da feature. Sem changeset, a mudança não entra em nenhum release. Fluxo completo documentado em `docs/RELEASING.md`.

**Não fazer**: não remover `fixed` sem nova decisão de arquitetura (quebra o acoplamento root↔ui); não publicar sem `lerna run build` (o `dist/` dos pacotes de servidor e o `build/` da UI são gitignored mas entram no tarball npm — publish sem build gera pacote vazio e o npm não permite sobrescrever a versão).

## 🛡️ Modelo de Ameaças (Security Specialist)

- **Sem autenticação/autorização nativa**: o middleware GraphQL exposto por qualquer adapter (e o CLI) não possui controle de acesso embutido. Qualquer requisição que alcance a rota montada tem acesso de leitura/escrita total às queues (dados de job, incluindo payloads que podem conter PII, e capacidade de retry/remoção de jobs).
- **Superfície de ataque**: rota HTTP montada (GraphQL endpoint) + UI estática servida junto. Sem rate limiting, sem CSRF/CORS configurados nativamente nos adapters (verificar caso a caso ao tocar essa camada).
- **Mitigação de referência**: fork comunitário (issue upstream `#82`) implementou Basic Auth via flags `--user`/`--password` no adapter Express — candidato a padrão inicial se a squad decidir endereçar isso.
- **Ação obrigatória**: qualquer task que toque os adapters (express/koa/hapi/fastify) ou o CLI deve acionar o **Security Specialist** para avaliação de auth/authz antes do release (regra do Manager: superfícies sensíveis).

## Segurança e Compliance

- Nenhum provedor de identidade integrado nativamente. Nenhum requisito regulatório específico identificado no código (projeto open-source de infraestrutura, sem dados de usuário final além do conteúdo dos jobs monitorados).

---
**Instrução para a Squad:** Sempre consulte e atualize este arquivo nas fases de Refinamento Técnico ou tomada de decisões de base técnica (Techlead e Architect). Requisitos técnicos não-funcionais devem ser mantidos como memória viva neste arquivo rigorosamente.
