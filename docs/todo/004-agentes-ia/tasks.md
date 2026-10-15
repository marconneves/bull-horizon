# Task 004 — Agentes IA

**Status:** ✅ Implementado (aguardando publicação 6.5.0 para o brand-api)
**Versão SDD:** 1.0
**Data:** 2026-10-15
**Squad:** PO → Architect → TechLead → Developer → QA → Security → TechLead review → Ops
**Insumos:** `spec.md` (PO), `architecture.md` (Architect, fonte da verdade técnica), `threat-model.md`, `design/06 Agentes IA.dc.html`

## User Stories
Ver `spec.md` (US001 a US007).

## Tasks

### Foundation (backend, `packages/root`)
- [x] T001 [P1] Refactor: extrair `metrics/tiered-series.ts` do `metrics-collector.ts`, sem mudar chave nem formato do throughput. Testes atuais verdes antes de seguir. (arch § 5.1)
- [x] T002 [P1] [US002] Contrato + helper em `src/agent/` (`contract.ts`, `detail.ts`, `limits.ts`, `summarize.ts`, `recorder.ts`, `index.ts`), exportados do índice do root. Testes: corte `basic` por varredura recursiva (inclui degradação de 64 KB e `fail()`), tetos, nunca lança (log que lança, rejeita, nunca resolve), compat com o `AiTrace` real do brand. (arch § 1, § 4)
- [x] T003 [P1] [US001] Config: `QueueConfig.ai`, `Config.ai` (pricing, recentRuns), `Queue.agent`/`isAgentJob`, `getJobLogs(start, end)` nos adapters Bull e BullMQ, remover o `QueueConfig` duplicado de `typings/config.ts`. (arch § 3)

### Business Logic
- [x] T004 [P1] [US005, US006] Collector de agentes (`metrics/agent-metrics.ts`): ingestão em `completed`/`failed`, releitura única em 2 s, dedupe `ZADD NX`, ponto `TAgentPoint`, merge, histograma e percentil, índice capado, `clear`/`clearAll`. Testado contra Bull e BullMQ. (arch § 5)
- [x] T005 [P1] [US003–US006] GraphQL: `agents` type-defs, data source e resolvers; custo na leitura; corte defensivo e `detailMismatch`; `NO_COLLECTOR` para summary e runs. (arch § 6)

### UI (`packages/ui`)
- [x] T006 [P1] [US003, US004] Store `agents`, tela `agents` na sidebar (só com fila de agente), tela de run com Graph e Waterfall, seletor de tentativa, painel do nó, barras Tempo/Tokens/Custo, componente `SafeMarkdown`. (arch § 7)
- [x] T007 [P1] [US005, US006] Abas Metrics (agregados) e Runs (lista com cadeia de tools, filtros e ordenação), janela derivada de `metricsInfo`.
- [x] T008 [P2] Ação "Agent run" na linha do job e linha de run colapsada no modal de Logs.
- [x] T009 [P2] Codegen + demo mocks (`VITE_ENABLE_MOCKS`) com fila `brand-app:ai` e o run do design em `full`.

### Docs
- [x] T010 [P2] [US007] Doc do contrato v1 (exemplo real, níveis, tetos, requisito de `removeOnComplete` numérico), README e changeset.
- [x] T011 [P2] [US007] Skill de instrumentação de jobs de agente, escrita a partir do contrato final.

### QA
- [x] T012 [P2] Auditoria QA contra os critérios de aceite da `spec.md`, com verificação visual no modo demo.

### Security
- [x] T013 [P1] Revisão dos 9 pontos de `threat-model.md`, relatório em `security-review.md`.

### Consumidor (repo app-brand, `apps/brand-api`)
- [ ] T014 [P2] Migrar o `TraceRecorder` para `createAgentRun`, declarar `AI_AGENT` no monitor e no worker, `pricing`. Depende da publicação da nova versão do `@bull-horizon/root`.

### Extensão: aba Conversa
- [x] T015 [P1] [US008] Backend: `c` no índice de runs, query `agentConversation` (arch § 9), testes Bull e BullMQ.
- [x] T016 [P1] [US008] UI: tela de conversa (Chat e List), KPIs, mensagens no tempo, tools usadas, entrada pelo painel do run.
- [x] T017 [P2] [US008] Demo mocks da conversa `c-7f21` e codegen.
- [x] T018 [P2] Docs e skill: seção Conversa (agrupamento por `input.conversationId`, o que aparece em basic/full).

## Decisões Técnicas
- Ver ADR-004 em `memorys/architecture.md`.
- Markdown limitado e seguro para texto de passo e resposta final (usuário, 2026-10-15). Ver `memorys/guidelines.md`.
