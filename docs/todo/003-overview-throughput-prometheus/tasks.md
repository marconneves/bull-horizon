# Task 003 — Overview, throughput real e exportador Prometheus

**Status:** ✅ Implementado (aguardando confirmação do usuário para fechar o ciclo)
**Data:** 2026-08-11
**Squad:** PO → Architect → TechLead → Developer → QA → Security → Ops
**Origem:** `docs/ROADMAP.md` (waves 0–3), demanda "implementa tudo" do usuário

## User Stories
- **US001** — Como operador, quero uma visão geral de todas as filas com a distribuição de status, para achar a fila problemática sem abrir uma por uma.
- **US002** — Como operador, quero ver a taxa de conclusão/falha ao longo do tempo (por fila e agregada), para saber se a vazão caiu.
- **US003** — Como SRE, quero raspar as métricas das filas com Prometheus/Alloy/Grafana, para alertar fora do dashboard.
- **US004** — Como mantenedor, quero que lint/test/build rodem sozinhos num PR, para não depender de disciplina manual.

## Decisões técnicas (Architect)

### D1 — Throughput próprio em vez de `queue.getMetrics()` do BullMQ
O bull-board usa a API nativa de métricas do BullMQ. Ela **não existe** no
`bullmq@1.76` instalado (verificado nos typings) nem em nenhuma versão do Bull
v3/v4. Copiar a abordagem exigiria subir BullMQ para v5 **e** abandonar quem usa
Bull — contra a regra de suporte dual (`memorys/business.md` § 2).

Solução: contar eventos no `MetricsCollector`, que já interceptava
`onGlobalJobCompletion`. Adicionado o hook simétrico `onGlobalJobFailure` no
`Queue` abstrato e nos dois adapters.

**Consequência aceita:** o contador só vale com o processo do monitor vivo.
Reinício = buraco na série. Documentado no README e na UI (mensagem de estado
vazio), não escondido.

### D2 — Retenção em camadas (rollup na escrita)
`collectInterval` `{ hours: 1 }` → `{ minutes: 1 }`. Retenção total passou de
~4 dias para **90 dias**, com detalhe decaindo por idade: 3 dias a 1 min, 30 dias
a 1h, 90 dias em buckets de 12h.

**Custo medido** (291 bytes/ponto): 90 dias a 1 minuto seriam ~130k pontos =
**36MB de Redis por fila** (719MB com 20 filas). Com rollup, os mesmos 90 dias
custam ~5.2k pontos ≈ **1.5MB/fila**. O limitante nunca foi estatística, foi
memória — e rollup é a resposta padrão.

Camadas são **configuráveis em resolução e profundidade** (`retention.rollups`),
não hardcoded. `maxMetrics` mantido como alias de `retention.raw`.

Chave do Redis da série bruta **não** foi versionada: pontos antigos apenas não
têm `completed`/`failed` e a UI os trata como nulos. Camadas ficam em chaves
novas (`::r<everyMs>`).

### D2b — A UI não hardcoda janelas
Primeira versão desta task fixou o seletor em `60m/24h/3d`, o que era bug de
desenho, não decisão: `maxMetrics` já era configurável, então quem aumentasse a
retenção não veria a diferença. Agora `Query.metricsInfo` reporta
`collectIntervalMs`/`retentionMs` e a UI monta as janelas disponíveis a partir
disso.

### D2c — Gráficos plotam taxa, não contagem
Pontos vêm da camada que cobre a janela, então um bucket de 12h e um de 1min
chegam ambos como "um ponto". Plotar contagem crua faria a ponta antiga dominar
a recente e o eixo Y mudaria de significado a cada janela. `windowMs` virou
obrigatório em `ThroughputPoint` para permitir a normalização.

### D3 — Prometheus (pull), não Alloy/OTLP
Alloy e Grafana Cloud **raspam** o formato Prometheus — não são destinos
distintos. Um `GET /metrics` cobre os três. Push OTLP só faria sentido em
serverless; não é o caso de um dashboard que já serve HTTP.

Renderização à mão (~140 linhas) em vez de `prom-client`: é um pacote que entra
na árvore de dependências de terceiros, e o formato texto é trivial.

**Default desligado** — rota sem auth que publica nome de fila como label.

### D4 — Code-splitting da UI (P4) NÃO implementado
`packages/root/src/ui.ts` monta uma URL única de bundle no jsDelivr. Habilitar
splitting exige acertar o `base` do Vite para a URL do CDN, e o resultado só é
verificável **depois** de publicar no npm. Fica para uma task própria, com
publish de verificação. Sintoma se feito errado: dashboard em branco em
produção, com dev local funcionando.

## Tasks

### Core — throughput (E1)
- [x] T001 [P1] [US002] `queue.ts`: tipo `GlobalJobFailureCb` + setter abstrato `onGlobalJobFailure`.
- [x] T002 [P1] [US002] `bull-adapter.ts`: `global:failed`. `bullmq-adapter.ts`: `QueueEvents` `failed`.
- [x] T003 [P1] [US002] `metrics-collector.ts`: contadores por janela (`_completedGauge`/`_failedGauge`) + acumulados (`_totalCompleted`/`_totalFailed`) para o Prometheus; campos `completed`/`failed`/`windowMs` no ponto persistido.
- [x] T004 [P1] [US002] `constants.ts`: novos defaults de `collectInterval` + `DEFAULT_METRICS_RETENTION` (D2).
- [x] T004b [P1] [US002] `_rollUp`: dobra cada ponto fresco em todas as camadas via read-modify-write no tail; `_mergePoints` com soma de contadores, gauge mais novo e `processingTime` ponderado por nº de jobs.
- [x] T004c [P1] [US002] `_tierFor`: leitura escolhe a camada mais fina que cobre a janela; `clear`/`clearAll` apagam todas as camadas; `info` reporta o span mais largo.
- [x] T004d [P1] [US002] `Query.metricsInfo` + seletor de janelas da UI derivado dele (D2b).
- [x] T004e [P1] [US002] `windowMs` em `ThroughputPoint`; gráfico plota taxa/min com eixo compacto (D2c).
- [x] T005 [P1] [US002] `extractSince(queue, since, maxPoints)`: leitura por janela via slice de cauda + downsampling server-side.
- [x] T006 [P1] [US002] `getSummary(since, maxPoints)`: agregação cross-queue no servidor.

### Core — schema
- [x] T007 [P1] `type-defs/metrics.ts`: `QueueMetrics.completed/failed/windowMs`, `ThroughputPoint`, `QueueThroughputSummary`, `MetricsSummary`.
- [x] T008 [P1] `root-query.ts`: args `since`/`maxPoints` em `metrics`; query `metricsSummary`.
- [x] T009 [P2] `typings/gql.ts` (root e ui) atualizados à mão — o codegen exige um servidor GraphQL em `localhost:3000` e o `@graphql-codegen/cli@1` está travado com `graphql ^16`.

### Core — performance (E6)
- [x] T010 [P1] `data-sources/bull`: memoização por request (`getCachedJobCounts`/`getCachedIsPaused`/`getCachedCount`), cacheando a **promise** para colapsar fields resolvidos em paralelo.
- [x] T011 [P1] `resolvers/queue.ts`: os 7 fields de contagem passam a sair de um único `getJobCounts()`. `count` e `isPaused` seguem chamadas próprias (semântica provider-specific).
- [x] T012 [P2] `providers/queues-query`: `keepPreviousData` + `refetchIntervalInBackground: false`.
- [x] T013 [P2] `metricsEnabled` com `staleTime: Infinity` (capacidade do servidor, não estado vivo).
- [ ] T014 [P3] Code-splitting do bundle da UI — **adiado** (ver D4).

### Prometheus (E5)
- [x] T015 [P1] [US003] `prometheus.ts`: renderer do formato de exposição, com escape de label.
- [x] T016 [P1] [US003] `typings/config.ts` + `main.ts`: `PrometheusConfig`, `renderPrometheus()`, `prometheusEndpoint`, default off.
- [x] T017 [P1] [US003] Rota `GET /metrics` montada nos 4 adapters (express/koa/fastify/hapi).
- [x] T018 [P2] [US003] CLI: flags `--prometheus` / `--prometheus-path`.
- [x] T019 [P2] [US003] `examples/grafana/`: README (métricas, scrape configs) + `dashboard.json` importável.

### UI (E2/E3/E4)
- [x] T020 [P1] [US001] `screens/overview/`: grid de cards por fila, barra empilhada de status, filtro por status, clique navega para a fila naquele status.
- [x] T021 [P1] [US002] `screens/shared/ThroughputChart.tsx` + `TimeRangePicker` + `time-range.ts` (janelas derivadas de `Query.metricsInfo`: 60m/6h/24h/7d/30d/90d com a retenção default).
- [x] T022 [P1] [US002] `screens/jobs/Throughput/`: card colapsável no topo da lista; colapsado **não** faz polling.
- [x] T023 [P1] [US002] `screens/history/`: gráfico agregado + tabela "By queue" com barra de runs e % de falha.
- [x] T024 [P2] `stores/active-screen.ts`: 4 telas (`toggleScreen` virou `changeScreen`); `shell/Drawer/ScreenNav.tsx`; AppBar vira swap jobs↔métricas-da-fila.
- [x] T025 [P2] Mocks do demo (`get-metrics-summary`, `get-queue-metrics`) gerando série realista e aplicando o mesmo downsampling do servidor.

### Infra (E7)
- [x] T026 [P1] [US004] `.github/workflows/ci.yml`: lint + jest + `lerna bootstrap` + `lerna run build` em PR e push na main.
- [x] T027 [P2] `jest.config.js`: ignora `dist/`/`build/`/`examples/`; `packages/root/tsconfig.json` exclui `__tests__` do build (os testes estavam sendo emitidos para `dist/` e iriam no tarball publicado).
- [x] T028 [P2] `packages/fastify`: import inline `type` separado — o parser do eslint (typescript-eslint v4) não o parseia, e o arquivo estava silenciosamente sem lint.
- [x] T029 [P3] `eslint --fix` no repo (drift de formatação pré-existente, que tornaria o CI vermelho no dia 1).

### QA
- [x] T030 [P1] 32 testes novos (`prometheus.test.ts`, `metrics-collector.test.ts`) — o repo não tinha teste nenhum. Um deles encontrou bug real: `extractSince` truncava a janela em silêncio quando os pontos estavam mais densos que o `collectInterval` configurado (intervalo aumentado depois da série ser escrita). Corrigido com alargamento exponencial da leitura. A cobertura de rollup também pegou duas inconsistências no mock do demo: séries com larguras de bucket misturadas e o rateio por fila divergindo do total.
- [x] T031 [P1] `tsc --noEmit` limpo em root/express/koa/fastify/hapi/cli; UI de volta ao único erro pré-existente (`Pagination/hooks.ts`).
- [x] T032 [P1] `eslint` limpo no repo inteiro; `jest` 20/20.
- [x] T033 [P2] Verificação visual via `dev-with-mocks` + Playwright headless: Overview, filtro por status, Metrics history e throughput na tela de jobs. Zero erro de console.
- [x] T034 [P2] Build da UI (Vite) e build de todos os pacotes de servidor.

### Security
- [x] T035 [P1] `/metrics` nasce desligado, exige opt-in explícito; risco de exposição de nome de fila documentado no README e no `examples/grafana`.
- [ ] T036 [P1] **Pendente de decisão do usuário**: auth nativa (E8). A superfície cresceu (rota nova + 2 telas), mas continua sem controle de acesso, como todo o resto do dashboard.

## Arquivos Alterados

| Arquivo | Mudança |
|---|---|
| `packages/root/src/queue.ts` | `GlobalJobFailureCb` + setter abstrato |
| `packages/root/src/bull-adapter.ts` | `global:failed` |
| `packages/root/src/bullmq-adapter.ts` | `QueueEvents.failed` |
| `packages/root/src/metrics-collector.ts` | Contadores de throughput, `extractSince`, `getSummary`, downsampling |
| `packages/root/src/constants.ts` | Defaults de coleta + `DEFAULT_PROMETHEUS_CONFIG` |
| `packages/root/src/prometheus.ts` | **Novo** — renderer do formato Prometheus |
| `packages/root/src/main.ts` | `renderPrometheus()`, `prometheusConfig`, `_resolveEndpoint` |
| `packages/root/src/index.ts` | Exporta renderer + `PrometheusConfig` |
| `packages/root/src/typings/config.ts` | `PrometheusConfig` |
| `packages/root/src/gql/data-sources/bull/index.ts` | Memoização por request |
| `packages/root/src/gql/data-sources/metrics/index.ts` | `since`/`maxPoints`, `getSummary` |
| `packages/root/src/gql/resolvers/queue.ts` | Fields de contagem via um único `getJobCounts()` |
| `packages/root/src/gql/resolvers/query.ts` | `metricsSummary` |
| `packages/root/src/gql/type-defs/{metrics,root-query}.ts` | Tipos e args novos |
| `packages/root/src/__tests__/*` | **Novos** — 20 testes |
| `packages/{express,koa,fastify,hapi}/src/index.ts` | Rota `/metrics` |
| `packages/cli/src/index.ts` | Flags de Prometheus + novos defaults |
| `packages/ui/src/screens/overview/*` | **Novo** — tela de overview |
| `packages/ui/src/screens/history/*` | **Novo** — histórico global |
| `packages/ui/src/screens/shared/*` | **Novo** — chart, range picker |
| `packages/ui/src/screens/jobs/Throughput/*` | **Novo** — card no topo da fila |
| `packages/ui/src/screens/{jobs,switch}.tsx` | Wiring das telas |
| `packages/ui/src/stores/{active-screen,throughput-panel}.ts` | Navegação de 4 telas |
| `packages/ui/src/shell/{Drawer,AppBar}/*` | Nav novo |
| `packages/ui/src/network/queries/*`, `demo-mocks/*` | Query e mocks de summary |
| `.github/workflows/ci.yml` | **Novo** — CI |
| `examples/grafana/*` | **Novo** — docs + dashboard |
| `docs/ROADMAP.md` | **Novo** — backlog de 8 épicos |
