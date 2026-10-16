# Task 005 — Flows e traces

**Status:** 🔄 Em andamento (backend T001–T009, UI T010–T015, docs T016, skip de agente T021 e Security T017 implementados; QA de UI em andamento; piloto Vyral T018 pendente; changeset criado, T019 aguarda a skill de exemplo)
**Versão SDD:** 1.0 (`spec.md` + `architecture.md`, defaults do Completeness Gate adotados)
**Data:** 2026-10-16
**Squad:** PO → Architect → TechLead → Developer → QA → Security → Ops

## User Stories

- **US001** — Declarar flows no setup do monitor (etapas, arestas, condições, fallback, erro, conclusão, chave de negócio), sem UI de edição.
- **US002** — Helpers `startTrace` / `withTrace` (e `encodeTrace` / `continueTrace` para elo HTTP) no worker.
- **US003** — Aba Flow: árvore com contadores ao vivo, throughput, p50/p95, espera e falhas por etapa, gargalo (grafo A / tabela B).
- **US004** — KPIs do flow na janela (entradas, concluídos, fim a fim p50/p95, gargalo, falhas).
- **US005** — Busca por trace id, job id ou chave de negócio; caminho do evento (grafo A / gantt B).
- **US006** — Chave com várias execuções: escolher o trace (mais recente primeiro).
- **US007** — Aba Config: definição, convenção `_trace` e validação.
- **US008** — `docs/flows.md` e skill `bull-horizon` estendida.
- **US009** — Vyral: flows declarados, instrumentados e visíveis no painel.

## Regras de Negócio

- Ver `spec.md` § Regras de Negócio (1–13) e § Decisões do Completeness Gate (1–14).
- Flow declarado no código (`Config.flows`), painel só lê. Etapa = fila (+ `jobs` opcional).
- Trace em `data._trace` (`FlowTraceV1`), escrito uma vez ao enfileirar; helpers nunca lançam.
- Agregados e índice vêm do collector; sem collector só a aba Config funciona.
- Índice limitado por flow (`recentTraces`), despejo sem chave/membro órfão.

## Tasks

### Foundation
- [x] T001 [P1] [US001] `flow/contract.ts` + `flow/definition.ts`: tipos `FlowConfig`/`FlowTraceV1`, `normalizeFlows` com checks, getter de caminho seguro. Testes de config inválida (nunca lança)
- [x] T002 [P1] [US002] `flow/trace.ts`: `startTrace` (com `parent`), `withTrace`, `readTrace`, `encodeTrace`, `continueTrace`; cálculo de tentativa em `shared/attempt.ts` (+ `terminalAttempts`). Testes: Bull 3, BullMQ 1, BullMQ 5, sandbox sem `queue`, data não-objeto, hop 64, pai sem trace, `onError` que lança
- [x] T003 [P1] [US001] `Config.flows`/`flowsOptions` no `BullMonitor`, exports no `index.ts`
- [x] T004 [P1] Extrair `histogramQuantile` para `metrics/histogram.ts` (refactor puro, testes do agente verdes) e o fetch único do job no `MetricsCollector`

### Business Logic
- [x] T005 [P1] [US003, US004] `metrics/flow-metrics.ts`: ingestão por evento terminal, ponto `TFlowPoint`, série `::flow`, `lost`/`untraced`/`retried`, arestas, fim a fim. Testes com FakeRedis (inclui `zrangebylex`)
- [x] T006 [P1] [US005] Índice de traces: escrita em `MULTI`, teto por trace, despejo sem órfão, `clear`/`clearAll`. Teste de despejo que confere que nenhuma chave/membro sobra
- [x] T007 [P1] [US003, US004, US007] GraphQL `flows` + `flowSummary` (stats por etapa, KPIs, gargalo, erros recentes, checks dinâmicos)
- [x] T008 [P1] [US005, US006] GraphQL `flowTrace`: resolução trace id / job id / chave, candidatos, fronteira pendente, status do trace
- [x] T009 [P1] Codegen + `typings/gql.ts` (root e ui) pelo caminho documentado na 004

### UI
- [x] T010 [P1] [US007] UI: rota `flows`, sidebar (entrada + selo FLOW no grupo), store, cabeçalho, busca, aba Config
- [x] T011 [P1] [US003, US004] UI: aba Flow opção A (`layoutFlowGraph`, `FlowGraph`, `StepPanel`, KPIs) + testes do `model.ts`
- [x] T012 [P1] [US005] UI: aba Trace opção A (grafo com caminho + `TracePath`)
- [x] T013 [P2] [US003] UI: aba Flow opção B (`FlowTable`)
- [x] T014 [P2] [US005] UI: aba Trace opção B (`TraceGantt` com expansão via `Query.job`)
- [x] T015 [P1] Demo mocks `content-ingest`

### Docs
- [x] T016 [P1] [US008] `docs/flows.md` (contrato, setup, retenção, limites) + extensão da skill `skills/bull-horizon`

### Security
- [x] T017 [P1] Security review (`security-review.md` na 005): busca em rota sem auth, `_trace` lido do Redis, chave de negócio no índice, tela de trace

### Piloto / Entrega
- [ ] T018 [P1] [US009] Vyral (repo da Vyral): declarar flows, `startTrace`/`withTrace`/`continueTrace`, retenção numérica (lista em `vyral-flows.md` §5)
- [ ] T019 [P2] Changeset (`minor`) + skill de exemplo com o flow da Vyral anonimizado (changeset `.changeset/flows-and-traces.md` criado; o exemplo anonimizado está em `docs/flows.md` e `skills/bull-horizon/references/flows.md`)
- [x] T021 [P2] Skip de agente: `recorder.skip`/`markAgentRunSkipped`, `AgentsSummary.skipped`, docs e skill

### QA
- [x] T020 [P3] Auditoria QA do backend (T001–T009) contra este arquivo e `architecture.md` (`qa-report-backend.md`)
- [x] T022 [P2] Auditoria QA da UI (T010–T015): aprovada com 4 Minor (`qa-report-ui.md`)

## Arquivos Alterados

| Arquivo | Mudança |
|---|---|
| `packages/root/src/shared/attempt.ts` | novo: `currentAttempt`, `terminalAttempts`, `isBullMQJobLike` (T002) |
| `packages/root/src/agent/recorder.ts` | `defaultAgentRunAttempt` delega para `currentAttempt` (sem mudança de comportamento) |
| `packages/root/src/flow/{contract,definition,trace,yaml,index}.ts` | novo módulo `flow/` (T001, T002) |
| `packages/root/src/metrics/histogram.ts` | novo: `histogramBand`, `histogramQuantile`, histograma esparso (T004) |
| `packages/root/src/metrics/agent-metrics.ts` | `latencyBand`/`latencyPercentile` delegam ao histograma (T004) |
| `packages/root/src/metrics/flow-metrics.ts` | novo: série `::flow` e índice de traces (T005, T006) |
| `packages/root/src/metrics-collector.ts` | `FlowMetrics` composto, fetch único do job, flows em `clear`/`clearAll` (T004–T006) |
| `packages/root/src/typings/config.ts`, `constants.ts`, `main.ts`, `index.ts` | `Config.flows`/`flowsOptions`, normalização no boot, exports (T003) |
| `packages/root/src/gql/type-defs/flows.ts`, `gql/data-sources/flows/*`, `gql/resolvers/*` | schema, data source e resolvers `flows`/`flowSummary`/`flowTrace` (T007, T008) |
| `packages/root/src/typings/gql.ts`, `packages/ui/src/typings/gql.ts` | codegen (T009) |
| `packages/root/src/__tests__/flow-*.test.ts`, `flows-resolvers.test.ts`, `helpers/flow-fakes.ts`, `helpers/agent-fakes.ts` | testes e fakes (FakeRedis ganhou comandos lex/zset/hash) |
| `packages/root/src/agent/{contract,recorder,index}.ts` | skip de agente: `AGENT_RUN_SKIP_LOG_PREFIX`, `parseAgentRunSkipLine`, `recorder.skip`, `markAgentRunSkipped`, `formatAgentRunSkipLine` (T021) |
| `packages/root/src/metrics/agent-metrics.ts`, `gql/type-defs/agents.ts`, `gql/data-sources/agents/index.ts` | contagem `skipped` no ponto e `AgentsSummary.skipped` (T021) |
| `packages/root/src/__tests__/agent-skip.test.ts` | testes do skip, Bull e BullMQ (T021) |
| `packages/ui/src/screens/flows/*` | tela Flows: `index.tsx`, `FlowTab`, `FlowGraph`, `FlowTable`, `StepPanel`, `TraceTab`, `TracePath`, `TraceGantt`, `ConfigTab`, `model.ts`, `format.ts`, `colors.ts`, `parts.tsx`, `use-open-jobs.ts` + testes (T010–T014) |
| `packages/ui/src/stores/flows.ts`, `stores/__tests__/flows.test.ts`, `stores/active-screen.ts` | store da tela e rota `flows` (T010) |
| `packages/ui/src/hooks/use-flows-query.ts`, `network/queries/get-flow{s,-summary,-trace}.ts`, `config/query-keys.ts`, `providers/network/value.ts` | queries GraphQL (T010) |
| `packages/ui/src/demo-mocks/network/flows/*`, `demo-mocks/network/queries/get-flow*.ts`, `demo-mocks/network/data.ts` | mocks `content-ingest` (T015) |
| `packages/ui/src/shell/Drawer/{index,ScreenNav}.tsx`, `shell/Drawer/Queues/{index,Group,screen-scope}.ts(x)` + teste, `screens/switch.tsx` | entrada Flows na sidebar, selo `FLOW` no grupo, navegação (T010) |
| `docs/flows.md`, `README.md`, `skills/bull-horizon/SKILL.md`, `skills/bull-horizon/references/{flows,troubleshooting,agent-runs}.md`, `docs/agent-runs.md` | documentação e skill (T016, T021) |
| `.changeset/flows-and-traces.md` | changeset beta `minor` de root e ui (T019) |
| `memorys/architecture.md`, `memorys/guidelines.md`, `memorys/business.md` | ADR-005 aprovada e ajustada, isolamento de `agent/`/`flow/` com `shared/attempt.ts`, regra de navegação de Flows |

## Decisões Técnicas

- **Chaves de negócio do trace espelhadas no zset `traces::jobs`** como membros `traceId\0~k\0<chave>` (e marcador `traceId\0~x` de truncamento). O despejo apaga tudo do trace com um `ZREMRANGEBYLEX` no prefixo e acha as chaves para o `ZREM` em `traces::keys` sem read-modify-write no meta. O meta vira constante por trace (`HSETNX {k, s}`). `~` ordena depois do alfabeto base64 dos `queueId`, então a contagem de jobs (`[id\0`, `(id\0~`) não conta marcadores.
- **Toda falha é final** (ajuste pós-QA G1): nenhuma lib emite falha para tentativa com retry; falha com tentativas sobrando (`discard()`, `UnrecoverableError`) conta.
- **Pendentes em todas as etapas** (G2), **aresta para `onError` implicitamente declarada** (G3), **busca por trace id sem índice cai na varredura de pendentes** (G4). Ver `architecture.md` §7.1.
- **Status COMPLETED por ramo `end`**: etapa com aresta `end` concluída, sem filho e sem pendente, fecha o trace (o caso "já existe" da Vyral). O `complete` default inclui os nós `end` sintéticos, que nunca recebem job.
- **`(other)` conta no teto** de 64 arestas por ponto (o registro nunca passa de 64 chaves).
- **`clear(queue)`** apaga as chaves dos flows que têm etapa naquela fila (série e índice são por flow, não por fila).
