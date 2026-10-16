## 📝 Code Review Report — Task 004 (Agentes IA + extensão Conversa)

**Revisor:** 👑 Tech Lead
**Data:** 2026-10-15
**Veredito:** 🔁 CHANGES REQUESTED (só documentação; nenhum ajuste de código de produção exigido)

Escopo: diff não commitado inteiro da branch `feat/flow-para-ia` (42 arquivos modificados + arquivos novos), contra `tasks.md`, `spec.md`, `architecture.md` (inclusive § 9), `threat-model.md`, relatórios de QA e Security, e as 3 memórias. Validação funcional e auditoria de segurança não foram refeitas (QA e Security já aprovaram). `packages/ui/src/stores/agents.ts` foi ignorado por estar recebendo a correção do achado c1 do QA em paralelo.

### Verificação automatizada

| Comando | Resultado |
|---|---|
| `npx jest` (raiz) | ✅ 14 suites, 248 testes, todos verdes |
| `tsc --noEmit` em `packages/root` | ✅ sem erros (também limpo com `--noUnusedLocals --noUnusedParameters`) |
| `tsc --noEmit` em `packages/ui` | ✅ sem erros (também limpo com `--noUnusedLocals`) |
| `eslint packages/root/src packages/ui/src --ext .ts,.tsx` | ✅ 0 erros, 0 warnings |
| `npm run build` em `packages/root` | ✅ `dist/agent/` gerado; nenhum arquivo de `__tests__` ou `helpers` no `dist` (tsconfig exclui `src/__tests__/**/*` e `*.test.ts`) |
| `npm run build` em `packages/ui` | ✅ build Vite ok |
| `package.json` / `package-lock.json` | ✅ inalterados, nenhuma dependência nova |

### Spec Compliance

- [✅] T001 `metrics/tiered-series.ts` extraído do collector, sem mudar chave nem formato.
- [✅] T002 `src/agent/` com `contract.ts`, `detail.ts`, `limits.ts`, `summarize.ts`, `recorder.ts`, `index.ts`, exportado por `packages/root/src/index.ts:15`.
- [✅] T003 `QueueConfig.ai`, `Config.ai` (`pricing`, `recentRuns`), `Queue.agent`/`isAgentJob`, `getJobLogs(start, end)` em `bull-adapter.ts:261` e `bullmq-adapter.ts:290`; o `QueueConfig` duplicado de `typings/config.ts` virou reexport de `../queue`.
- [✅] T004 e T005 collector de agentes, type-defs, data source e resolvers; `agentsTypeDef` registrado depois de Queue/Job/Query.
- [✅] T006 a T009 tela `agents`, Run (Graph + Waterfall), Metrics, Runs, ação "Agent run" no job, linha colapsada no modal de Logs, demo mocks ligados em `providers/network/value.ts`.
- [✅] T010 e T011 `docs/agent-runs.md`, README, skill `skills/bull-horizon-agent-jobs/` (consolidada em `skills/bull-horizon/`).
- [✅] T015 a T018 Conversa: `c` no índice, `Query.agentConversation` com teste `describe.each` Bull/BullMQ (`agent-conversation.test.ts:113`), tela Chat/List, KPIs, "Messages over time", "Tools used", botão "View whole conversation" em `ResponseCard.tsx`, mock `c-7f21`, seção "Conversation view" na doc e na skill.
- [❌] Changeset: `.changeset/agent-runs-view.md` não menciona a visão Conversa nem `Query.agentConversation`. Ver must-fix 1.
- [✅] T014 (migração do brand-api) fica fora deste repo, corretamente marcada como pendente e dependente da publicação.
- [✅] Sem scope creep no código. A mudança de frontmatter em `.claude/agents/*.md` é pedido explícito do usuário (fora da task 004, ver nice-to-have 8).

### Guidelines Compliance

- [✅] Styling: todo o código novo de UI usa `makeStyles` + `className`; nenhuma prop `sx`, nenhum `styled()`, nenhum hex ou `rgba()` fixo. Cores vêm de `useAgentColors()` (`screens/agents/colors.ts`), derivadas de `theme.palette` e da paleta de status, com `alpha()`. Os `style={{ color }}` inline existentes carregam só cores do tema calculadas em runtime (por série/estado), o que é aceitável.
- [✅] Sem `dangerouslySetInnerHTML`, sem renderizador de markdown de terceiros. `SafeMarkdown` monta elementos React a partir de `parse.ts`; summary, títulos de card e nomes de tool seguem texto puro.
- [⚠️] `SafeMarkdown` também renderiza a fala do usuário (`input.text`) em `ResponseCard.tsx:116` e `conversation/index.tsx:591`. Isso foi decidido em `architecture.md` § 9, mas a regra escrita em `memorys/guidelines.md:24` só cita "textos de passo e resposta final". Ver must-fix 2.
- [✅] Módulo "nunca lança": `packages/root/src/agent/` só importa de si mesmo (nenhum import de `gql/`, collector ou lib de terceiros). O sentido inverso (`queue.ts`, collector e data source importando de `agent/`) é o esperado.
- [✅] Dual Bull/BullMQ: `getJobLogs(start, end)` nos dois adapters; testes de collector e de conversa rodam contra os dois harnesses.
- [✅] Agregação por chave externa com `Map`/`hasOwnProperty` e dedupe de `queues` (validado pelo Security, F1).
- [✅] Sem `console.log`, `debugger`, `TODO`/`FIXME` ou `eslint-disable` no código novo. Os `console.warn`/`console.error` em `metrics/agent-metrics.ts:358` e `:469` seguem o mesmo padrão `[bull-horizon]` do `metrics-collector.ts:291`.

### Architecture Compliance

- [✅] ADR-004: run como linha `bull-horizon:agent-run <json>` em `job.log`, contrato `AgentRunV1`, helper isolado em `packages/root/src/agent/`, série própria `::ai` reaproveitando `TieredSeries`, custo calculado na leitura (`AgentsDataSource._pricing`), nada de `ai`/t-digest como dependência.
- [✅] Layout de arquivos bate com `architecture.md` § 4, § 5.1, § 6 e § 7 (`metrics/agent-metrics.ts`, `metrics/tiered-series.ts`, `gql/data-sources/agents/`, `gql/type-defs/agents.ts`, `screens/agents/{run,conversation}/`, `components/SafeMarkdown/`).
- [✅] § 9: `agentConversation` sem chave Redis nova, filtrando `::ai::runs::data`; teto 100; `NO_COLLECTOR`. A heurística de `maybeIncomplete` evoluiu em relação ao texto do § 9 (agora considera a maior pausa da conversa, mínimo 30 min), e o schema (`type-defs/agents.ts:304`) e `docs/agent-runs.md:690` descrevem o comportamento implementado. Ok.
- [✅] Typings gerados: os campos dos tipos `Agent*` em `packages/root/src/typings/gql.ts` e `packages/ui/src/typings/gql.ts` batem 1:1 com o schema. O diff grande vem de reordenação alfabética do codegen. Ver nice-to-have 5 sobre um comentário desatualizado.
- [⚠️] `memorys/architecture.md` (ADR-004) não registra a extensão Conversa (campo `c` no índice, `agentConversation` lendo só o índice). Pode entrar no `compound` pós-ciclo; ver nice-to-have 7.

### Business Compliance

- [✅] Ativação só em fila declarada; job fora do contrato aparece como job comum.
- [✅] `basic` por default, corte no processo do app; servidor corta de novo.
- [✅] Modelo sem preço retorna `null` ("no price"), nunca `$0`; `hasUnpricedMessages` na conversa.
- [✅] Entrada Agents na sidebar só com fila de agente; `switch.tsx` redireciona tela persistida quando não há mais fila de agente.
- [✅] Conversa: agrupa por `input.conversationId` na mesma fila; `basic` mostra "Not recorded at basic detail."; uma mensagem por job (maior tentativa); teto 100; sem collector não há link.
- [⚠️] `memorys/business.md:33` ainda diz "em refinamento desde 2026-10-15". Ver nice-to-have 6.

### Higiene de Código

- `packages/ui/src/screens/agents/conversation/index.tsx` (1151 linhas, ~480 só de `makeStyles` em 53 a 535) concentra 9 componentes. Os componentes em si são curtos, mas o arquivo destoa de `run/`, que já é fatiado (`Graph.tsx`, `Waterfall.tsx`, `NodeDetails.tsx`...). Nice-to-have 3.
- `packages/ui/src/screens/agents/run/ResponseCard.tsx:106-139` reimplementa a escolha "texto / erro / not recorded" que `conversation-model.ts:67-90` (`userText`/`replyText`, já testadas) faz. A string "Not recorded at basic detail." aparece em 3 lugares (`ResponseCard.tsx:107`, `NodeDetails.tsx:18`, `conversation-model.ts:72,83`). Nice-to-have 4.
- `packages/ui/src/screens/switch.tsx:22-24`: o comentário "Guards against a persisted metrics-only screen..." ficou acima do bloco novo de agents, separado do `if (METRICS_SCREENS...)` (linha 35) que ele descreve. Nice-to-have 2.
- `packages/ui/src/stores/active-screen.ts:1`: import trocado de `@/config/storage` para `../config/storage` (provavelmente para o jest, que não resolve o alias `@/`). Funciona, mas cria inconsistência com o resto do pacote. Nice-to-have 1.
- `jest.config.js`: ignorar `/__tests__/helpers/` está correto (fakes não são suites).

---

### 🔴 Must fix (bloqueiam o commit)

1. **`.changeset/agent-runs-view.md:13-14` e `:51-52`**: o changeset (que vira o CHANGELOG público e a release note) não fala da Conversa.
   - No parágrafo da tela Agents (linhas 10-14), acrescentar uma frase, por exemplo: "Runs that share an `input.conversationId` open as a **conversation**: every message of the chat in order (chat or list layout), with totals, timing and the tools used, linked from the run view."
   - Na linha 52, trocar "`Query.agentRun`, `Query.agentsSummary` and `Query.agentRuns`." por "`Query.agentRun`, `Query.agentsSummary`, `Query.agentRuns` and `Query.agentConversation`."
   - Em "Things to know" (linhas 40-47), citar que a Conversa também exige o collector e só enxerga o índice de runs recentes (`ai.recentRuns`), podendo ficar incompleta, e que `conversationId` deve ser id opaco (nunca email/telefone nem hash deles), como já está em `docs/agent-runs.md:665`.
2. **`memorys/guidelines.md:24`**: alinhar a regra do markdown limitado ao que o código faz e o § 9 decidiu. Trocar "textos de passo e resposta final passam por um markdown **limitado**" por "textos de passo, resposta final e a fala do usuário (`input.text`, só em `full`) passam por um markdown **limitado** (`components/SafeMarkdown`)". Sem isso a memória diz que `ResponseCard.tsx:116` e `conversation/index.tsx:591` violam a regra.

### 🟡 Nice to have (não bloqueiam)

1. `packages/ui/src/stores/active-screen.ts:1`: voltar para `@/config/storage` e adicionar `moduleNameMapper: { '^@/(.*)$': '<rootDir>/packages/ui/src/$1' }` no `jest.config.js`, em vez de imports relativos pontuais.
2. `packages/ui/src/screens/switch.tsx:22-24`: mover o comentário do guard de métricas para logo acima do `if (METRICS_SCREENS...)` (linha 35).
3. `packages/ui/src/screens/agents/conversation/index.tsx`: fatiar como `run/` (`ChatLayout.tsx`, `ListLayout.tsx`, `SidePanel.tsx`, `MessageDetail.tsx`), cada um com seu `makeStyles`.
4. `packages/ui/src/screens/agents/run/ResponseCard.tsx:106-139`: reutilizar `userText`/`replyText` de `conversation-model.ts` e extrair a constante `NOT_RECORDED` para `screens/agents/format.ts`, usada também por `NodeDetails.tsx:18`.
5. `packages/ui/src/typings/gql.ts` (doc de `AgentConversation.maybeIncomplete`): o comentário gerado descreve a heurística antiga. Rodar `make` do codegen da UI com o servidor atual para sincronizar a descrição com `type-defs/agents.ts:304`.
6. `memorys/business.md:33`: trocar "em refinamento desde 2026-10-15" por "implementada em 2026-10-15" (ou deixar para o `compound`). `spec.md:3` ("aguardando Architect") e as caixas do DoD também estão desatualizadas; atualizar no fechamento.
7. `memorys/architecture.md` (ADR-004): registrar a Decisão 6 da Conversa (campo `c` no índice, leitura só do índice capado, sem chave nova, `maybeIncomplete` heurístico). Natural no `compound` pós-Ops.
8. `.claude/agents/*.md` (frontmatter com nomes de tools do Claude Code e `model: opus|sonnet`): mudança intencional do usuário, mas fora do escopo da task 004. Sugerido ir num commit separado (`chore(squad): ...`) para não misturar com a feature no histórico.
9. `README.md` (seção "AI agent runs"): citar a visão de conversa em uma frase, como no changeset.

### Veredito Final

O código está conforme: spec e extensão Conversa cobertas, ADR-004 respeitado, módulo `agent/` isolado e sem dependências novas, padrões de styling e de renderização segura seguidos, suporte dual Bull/BullMQ testado, e jest, tsc, eslint e os dois builds verdes, sem artefato de teste no `dist`. O que bloqueia é documental: o changeset (que vira release note pública) omite a visão Conversa e `Query.agentConversation`, e a guideline do markdown limitado não reflete o uso em `input.text`. São dois ajustes de texto; depois deles o Tech Lead aprova sem novo ciclo de QA, e o fluxo segue para o Ops.

## Re-review (2026-10-15)

**Veredito:** ✅ APPROVED

- ✅ Must fix 1: `.changeset/agent-runs-view.md` cita a Conversa, a nota de collector/índice/id opaco e `Query.agentConversation`.
- ✅ Must fix 2: `memorys/guidelines.md` inclui `input.text` na regra do markdown limitado.
- ✅ Nice to have aplicados: Decisão 6 (Conversa) no ADR-004, `spec.md` sem o texto de "fica para depois", menção à Conversa no README.
- ⏭️ Nice to have que ficam como débito: alias `@/` em `active-screen.ts`, comentário em `switch.tsx`, dividir `conversation/index.tsx` (1151 linhas), duplicação de texto entre `ResponseCard` e `conversation-model`, comentário velho de `maybeIncomplete` nas typings da UI.
- Liberado para o Ops.
