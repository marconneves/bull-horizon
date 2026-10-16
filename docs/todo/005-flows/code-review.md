## 📝 Code Review Report — Task 005 (Flows e traces + skip de agente)

**Revisor:** 👑 Tech Lead
**Data:** 2026-10-16
**Veredito:** 🔁 CHANGES REQUESTED (só documentação, memória e changeset; nenhum ajuste de código de produção exigido)

Escopo: diff não commitado inteiro de `feat/flow-para-ia` sobre `bf29fe2` (35 arquivos modificados e os arquivos novos de `flow/`, `shared/`, `metrics/`, `gql/*/flows`, `screens/flows/`, mocks, testes, `docs/flows.md`, `skills/bull-horizon/references/flows.md`), com o marcador de skip de agente (`recorder.skip()`, `markAgentRunSkipped`, `AgentsSummary.skipped`). O fallback por returnvalue e o `unrecorded` já estão no commit `64be374`; aqui só entram os restos deles (o `skipped` exclui o `unrecorded`). Insumos: `spec.md` (com as Decisões do Completeness Gate), `architecture.md` (com § 7.1 Ajustes pós-QA e Pós-Security), `tasks.md`, `qa-report-backend.md`, `security-review.md`, `docs/flows.md`, `docs/agent-runs.md`, a skill `bull-horizon`, o README e as memórias. Não refiz QA funcional nem auditoria de segurança. O QA de UI está rodando em paralelo e pode mexer um pouco em `screens/flows/`; se isso acontecer, este review vale para o restante e a UI recebe só uma checagem rápida de diff.

### Verificação automatizada

| Comando | Resultado |
|---|---|
| `npx jest` (raiz) | ✅ 23 suites, 431 testes, todos verdes |
| `tsc --noEmit --noUnusedLocals --noUnusedParameters` em `packages/root` | ✅ sem erros |
| `tsc --noEmit --noUnusedLocals` em `packages/ui` | ✅ sem erros |
| `eslint packages/root/src packages/ui/src --ext .ts,.tsx` | ✅ 0 erros, 0 warnings |
| `npm run build` em `packages/root` | ✅ `dist/flow/` e `dist/shared/` gerados; nenhum `__tests__` nem `*fakes*` no `dist` |
| `npm run build` em `packages/ui` | ✅ build Vite ok |
| `package.json` (raiz e pacotes) / `package-lock.json` | ✅ inalterados, nenhuma dependência nova (o YAML da aba Config é renderizado por `flow/yaml.ts`, sem parser) |
| Typings gerados | ✅ os 235 campos dos tipos `Flow*`/`Agent*` batem 1:1 entre `packages/root/src/typings/gql.ts` e `packages/ui/src/typings/gql.ts`, e `AgentsSummary.skipped` está nos dois |

### Spec Compliance

- [✅] T001 a T009 (backend): `flow/{contract,definition,trace,yaml,index}.ts`, `shared/attempt.ts`, `metrics/histogram.ts`, `metrics/flow-metrics.ts`, `gql/type-defs/flows.ts`, `gql/data-sources/flows/`, `Query.flows`/`flowSummary`/`flowTrace`, exportado por `export * from './flow'` em `packages/root/src/index.ts`.
- [✅] Ajustes do § 7.1 refletidos no código: G1 (toda falha é final), G2 (varredura de pendentes em todas as etapas), G3 (aresta para `onError` implícita), G4 (trace id sem índice cai na varredura) e Pós-Security S1/S2/S4 (formato `tr_`, memo por request e tetos de varredura, score do zset `traces` pela hora de ingestão).
- [✅] T010 a T015 (UI): rota `flows`, sidebar com selo `FLOW · <id>` em `Group.tsx`, store `stores/flows.ts`, abas Flow (A `FlowGraph` + `StepPanel`, B `FlowTable`), Trace (A `TracePath`, B `TraceGantt`), Config, mocks `content-ingest`. Os arquivos batem com a tabela do § 6.2.
- [✅] Decisões do Completeness Gate respeitadas: A/B alternáveis com A como padrão, definição em objeto TS com YAML só na exibição, `data._trace`, teto de 500 por fila, seletor de janela, `recentTraces` 2000 (`DEFAULT_FLOWS_OPTIONS`, igual a `docs/flows.md:329-331`), botão `+` removido.
- [❌] `tasks.md` está desatualizado em relação ao diff (must-fix 3): o cabeçalho diz "UI e piloto pendentes" com T010 a T015 marcadas; T016 está `[ ]` com `docs/flows.md` e `skills/bull-horizon/references/flows.md` prontos; T020 está `[ ]` com `qa-report-backend.md` entregue; o skip de agente não tem task nenhuma, embora o Security e o QA o tenham revisado; "Arquivos Alterados" não lista nada da UI nem o skip.
- [❌] Changeset do beta inexistente (must-fix 1). T019 continua aberta.
- [✅] T018 (piloto Vyral) fica fora deste repo, corretamente pendente.
- [✅] Nenhum scope creep no código fora do skip, que já tem doc, teste (`agent-skip.test.ts`) e review do Security.

### Guidelines Compliance

- [✅] Styling: os 10 componentes de `screens/flows/` usam `makeStyles`. Nenhum hex, `rgba()`, `sx` ou `styled()`. Cores em `screens/flows/colors.ts`, derivadas de `theme.palette` e da paleta de status com `alpha()`. O realce do grupo na sidebar também usa `alpha(theme.palette.primary.main, …)`.
- [✅] Texto vindo de job (erro, returnvalue, ids, `_trace`) é texto puro: nenhum `dangerouslySetInnerHTML` e nenhum `SafeMarkdown` em `screens/flows/`.
- [✅] Registros por chave externa só com dono próprio: `emptyRecord()`/`hasOwn`/`ownEntries` em `flow-metrics.ts` (`_step` linha 569, `mergeFlowPoints` linhas 223-243, `parseTraceJobMember` linha 281) e no data source (`stepPoint` linha 203, spark linha 222). `addCapped` dobra em `(other)` com teto de 64 chaves. Definição normalizada em `Map`s.
- [✅] Isolamento de `flow/`: só importa de si mesmo, de `shared/attempt.ts` e do `crypto` do Node, como autoriza o § 3.1. Não importa `gql/`, collector nem lib de terceiros. `shared/attempt.ts` não importa nada.
- [⚠️] Isolamento de `agent/`: `agent/recorder.ts:25` agora importa `../shared/attempt`. Isso foi pedido no § 3.1 da 005, mas contradiz o texto do ADR-004 D3 ("sem importar nada do resto do pacote") e a guideline, que ainda fala só de `agent/`. Ver must-fix 2.
- [✅] Nunca lança: `skip()` e `markAgentRunSkipped` passam pelo `writeLogLine` com timeout e `try/catch`; `startTrace`/`withTrace`/`continueTrace` com `onError` protegido, cobertos em `flow-trace.test.ts`.
- [✅] Dual Bull/BullMQ: `currentAttempt`/`terminalAttempts` centralizam as diferenças (Bull 3, BullMQ 1 a 4, BullMQ 5+), com teste das três famílias.
- [✅] Sem `console.log`, `debugger` ou `TODO`. Os 5 `eslint-disable-next-line` (`flow/contract.ts:184` para o regex de controle e `flow/trace.ts:100,175,226,325` para `ban-types`) têm justificativa no próprio comentário. Os `console.warn`/`console.error` seguem o padrão `[bull-horizon]`.

### Architecture Compliance

- [✅] Série por flow em `TieredSeries`, histograma compartilhado (`metrics/histogram.ts`); `agent-metrics.ts` delega `latencyBand`/`latencyPercentile` sem mudar `AGENT_LATENCY_BOUNDS_MS`, e os testes do agente seguem verdes (refactor puro).
- [✅] Índice em zsets lex com despejo sem órfão, metadado constante por trace (`HSETNX`), `clear(queue)` apagando os flows com etapa na fila.
- [✅] Fetch único do job no `MetricsCollector`, repartido entre agente e flow.
- [⚠️] `memorys/architecture.md:125-141` (ADR-005) está desatualizado em relação ao código. Continua como "PROPOSTA, não aprovada" esperando P1 a P11, mas o Gate já decidiu. A Decisão 4 diz que o score de `::traces` é `startedAt` (agora é a hora de ingestão, S4). A Decisão 5 diz "só na fronteira" (G2 mudou para todas as etapas). Faltam G1, G3, G4 e o caminho de busca do S1. Ver must-fix 2.
- [✅] Prometheus intocado para flows (regra "não fazer" do ADR-005).

### Business Compliance

- [✅] Painel só lê; sem collector, só a aba Config (`switch.tsx`/`index.tsx`); a busca é determinística (trace id, job id ou chave exata); o índice é limitado e avisa `indexFull`/`partial`/`truncated`; a divergência entre desenho e código vira check, nunca exceção.
- [✅] Skip: o motivo é rótulo curto (`clipId` 120), contado e nunca servido; `skipped` exclui `unrecorded` como dizem `docs/agent-runs.md:292-323` e `skills/bull-horizon/references/troubleshooting.md:62`.
- [⚠️] `memorys/business.md` não tem a regra de negócio de Flows (só a de Agentes IA) nem o conceito de "skip" ao lado de `unrecorded`. O `compound` pode cobrir isso; ver nice-to-have 6.

### Higiene de Código

- `packages/root/src/flow/definition.ts:151-514`: `normalizeOne` tem cerca de 360 linhas, em 9 seções comentadas (Steps, onError, Edges, Entry, Complete, Reachability, Shared queues, Trace config, Group). Legível, mas é a maior função do diff. Nice-to-have 1.
- `packages/root/src/gql/data-sources/flows/index.ts:189-413`: `getSummary` tem cerca de 225 linhas (o arquivo inteiro tem 990). `_getTrace` (431, 101 linhas) e `_buildTrace` (563, 93 linhas) também são longas. `metrics/flow-metrics.ts:575` `_ingest` tem 120 linhas. Nice-to-have 1.
- `packages/ui/src/screens/flows/{FlowTab,TraceTab,TracePath,ConfigTab}.tsx` importam `Kpis`, `MONO` e `fmt*` de `../agents/shared` e `../agents/format`. Uma tela depende da pasta de outra tela. Nice-to-have 2.
- `packages/ui/src/shell/Drawer/Queues/Group.tsx`: `className={`${cls.listItem} ${flows.length ? cls.flowGroup : ''}`}` deixa um espaço sobrando e foge do `clsx` usado no resto do pacote. Nice-to-have 3.
- `packages/ui/src/stores/flows.ts:2`: o import relativo `../config/storage` repete o contorno do alias `@/` no jest que a 004 já tinha (nice-to-have 1 da 004, ainda aberto).
- `AgentsSummary.skipped` está no schema e nos typings, mas `network/queries/get-agents-summary.ts` não pede o campo e nenhuma tela o mostra. A doc só promete o campo no GraphQL, então não é bug. Nice-to-have 4.
- Demo: o trace `tr_9f2c41e7b0` (`demo-mocks/network/flows/content-ingest.ts:591`) tem 10 hex, mas o formato real é `tr_` + 16 hex. Só cosmético no modo demo. Nice-to-have 5.

---

### 🔴 Must fix (bloqueiam o commit)

1. **Criar o changeset do beta** (`.changeset/flows-and-traces.md`, `'@bull-horizon/root': minor` e `'@bull-horizon/ui': minor`; o modo `pre` beta já está ativo em `.changeset/pre.json`). O texto precisa dizer:
   - **Flows**: `Config.flows` (etapa = fila + `jobs?`, `next` com `when`/fallback, `onError`, `complete`, `trace.key`/`aliases`) e `Config.flowsOptions` (`recentTraces` 2000, `jobsPerTrace` 300, `pendingScanLimit` 500). O painel só lê, e a validação no boot gera avisos, nunca exceção.
   - Helpers exportados: `startTrace`, `withTrace`, `readTrace`, `encodeTrace`, `continueTrace`, os tipos `FlowTraceV1`/`FlowConfig`/`FlowStepConfig`/`FlowNext`/`FlowTraceConfig`/`FlowsOptions`/`FlowTraceParent*` e as constantes `FLOW_TRACE_FIELD`/`FLOW_TRACE_VERSION`/`FLOW_MAX_HOP`/`DEFAULT_FLOWS_OPTIONS`. O trace vai em `data._trace`, sem dependência, e os helpers nunca lançam.
   - Tela **Flows**: abas Flow (grafo/tabela, KPIs, gargalo, painel da etapa), Trace (busca por trace id, job id ou chave; caminho/gantt; pendentes) e Config (YAML, convenção `_trace`, checks), mais o selo `FLOW` no grupo da sidebar.
   - GraphQL: `Query.flows`, `Query.flowSummary`, `Query.flowTrace`.
   - Requisitos: Flow e Trace exigem o collector (`metrics: {}`); filas de flow precisam de `removeOnComplete`/`removeOnFail` numéricos (senão o job conta como `lost`); um trace mais velho que o índice não é achado (`indexFull`).
   - Segurança: a chave de negócio deve ser um id opaco (nunca dado pessoal nem hash dele), a busca roda numa rota sem auth com tetos por request, e flows não vão para o endpoint Prometheus.
   - **Skip de agente**: `recorder.skip(reason?)`, `markAgentRunSkipped(job, { agent, reason })`, `formatAgentRunSkipLine`, `parseAgentRunSkipLine`, `AGENT_RUN_SKIP_LOG_PREFIX`, `AgentRunSkipV1`, `MarkAgentRunSkippedOptions` e `AgentsSummary.skipped`. A tentativa marcada conta como `skipped`, não como `unrecorded`. O `reason` é um rótulo curto de até 120 chars, gravado em qualquer nível, e nunca deve levar conteúdo.
   - Interno, sem mudança de API: `defaultAgentRunAttempt` passa a delegar para `shared/attempt.ts`, sem mudança de comportamento.
2. **Sincronizar as memórias com o que foi implementado**:
   - `memorys/architecture.md:125-141` (ADR-005): trocar o status "PROPOSTA, não aprovada" por "aprovada pelos defaults do Completeness Gate (2026-10-16, revisáveis)". Corrigir a Decisão 4 (score de `::traces` = hora de ingestão; `startedAt` fica no meta, recortado a agora + 5 min) e a Decisão 5 (varredura em todas as etapas, com o teto por fila mais o teto por request de S2). Acrescentar G1 (toda falha é final), G3 (aresta para `onError` implícita) e G4/S1 (fallback de busca por trace id só no formato `tr_` + 16 hex ou com `traceId` explícito).
   - ADR-004 D3 (`memorys/architecture.md:115`) e `memorys/guidelines.md:23`: trocar "hoje `packages/root/src/agent/`" por "`packages/root/src/agent/` e `packages/root/src/flow/`", e registrar que a única dependência interna permitida é `shared/attempt.ts` (puro, sem import), mais `crypto` do Node em `flow/`.
3. **`docs/todo/005-flows/tasks.md`**:
   - Cabeçalho: indicar backend e UI implementados, e piloto e changeset pendentes.
   - Marcar T016 `[x]` e T020 `[x]` (com o QA de UI em andamento, registrar isso como item próprio).
   - Adicionar uma task para o skip de agente, por exemplo `T021 [P2] Skip de agente: recorder.skip/markAgentRunSkipped, AgentsSummary.skipped, docs e skill`, marcada `[x]`.
   - Completar "Arquivos Alterados" com `packages/ui/src/screens/flows/*`, `stores/flows.ts`, `hooks/use-flows-query.ts`, `network/queries/get-flow*.ts`, mocks, `shell/Drawer/*`, `agent/{contract,recorder,index}.ts` (skip), `docs/flows.md`, README e `skills/bull-horizon/**`.

### 🟡 Nice to have (não bloqueiam)

1. Quebrar `normalizeOne` (`flow/definition.ts:151`) em uma função por seção (`normalizeSteps`, `normalizeEdges`, `checkReachability`, `normalizeTraceConfig`...) e `getSummary` (`gql/data-sources/flows/index.ts:189`) em `_stepStats`, `_edgeStats` e `_kpis`. Mesma ideia para `_ingest` (`metrics/flow-metrics.ts:575`).
2. Mover `Kpis`, `MONO` e `fmt*` de `screens/agents/{shared,format}` para `screens/shared/`, usados pelas duas telas.
3. `shell/Drawer/Queues/Group.tsx`: usar `clsx(cls.listItem, flows.length > 0 && cls.flowGroup)`.
4. Mostrar `skipped` na aba Metrics ao lado do aviso de `unrecorded` (pedir o campo em `network/queries/get-agents-summary.ts`).
5. Demo: usar um trace id no formato real (`tr_` + 16 hex) em `content-ingest.ts:591`.
6. `memorys/business.md`: registrar a regra de negócio de Flows (flow declarado e só lido, trace por execução, chave de negócio como atalho, limites do índice) e o conceito de `skipped` ao lado de `unrecorded`. Pode entrar no `compound` pós-Ops.
7. `jest.config.js`: adicionar `moduleNameMapper` para `@/` e voltar `stores/flows.ts` e `stores/active-screen.ts` ao alias (pendência herdada da 004).

### Veredito Final

O código está conforme: `flow/` isolado como `agent/` (só `shared/attempt.ts` e `crypto`), nenhuma dependência nova, `makeStyles` + `alpha` sem hex, registros por chave externa só com dono próprio, ajustes pós-QA e pós-Security refletidos, typings coerentes entre root e ui, sem teste vazando para o `dist`, e jest, tsc, eslint e os dois builds verdes. O que bloqueia é processo e documentação: o changeset do beta não existe, a memória de arquitetura ainda descreve a proposta pré-QA da 005 (e uma regra de isolamento que o código agora ultrapassa de forma decidida), e o `tasks.md` não reflete o que foi feito, incluindo o skip, que não tem task. Corrigidos os três itens, o Tech Lead aprova sem novo ciclo de QA (salvo mudança vinda do QA de UI) e o fluxo segue para o Ops.
