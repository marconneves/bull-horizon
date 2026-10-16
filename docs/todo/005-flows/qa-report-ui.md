# QA 005: Flows e traces (UI, T010 a T015)

**Data:** 2026-10-16
**Escopo:** `packages/ui` (não commitado): rota e tela `flows`, sidebar (entrada Flows e selo FLOW no grupo), store `flows`, abas Flow (A grafo, B tabela), Trace (A grafo com caminho, B timeline) e Config, navegação para Jobs, demo `content-ingest`.
**Referências:** `spec.md` (com "Decisões do Completeness Gate"), `architecture.md` § 1, § 5, § 6, § 7 e § 7.1, `tasks.md`, `design/05 Flows.dc.html`, `screens/`.
**Escolhas declaradas pelo Developer (conferidas):** Flows não é exceção de escopo da sidebar (escolher fila leva para Jobs); sem collector só a aba Config e o aviso, sem busca; bloco `_trace` com os campos do contrato v1 real; chip de flow só com mais de um flow; `+` removido.

## Veredito: **Aprovado** (4 achados Minor, nenhum bloqueante)

## Achados

### m1 [Minor] Rótulo de aresta entre nós da mesma camada fica escondido sob o nó

- **Onde:** `packages/ui/src/screens/flows/model.ts:293` (rótulo no meio do vão entre os nós da mesma camada) e `FlowGraph.tsx:41` (`edgeLabel` com `nowrap`; o nó é desenhado por cima).
- **Repro:** aba Flow, opção A. A aresta `VerifyIfVideoExists` para o `end` "only refreshes stats" mostra "eady known" em vez de "already known": o vão entre as colunas é menor que o texto. Evidência: `screens/qa-flow-a-edge-label-overlap.png`.
- **Sugestão:** alargar o vão quando houver rótulo, ou posicionar o rótulo acima da aresta com o nó de destino deslocado.

### m2 [Minor] Bloco "data._trace" é reconstruído do índice, não lido do job

- **Onde:** `packages/ui/src/screens/flows/model.ts:461` (`traceContract`), usado em `TracePath.tsx:187` e `TraceGantt.tsx:327`.
- **Efeito:** o bloco tem o formato do contrato v1, mas os valores são montados a partir do trace: `parent.queue` recebe o **id da etapa** (`parentStepId`), não o nome da fila; `parent.name` e `parent.attempt` nunca aparecem; `hop` é recontado pelo caminho e sai menor se um ancestral faltar no índice (trace `truncated`). No demo os ids de etapa são os nomes das filas, então não aparece. `architecture.md` § 1.1 diz que o painel do trace mostra o `_trace` real.
- **Sugestão:** quando o job ainda existe, ler `data._trace` do `Query.job` (a linha expandida do gantt já faz essa chamada); quando o job foi removido, manter a reconstrução com um rótulo do tipo "rebuilt from the trace index".

### m3 [Minor, demo] O demo não tem trace com falha sem saída e etapa pendente (G5)

- **Onde:** `packages/ui/src/demo-mocks/network/flows/content-ingest.ts:588` (`TRACES`): o status de cada trace é fixo na especificação do mock, não derivado como no servidor.
- **Efeito:** a ordem corrigida no backend (RUNNING enquanto houver pendente, depois FAILED por falha sem saída, depois COMPLETED) não é exercitada no demo. Os quatro traces são: completed via fallback, completed, running (sem falha) e failed (sem pendente). A UI só exibe o status que vem do servidor, e o backend cobre o caso em `flows-resolvers.test.ts`, então não há risco de UI; fica a sugestão de um quinto trace (falha num ramo e outro ramo ainda em `waiting`) para a vitrine.

### m4 [Minor] "View queue jobs" herda o último status escolhido em Jobs

- **Onde:** `packages/ui/src/screens/flows/use-open-jobs.ts:32` (`changeStatus` só quando `opts.status` vem).
- **Repro:** clicar um erro recente (abre Jobs em Failed), voltar a Flows e clicar **View queue jobs**: Jobs abre de novo em Failed. É o comportamento herdado da tela Jobs, mas um link "jobs da fila" sem status costuma ser lido como "a fila", não "as falhas". Sugestão: passar um status neutro (Waiting, ou o padrão da tela) ou deixar explícito no rótulo.

## O que foi verificado e está OK

**Checagens (repo inteiro):** `npx jest` na raiz: 23 suítes, 421 testes verdes. `tsc --noEmit` em `packages/root` e `packages/ui`: exit 0. `eslint packages/ui packages/root/src --ext .ts,.tsx`: exit 0. `npm run build` (ui): ok. Grep em `screens/flows`, `stores/flows.ts` e `demo-mocks/network/flows`: sem cor hex, `rgb()`/`hsl()`, `dangerouslySetInnerHTML` ou `innerHTML`; `failedReason`, ids e `returnvalue` aparecem como texto puro.

**Demo em porta própria (:8091, playwright-core + Chrome; :8080 do usuário intocada), escuro e claro, 1440 e 1024 px, sem erro de console nem pageerror:**
- Sidebar: entrada **Flows** entre Overview e Metrics history; grupo `Content` com ícone `account_tree`, fundo destacado e selo `FLOW · content-ingest`. Escolher uma fila a partir de Flows leva para Jobs.
- Cabeçalho: "Content ingest · content-ingest · 16 queues · monitor setup · read only"; sem chip de flow (só um flow) e sem `+`.
- Flow A: 16 nós; clique em `TranscriptionApi` e `SaveErrorState` troca o painel (métricas, sparkline, erros recentes, próximas etapas, VIEW QUEUE JOBS); gargalo marcado; ON ERROR tracejado. KPIs mudam com a janela (60m 768 entradas, 24h ~18,5 mil, 7d ~129 mil).
- Flow B: tabela indentada com BOTTLENECK; linha expande e recolhe (sparkline e erros recentes); FAILED abre Jobs da fila no status Failed.
- Busca: por trace id com Enter (`tr_9f2c41e7b0`), por job id com o botão TRACE (`88211`) e por videoId (`7428801239912`) com a escolha entre 2 execuções, a mais recente primeiro; trocar para a mais antiga recarrega a faixa. Running (`... so far`), failed e sem resultado ("No trace matches ... the index keeps only the most recent traces") com mensagem clara. CLEAR TRACE volta para Flow e limpa a busca; aba Trace vazia mostra a orientação de busca.
- Trace A: caminho aceso no grafo com horário, duração e espera nas arestas; painel "Caminho do evento" com 16 passos; clicar num passo ou num nó troca o job escolhido e o bloco `_trace` (ver m2) e oferece OPEN JOB.
- Trace B: timeline com espera hachurada e processamento, cores por resultado; linha expandida traz `data._trace`, timing e `returnvalue` (job ok), o motivo da falha (job falho) ou "Job removed from Redis (retention): only the trace index entry is left" sem Open job (execução de 2 dias atrás).
- Open job abre Jobs na fila da etapa com o Job ID preenchido.
- Config: YAML com numeração; copiar põe no clipboard só o YAML, sem números de linha; convenção `_trace` com o exemplo `withTrace`; checks (filas registradas, prefixo fora do padrão em `contentSaveTranscription`, cobertura de `_trace` 98,7%, jobs `lost`).
- Sem collector (módulo do mock interceptado por rota, sem alterar o repo): só a aba Config, sem busca, aviso "Flow and Trace need the metrics collector", Metrics history fora da sidebar.
- 1024 px: KPIs quebram em duas linhas, a busca desce para baixo das abas; tabela e grafo rolam na horizontal dentro do próprio card, sem rolagem da página.

## Evidências novas (`screens/`)

| Arquivo | O que mostra |
|---|---|
| `qa-flow-a-edge-label-overlap.png` | m1: "already known" cortado |
| `qa-trace-candidates-dark.png` | busca por videoId com 2 execuções |
| `qa-trace-a-light.png` | caminho aceso e bloco `_trace` no tema claro |
| `qa-trace-b-removed-dark.png` | linha de job removido, sem Open job |
| `qa-trace-b-failed-1024-dark.png` | timeline a 1024 px com o passo falho aberto |
| `qa-trace-no-match-dark.png` | busca sem resultado |
| `qa-flow-b-1024-light.png` | tabela a 1024 px com linha expandida |
| `qa-no-collector-config.png` | sem collector: só Config e aviso |

## Próximo passo

Liberar para o Security (T017) e o review do Tech Lead. m1 a m4 podem entrar no mesmo ciclo ou como dívida registrada; m2 merece decisão do Architect (ler o `_trace` real quando o job existe).

## Correções (Developer, 2026-10-16)

| Achado | Correção | Onde |
|---|---|---|
| **m1** | Rótulos de aresta posicionados por `placeEdgeLabels` (puro): largura estimada do texto mono, e se a caixa cai sobre um nó (ou sobre outro rótulo) o rótulo vai para o vão acima da linha, depois abaixo, depois para os lados. "already known" agora fica inteiro acima da linha do nó. | `screens/flows/model.ts`, `FlowGraph.tsx` |
| **m2** (decisão do Architect) | O bloco `data._trace` lê o `_trace` real do job (`Query.job { data }`, parse defensivo: só propriedade própria e objeto). Só cai na reconstrução pelo índice quando o job foi removido, com o rótulo "reconstructed from the trace index (job removed)"; job sem `_trace` legível diz "(no _trace in the job data)". Seleção em `traceBlock`/`readJobTrace` (puros), componente `TraceBlock` usado no painel A e na linha do gantt B. | `model.ts`, `TraceBlock.tsx`, `TracePath.tsx`, `TraceGantt.tsx` |
| **m4** | "View queue jobs" abre Jobs no status padrão da tela (Active); FAILED, erros recentes e "Open job" continuam passando o status explicitamente. | `use-open-jobs.ts` |
| m3 | Não tratado neste ciclo (sugestão de vitrine do demo). | |

**Testes novos:** `screens/flows/__tests__/labels-trace-block.test.ts` (nenhum rótulo sobre nó ou rótulo, rótulo do ramo `end` acima da linha, rótulo que cabe fica no lugar; `traceBlock` com job, job removido, job sem `_trace`, carregando; `readJobTrace` defensivo).

**Verificação:** `tsc --noEmit` (ui) ok, `eslint packages/ui` ok, `npx jest packages/ui` 101 testes verdes, `npm run build` (ui) ok. Playwright no :8091 (sem tocar no :8080): 6 rótulos de aresta, nenhum sobre nó; erro recente abre Failed e "View queue jobs" depois abre Active; o job com falha do trace `tr_9f2c41e7b0` mostra o `_trace` real e o `VerifyIfVideoExists` (removido) mostra a reconstrução com o rótulo; walk completo dos 5 quadros nos dois temas (32 checagens) sem erro de página. Screenshots `flows-*-{dark,light}.png` atualizados.
