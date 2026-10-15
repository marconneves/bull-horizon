# QA 004: Agentes IA (UI, T006 a T009)

**Data:** 2026-10-15
**Escopo:** `packages/ui` (não commitado): store `agents`, tela Agents (Metrics, Runs, Run com Graph e Waterfall), ação "Agent run" no job, linha colapsada no modal de Logs, demo mocks, `SafeMarkdown`.
**Referências:** `spec.md` (DoD, regras 5, 7 e 8), `architecture.md` § 7 (com os desvios aceitos: run view consulta `job { data, agentRuns }`; demo reconstrói o run de job removido a partir da entrada do índice), `memorys/business.md` (regra de navegação), `memorys/guidelines.md`, `design/06 Agentes IA.dc.html`, `docs/agent-runs.md`.

## Veredito: **Reprovado**

Um achado Major (comportamento sem collector diverge da regra 5 da spec e do doc publicado). O resto é Minor. A correção do Major é pequena e localizada; depois dela a UI pode seguir para o Security e o review do Tech Lead.

## Achados

### M1 [Major] Sem collector, as abas Metrics e Runs continuam visíveis

- **Onde:** `packages/ui/src/screens/agents/index.tsx:184` (o `<Tabs>` é renderizado sempre; só o conteúdo em `:195` troca pelo aviso).
- **Esperado:** `spec.md` regra 5 ("Com o collector desligado, a aba Métricas não aparece"), `architecture.md` § 7.1 ("as duas abas dão lugar ao aviso") e `docs/agent-runs.md` ("Without it, those tabs are not shown").
- **Obtido:** as abas Metrics e Runs aparecem e são clicáveis, mas qualquer uma mostra o mesmo aviso. O doc publicado descreve um comportamento que a UI não tem.
- **Repro:** modo demo com `getMetricsEnabledMock` devolvendo `metricsEnabled: false` (simulado via interceptação do módulo no navegador, sem tocar no repo), abrir Agents. Evidência: `screens/qa-no-collector-tabs.png`.
- **Sugestão:** renderizar o `<Tabs>` só quando `collector` for verdadeiro (o seletor de janela já faz isso).

### m1 [Minor] Aviso "collector não está rodando" aparece enquanto `metricsEnabled` carrega

- **Onde:** `packages/ui/src/screens/agents/index.tsx:122` (`metricsEnabledData?.metricsEnabled ?? false`).
- **Efeito:** com rede real, durante o carregamento a tela mostra o aviso de collector desligado por um instante, mesmo com collector ligado. Tratar `undefined` como "carregando" (nada ou spinner) em vez de "desligado".

### m2 [Minor] Voltar para Agents pela sidebar reabre o último run, não Metrics/Runs

- **Onde:** `packages/ui/src/stores/agents.ts:63` (`run` e `view: 'run'` só são limpos por `closeRun`), `packages/ui/src/shell/Drawer/Queues/index.tsx:50` e `packages/ui/src/shell/Drawer/ScreenNav.tsx:92` (trocam de tela sem limpar o run).
- **Repro:** Jobs > brand-app:ai > Agent run em `0c2b77a1` > escolher `queue:5` na sidebar (vai para Jobs, correto) > clicar **Agents**. Abre de novo o run de `0c2b77a1`, com o botão de voltar "Jobs". Para chegar a Metrics/Runs são mais dois cliques (voltar e Agents de novo). Evidência: `screens/qa-agents-reentry-stale-run.png`.
- **Sugestão:** limpar `run` (e voltar `view` para a aba anterior) quando a tela muda para outra que não `agents`, ou quando a entrada Agents da sidebar é clicada.

### m3 [Minor] Voltar de um run para Runs perde filtro, ordenação e "Show more"

- **Onde:** `packages/ui/src/screens/agents/RunsTab.tsx:234-235` (`filter` e `sort` em `useState` local; o componente desmonta ao abrir o run).
- **Repro:** Runs > Failed > slowest > abrir uma linha > voltar. A aba volta em All / recent. Evidência: `screens/qa-runs-after-back-filter-reset.png`.
- **Sugestão:** guardar `filter` e `sort` no store `agents` (sem persistir, se preferir).

### m4 [Minor] KPI de falhas sem plural correto

- **Onde:** `packages/ui/src/screens/agents/MetricsTab.tsx:205` (`${fmtInt(summary.failed)} runs`).
- **Repro:** Metrics, janela 60m no demo: "1 runs · 2 lost". Usar o helper `plural` que já existe em `format.ts`.

### m5 [Minor] Modal de Logs colapsa a linha com prefixo mesmo fora de fila/job de agente

- **Onde:** `packages/ui/src/screens/jobs/LogsModal/index.tsx:186` (só testa o prefixo).
- **Efeito:** num job de fila não declarada como agente (ou com nome fora de `ai.jobs`), uma linha `bull-horizon:agent-run ` vira "agent run" com **Open run**, que leva a "No agent run recorded for this job yet", porque o servidor não lê runs fora do escopo declarado (doc: "Only read for queues and job names declared as agent"). Sugestão: só colapsar quando `queue.agent` existir e o nome do job casar com `jobs`, a mesma regra da ação "Agent run".

### m6 [Minor] Abrir um run a partir da lista rolada mantém a rolagem

- **Repro:** Runs > costliest > "Show more" até o fim > abrir uma linha do fim. A tela de run abre já rolada, com o cabeçalho (voltar, tentativa, Graph/Waterfall) fora da vista. Evidência: `screens/qa-run-no-price-dark.png`. Sugestão: rolar para o topo ao entrar no run.

### m7 [Minor, só demo] Totais do demo não batem entre Metrics e Runs

- **Onde:** `packages/ui/src/demo-mocks/network/queries/get-agents-summary.ts` e `packages/ui/src/demo-mocks/network/agents/runs.ts` geram séries independentes.
- **Efeito:** na janela 24h, Metrics mostra ~1.160 runs e a aba Runs mostra "All ~570"; o `lost` também varia sem monotonia entre janelas (4 em 24h, 1 em 7d). Não afeta produção (lá ambos vêm do collector), mas o demo é vitrine. Opcional.

## O que foi verificado e está OK

**Checagens estáticas e build**
- `npx tsc --noEmit` em `packages/ui`: exit 0.
- `npx eslint packages/ui --ext .ts,.tsx`: exit 0, sem avisos.
- `npx jest` (repo inteiro): 8 suítes, 139 testes verdes, incluindo `screens/agents/__tests__/model.test.ts` e `components/SafeMarkdown/__tests__/parse.test.ts`.
- `npm run build` em `packages/ui`: ok.
- Grep nos arquivos novos/alterados da UI (`screens/agents`, `components/SafeMarkdown`, `services/agent-run-log.ts`, `stores/agents.ts`, `LogsModal`, `Actions.tsx`): nenhuma cor hex, `rgb()` ou `hsl()`; cores vêm de `theme.palette` e da paleta de status (`screens/agents/colors.ts`). Nenhum `dangerouslySetInnerHTML`/`innerHTML`; nenhuma lib de markdown.
- `SafeMarkdown` usado só em texto de passo, `final.text` e `input.text` (`NodeDetails.tsx:425`, `ResponseCard.tsx:88` e `:104`); monta só elementos React. Negrito renderizado no demo ("às **7h**").

**Fluxos no modo demo (`npm run dev-with-mocks`, playwright-core + Chrome, tema escuro e claro, 1440 e 1024 px), sem erro de console nem pageerror**
- Sidebar: **Agents** aparece com a fila `brand-app:ai`; `ScreensSwitch` cai em Jobs se a tela persistida for `agents` e nenhuma fila for de agente (código revisado).
- Metrics: troca de janela 60m, 6h, 24h, 7d, 30d, 90d atualiza KPIs, latência e comparativo "vs previous window" ("no data in the previous window" em 90d); janela persiste em `localStorage` (`view`, `runLayout`, `range`).
- Runs: contagens dos chips batem com as linhas (Failed 7 = 7 linhas, todas "failed"; Empty tool 120 = 120 após "Show more"; Over 15s 66 = 66, todas com duração de pelo menos 15 s). Ordenação recent, slowest (41,2 s no topo) e costliest (16 runs sem preço no fim, nenhuma com `$0`). Clique na linha abre o run; voltar retorna à aba Runs.
- Jobs: ação **Agent run** em todos os 10 jobs `reply` e ausente no `cleanup-1`; voltar retorna a Jobs na mesma fila e status.
- Seletor de tentativa em `0c2b77a1`: abre na tentativa 2 (stop); tentativa 1 mostra outcome error e o erro 503; tentativa com erro destacada em vermelho.
- Graph: clique em REQUEST, LLM · STEP 1 e RESPONSE troca o painel (payload, tool-calls, error). Run longo (`e7d40c66`, 6 passos) rola na horizontal dentro do card, sem estourar a página.
- Waterfall: linhas expandem e recolhem (`aria-expanded` alterna), linha selecionada abre por padrão.
- Run `basic` (`5f3ac219`): chip "basic detail", alerta de nível, "Not recorded at basic detail." no texto do passo e na conversa.
- Run sem preço (`gemma-local`): KPI "no price", barra de custo trocada por "no price for gemma-local in the setup".
- Modal de Logs: cada linha de run vira "agent run (attempt N) · N chars" com **Raw** / **Hide raw** e **Open run**; Open run fecha o modal e abre o run na tentativa da linha.
- Navegação (`memorys/business.md`): escolher fila na sidebar a partir de Agents (lista ou run) vai para Jobs daquela fila.
- Sem collector (simulado): entrada Metrics history some, Agents continua; aviso aparece no lugar do conteúdo; run por job continua abrindo (só falta esconder as abas, ver M1).
- 1024 px: KPIs quebram em duas linhas, gráficos e painel se reorganizam; a lista de Runs tem largura mínima e rola na horizontal dentro do próprio card (sem rolagem da página).

**Doc publicado (`docs/agent-runs.md`)**: linha colapsada no modal de Logs, subset de Markdown seguro (links, imagens e HTML literais) e regra de custo "no price, never `$0`" conferem com a UI. Diverge só no ponto M1.

## Evidências novas (`screens/`)

| Arquivo | O que mostra |
|---|---|
| `qa-no-collector-tabs.png` | M1: abas visíveis sem collector |
| `qa-agents-reentry-stale-run.png` | m2: Agents reabre o run antigo |
| `qa-runs-after-back-filter-reset.png` | m3: filtro e ordenação perdidos ao voltar |
| `qa-run-no-price-dark.png` | run sem preço e m6 (rolagem mantida) |
| `qa-run-basic-graph-dark.png` | run `basic` com "Not recorded at basic detail." |
| `qa-logs-modal-raw-dark.png` | modal de Logs com linha colapsada e Raw aberto |
| `qa-run-graph-long-light.png` | grafo longo no tema claro |
| `qa-runs-1024-dark.png` | lista de Runs a 1024 px |

## Próximo passo

Devolver ao Developer para corrigir M1 (obrigatório) e, de preferência, m1 a m6 no mesmo ciclo. T012 fica aberta até a revalidação.

## Correções (Developer, 2026-10-15)

| Achado | Correção | Onde |
|---|---|---|
| **M1** | Sem collector, as abas Metrics/Runs, o seletor de fila e o de janela não são renderizados. A tela Agents mostra só o cabeçalho e o aviso (collector necessário; runs abrem pela ação **Agent run** em Jobs). O run view continua abrindo a partir de Jobs. Bate com `docs/agent-runs.md` ("those tabs are not shown"). | `screens/agents/index.tsx` |
| **m1** | `metricsEnabled` ainda sem resposta = spinner (`Spin`), nem abas nem aviso. Erro na query conta como "desligado", para não girar para sempre. | `screens/agents/index.tsx` |
| **m2** | Store sem `view`: `run` aberto = tela de run, senão a última aba (`tab`, persistida). Uma assinatura no `active-screen` limpa o run quando a tela muda para outra que não `agents`; o item **Agents** da sidebar também chama `leaveRun()`. Migração v0 → v1 do estado persistido (`view` → `tab`). | `stores/agents.ts`, `shell/Drawer/ScreenNav.tsx` |
| **m3** | Filtro, ordenação e página do Runs foram para o store (`runsFilter`, `runsSort`, `runsLimit`, sem persistir). A página volta a 50 ao trocar filtro, ordenação ou fila. Voltar de um run aberto pela lista cai na aba Runs. | `stores/agents.ts`, `screens/agents/RunsTab.tsx` |
| **m4** | `plural()` no KPI de falhas, no tooltip do histograma de passos, no tooltip por modelo e no rodapé "N of M runs". | `MetricsTab.tsx`, `RunsTab.tsx` |
| **m5** | `shouldCollapseAgentRunLine(line, agent, jobName)`: só colapsa com prefixo **e** `isAgentJob` (mesma regra da ação Agent run, agora num helper compartilhado). O store de Logs recebe o nome do job. Fora disso, a linha aparece crua. | `services/agent-run-log.ts`, `stores/job-logs.ts`, `LogsModal/index.tsx`, `Job/Actions.tsx` |
| **m6** | `window.scrollTo(0, 0)` ao abrir um run (por fila + job). | `screens/agents/run/index.tsx` |
| **m7** | O mock de `agentsSummary` conta por minuto. Onde o índice de runs alcança, a contagem vem dele (runs, failed, empty tool); fora disso é sintética, com a mesma densidade. As camadas de 1 min, 1 h e 12 h somam esses minutos, então `lost` e os totais só crescem com a janela. | `demo-mocks/network/queries/get-agents-summary.ts` |

**Testes novos:** `stores/__tests__/agents.test.ts` (migração v0, ida e volta pelo Jobs, m2, m3, reset da página), `services/__tests__/agent-run-log.test.ts` (`isAgentJob`, regra de colapso m5) e `screens/agents/__tests__/format.test.ts` (`plural`). Os stores `agents` e `active-screen` passaram a usar imports relativos para rodar no jest da raiz.

**Verificação:** `tsc --noEmit` (ui) ok; `eslint packages/ui` ok; `npx jest packages/ui` com 5 suítes e 47 testes verdes; `npm run build` (ui) ok. Modo demo com playwright-core e Chrome, sem erro de console nem pageerror. Para simular "sem collector" e "carregando", o módulo `get-metrics-enabled` foi interceptado por rota no navegador, sem nenhuma alteração no repo.
- M1: 0 abas, aviso visível, Metrics history fora da sidebar. O run abre por Jobs, e voltar e entrar em Agents mostra o aviso de novo.
- m1: spinner presente e aviso ausente durante 4 s de atraso; depois disso as 2 abas aparecem.
- m2: Jobs > Agent run > queue:5 > Agents cai nas abas, sem botão "Jobs".
- m3: Failed + slowest, abrir run e voltar mantém os dois. "200 of 570 runs" se mantém depois de abrir um run.
- m6: `scrollY` de 9602 para 0.
- m5: job `reply` mostra a linha colapsada; no `cleanup-1` da mesma fila, uma linha com o prefixo aparece crua e sem **Open run**.
- m7: Metrics e Runs "All" batem nas mesmas janelas: 60m 25/25, 6h 142/143, 24h 569/569. Em 7d são 3.940 contra 2.000, porque o índice tem limite de 2.000 entradas, como no servidor. Na janela de 24h, falhas "7 runs" = chip Failed 7, e empty tool 21% ≈ 120/570.

**Screenshots novos/atualizados (`screens/`):** `agents-metrics-{dark,light}.png` (totais do m7), `agents-no-collector-dark.png`, `agents-no-collector-run-dark.png`, `agents-loading-light.png`, `agents-reentry-tabs-dark.png`, `agents-runs-failed-slowest-dark.png`, `agents-runs-after-back-dark.png`, `agents-run-from-scrolled-list-dark.png`, `agents-metrics-60m-dark.png`, `jobs-logs-modal-non-agent-dark.png`. As evidências `qa-*.png` foram mantidas como registro dos achados.

Pronto para revalidação do QA.

## Re-teste (QA, 2026-10-15)

### Veredito: **Aprovado**

M1 e m1 a m7 corrigidos e confirmados. Sem regressão nos fluxos aprovados antes. Nenhum achado novo.

**Checagens:** `tsc --noEmit` (ui) exit 0; `eslint packages/ui` exit 0; `npx jest packages/ui` 5 suítes, 47 testes verdes; `npm run build` (ui) ok. Checagens do `packages/root` não rodadas de propósito (outro dev editando o backend da Conversa em paralelo).

**Demo (playwright-core + Chrome, sem erro de console nem pageerror):**

| Achado | Resultado |
|---|---|
| M1 | Sem collector (rota interceptada): 0 abas, sem seletor de janela, aviso visível, Metrics history fora da sidebar; run continua abrindo por Jobs. `screens/qa-retest-no-collector.png` |
| m1 | `metricsEnabled` atrasado 5 s: spinner, sem abas e sem aviso; depois, 2 abas e nenhum aviso. |
| m2 | Jobs > Agent run > `queue:5` > Agents abre as abas (última aba, Runs), não o run antigo. Clicar Agents de dentro de um run também volta às abas. |
| m3 | Empty tool + slowest + Show more ("100 of 120 runs"): abrir um run e voltar mantém os três. Failed + slowest também se mantém. |
| m4 | "1 run", "2 runs" corretos no KPI de falhas e no rodapé. |
| m5 | Job `reply`: 2 linhas colapsadas com Open run. `cleanup-1` (mesma fila, fora de `ai.jobs`) com linha de prefixo adicionada pelo modal: linha crua, 0 Open run. `screens/qa-retest-logs-non-agent.png` |
| m6 | `scrollY` 4527 antes de abrir, 0 depois. |
| m7 | Metrics x Runs "All": 60m 25/25, 6h 143/143, 24h 568/568; falhas = chip Failed (2, 4, 7). Em 7d 3.948 x 2.000 por causa do teto de 2.000 do índice, igual ao servidor (esperado). `lost` cresce com a janela (1, 2, 6, 26). |

**Regressão:** filtros (Failed 7 = 7 linhas, Over 15s 66 = 66, Empty tool 120 = 120), ordenações, ação Agent run só em `reply` (10) e não em `cleanup`, seletor de tentativa (1, 2), clique em nó do grafo, expandir/recolher no Waterfall, "Not recorded at basic detail" no run `basic`, voltar para Jobs, tema claro, 1024 e 1280 px sem rolagem horizontal da página.

T012 marcada como concluída. Próximo passo: Security (T013) e review do Tech Lead.

## Conversa (QA, 2026-10-15, T015 a T018)

### Veredito: **Aprovado** (com 1 Minor, não bloqueante)

**Checagens (repo inteiro, sem edição concorrente):** `npx jest` na raiz: 14 suítes, 247 testes verdes (inclui `agent-conversation.test.ts` e `conversation-model.test.ts`); `tsc --noEmit` em `packages/root` e `packages/ui`: exit 0; `eslint packages/ui packages/root/src --ext .ts,.tsx`: exit 0; `npm run build` (ui): ok. Grep em `screens/agents/conversation`, `conversation-model.ts` e no mock da conversa: sem cor hex/`rgb()` e sem `dangerouslySetInnerHTML`; texto do usuário e resposta via `SafeMarkdown`.

**Demo (playwright-core + Chrome, escuro e claro, 1440 e 1024 px, sem erro de console nem pageerror):**
- Entrada: run `fa1809e7` (aberto pela aba Runs) > **View whole conversation** abre `c-7f21` com 4 mensagens, em ordem (mais antiga primeiro), KPIs (mensagens, duração 6m03s, tempo de IA, tokens in/out, custo, passos e tool calls), "Messages over time", "Tools used" e a mensagem de origem destacada. Sem collector (rota interceptada) o botão não aparece e o run continua abrindo.
- Chat e List: alternância funciona; List seleciona mensagens 1, 2 e 4 e troca o painel de passos; Open run em cada mensagem.
- Mensagem 1 (`5f3ac219`, `basic`): "Not recorded at basic detail." no lugar da fala do usuário e da resposta, com meta e cadeia de tools normais.
- Mensagem 2 (`0c2b77a1`, job com retry): mostra a última tentativa; Open run abre o run com seletor de tentativa (1, 2) na 2.
- Abrir o run de uma mensagem e voltar (botão "Conversation") retorna à conversa com o layout mantido; voltar ("Run") retorna ao run de origem `fa1809e7`, e dali "Runs" volta à aba Runs.
- `c-9d8ef4`: aviso "Older messages may be missing..." presente; mensagem de job removido com chip/texto "Job removed: only the runs index entry is left" e sem Open run (Chat e List). `c-7f21` não mostra o aviso.
- Persistência: `conversationLayout` gravado em `localStorage` e mantido após reload.
- 1024 px: KPIs em duas linhas, painel lateral desce para baixo da conversa, sem rolagem horizontal da página.
- `docs/agent-runs.md` (seção "Conversation view") confere com a UI: link só com `conversationId` e collector, `basic` sem textos, heurística de incompleta, teto de 100.

**Regressão das abas Agents:** M1, m1 a m7 seguem corrigidos (sem collector, carregando, reentrada pela sidebar, filtro/ordenação/página após ida e volta, plural, colapso no Logs só em job de agente, scroll ao topo, totais do demo); filtros e contagens, ordenações, Agent run só em `reply`, seletor de tentativa, grafo, Waterfall, run `basic` e voltar para Jobs ok.

### Achado

**c1 [Minor] "View whole conversation" a partir do run de uma mensagem quebra a trilha de volta**
- **Onde:** `packages/ui/src/stores/agents.ts:148` (`openConversation` guarda como origem o run da mensagem, cujo `backTo` é `'conversation'`), `:157` (`closeConversation` limpa a conversa) e `:133` (`closeRun` com `backTo === 'conversation'` só zera o run).
- **Repro:** Runs > `fa1809e7` > View whole conversation > List > mensagem 2 > Open run > **View whole conversation** de novo > voltar ("Run") cai no run de `0c2b77a1` > voltar ("Conversation") cai nas abas Metrics/Runs, não na conversa; o run de origem `fa1809e7` se perde. Evidência: `screens/qa-conv-nested-back.png`.
- **Sugestão:** se o run aberto já veio da mesma conversa (`backTo === 'conversation'` e mesmo `conversationId`), "View whole conversation" só fecha o run (`closeRun`) em vez de empilhar uma nova conversa; ou esconder o botão nesse caso.

**Evidências novas (`screens/`):** `qa-conv-chat-dark.png`, `qa-conv-list-light.png`, `qa-conv-list-1024-dark.png`, `qa-conv-incomplete-removed-dark.png`, `qa-conv-nested-back.png`.
