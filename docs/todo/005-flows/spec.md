# Spec 005: Flows e traces

**Status:** 📋 Spec refinada pelo PO, **bloqueada no Completeness Gate** (perguntas abertas no fim)
**Data:** 2026-10-16
**Design de referência:** `design/05 Flows.dc.html` (módulo 05 "Flows e traces", 5 telas, opções A e B)
**Consumidor piloto:** Vyral, `apps/jobs-processor` (inventário e divergências em `vyral-flows.md`)
**Base:** `@bull-horizon/*` 6.5.0-beta.1 (visão Agentes IA da task 004 já entregue)

## Por quê

Segunda etapa do projeto: depois de abrir a caixa-preta de um job de agente (004), abrir a caixa-preta **entre** jobs. Hoje o painel mostra filas soltas. Um item de negócio (um vídeo do TikTok na Vyral) atravessa 10 a 16 filas: uma fila enfileira a próxima, às vezes em leque, às vezes com fallback, às vezes com fila de erro. Quando um vídeo "some" ou demora, o operador precisa abrir fila por fila e adivinhar o job pelo payload. Não existe:

1. a árvore do flow como o código a executa (quem enfileira quem, em que condição);
2. onde o flow engasga (espera na fila por etapa, p50/p95, taxa de falha);
3. o caminho de **um** evento pelo flow, achado por um id único que viaja de job em job (trace id), com horários, esperas, falhas e o job de cada etapa.

O desenho resume em uma frase: "Árvore do flow lida do código, gargalo e falhas por etapa, e caminho de um evento pelo trace id".

## Telas do design (o que existe no arquivo)

O design tem 3 abas numa tela **Flows** nova (ícone `account_tree` na sidebar, entre Overview e Agents), com 5 quadros:

| Quadro | Aba | Opção | Conteúdo |
|---|---|---|---|
| 1a | Flow | A | KPIs + árvore em **grafo** (nós por etapa com waiting/active/failed e throughput/min, arestas com "avg espera", condições `novo`/`já existe`, fallback tracejado, nó ON ERROR, tag GARGALO) + painel lateral da etapa |
| 1b | Flow | B | KPIs + árvore em **tabela indentada** (ETAPA, WAITING, ACTIVE, FAILED, THROUGHPUT/MIN, P50·P95, ESPERA NA FILA, FALHA %) com linha expansível |
| 2a | Trace | A | faixa do trace + **grafo com o caminho destacado** (resto apagado, horário e duração em cada nó, espera na aresta) + painel "Caminho do evento" (timeline clicável e `data._trace` do job escolhido) |
| 2b | Trace | B | faixa do trace + **timeline (gantt)**: por etapa, espera na fila (hachurado) e processamento (barra), cor por resultado (ok, falhou, fallback), linha expansível |
| 3a | Config | A (única) | definição do flow, **read only**, + convenção de trace (`data._trace`, helper `withTrace`) + "Validação da config" |

Elementos comuns a todos os quadros:

- **Sidebar**: o grupo de filas do flow ganha o selo `FLOW · <id>` e ícone `account_tree`; filas listadas dentro do grupo com a barra de status.
- **Barra de flows**: chip do flow selecionado (`content-ingest`). O `+` do design não tem função num painel read only (ver P8).
- **Cabeçalho do flow**: label ("Ingestão de conteúdo"), id, "N queues · <origem da definição> · read only", abas Flow/Trace/Config e a **busca** "Trace id, job id ou videoId" com botão TRACE (Enter também dispara).

### Dados que cada tela consome

**KPIs (aba Flow, A e B), janela 24h:**

| KPI | Exemplo do design | Origem |
|---|---|---|
| Entradas 24h | 18,426 · `VerifyIfVideoExist` | jobs terminados da etapa de entrada |
| Concluídos fim a fim | 9,020 · "49% eram vídeos novos" | etapas de conclusão terminadas; % = concluídos / entradas |
| Tempo médio fim a fim | 11m02s · p95 24m18s | `fim da etapa de conclusão - início do trace` |
| Gargalo | `TranscriptionApi` · 412 waiting · espera 9m40s | etapa com maior espera média na janela (com waiting atual) |
| Falhas 24h | 347 · `SaveErrorState` · 1.9% | falhas definitivas das etapas + passagens pela etapa de erro |

**Por etapa (nó do grafo A, linha da tabela B, painel da etapa):** nome (fila, sem o prefixo do flow), descrição, waiting, active, failed (contagens ao vivo), throughput/min, concluídos 24h, p50 e p95 de processamento, espera média na fila, taxa de falha, sparkline de throughput 24h (32 barras; cor de alerta no trecho recente quando é gargalo), erros recentes agrupados por mensagem com contagem e link para os jobs, próximas etapas, tags GARGALO / FALLBACK / ON ERROR, link "VER JOBS DA FILA".

**Arestas:** origem, destino, rótulo de condição (`novo`, `já existe`, `fallback`), tipo (normal, condicional tracejada, fallback tracejada roxa), "avg <espera do destino>" quando a espera média é ≥ 1 s, em destaque quando > 60 s. Nó terminal (`end`) sem estatística ("só atualiza números").

**Trace (A e B):** trace id, valor da chave de negócio (`VIDEOID 7428801239912`), início, duração total, nº de jobs, status derivado ("concluído via fallback"), maior espera (etapa e tempo). Por job do caminho: etapa, job id, horário em que entrou na fila, espera, início, processamento, resultado (ok, falhou, fallback, on error), tentativa, `parentJobId`, e ao expandir (B) `data._trace`, timing, `returnvalue` ou stacktrace, "Abrir job".

**Config:** texto da definição com numeração de linha e botão copiar; documento da convenção `data._trace` (`traceId`, `flow`, `step`, `parentJobId`, `attempt`, `enqueuedAt`) com o exemplo `await next.add(name, withTrace(job, { videoId }))`; checks de validação (filas declaradas existem no Redis; % de jobs com `_trace` nas últimas 24h; nome de fila fora do padrão do grupo; etapas "sidecar" sem `parentJobId`).

### Interações

- Clicar num nó (A) ou linha (B) seleciona/expande a etapa. Na aba Trace, clicar num nó ou passo da timeline mostra o `data._trace` daquele job.
- Busca: aceita **trace id**, **job id** ou **valor da chave de negócio** (videoId). Enter ou TRACE leva para a aba Trace com o caminho daquele evento. "CLEAR TRACE" volta para a aba Flow.
- Erros recentes, FAILED e "Abrir job"/"VER JOBS DA FILA" levam para a tela Jobs da fila (filtrada no status/job quando aplicável).
- Na sidebar, o grupo do flow expande/recolhe como hoje.

## User Stories

- **US001**: Como quem integra, declaro no setup do monitor os flows (etapas, quem segue quem, condições, fallback, etapa de erro, etapas de conclusão, chave de negócio), sem escrever UI. O painel só lê essa definição.
- **US002**: Como quem integra, uso um helper da lib, no worker, para enfileirar a próxima etapa carregando o trace do job pai (`withTrace`), e outro para abrir um trace na entrada do flow (HTTP, cron, evento).
- **US003**: Como operador, abro um flow e vejo a árvore com contadores ao vivo, throughput, p50/p95, espera e falhas por etapa, e o gargalo destacado (grafo A ou tabela B).
- **US004**: Como operador, vejo os KPIs do flow na janela (entradas, concluídos fim a fim, tempo fim a fim p50/p95, gargalo, falhas).
- **US005**: Como operador, busco por trace id, job id ou chave de negócio e vejo o caminho daquele evento: o grafo com o caminho aceso (A) ou a timeline com espera e processamento (B), e o job de cada etapa.
- **US006**: Como operador, quando a chave de negócio tem mais de uma execução (vídeo reprocessado), escolho qual trace abrir (mais recente primeiro).
- **US007**: Como quem integra, vejo na aba Config a definição lida do código e a validação: filas inexistentes, cobertura de `_trace`, arestas observadas que não estão declaradas e arestas declaradas nunca vistas.
- **US008**: Como quem integra, tenho o contrato `_trace` documentado (`docs/flows.md`) e a skill `bull-horizon` estendida para instrumentar flows.
- **US009**: Como dono da Vyral, os flows desenhados do jobs-processor são declarados, conferidos contra o código, instrumentados e aparecem no painel.

## Regras de Negócio

1. **O flow é declarado no código, o painel só lê.** Nada de editor de flow na UI. A definição vive no setup do monitor (mesmo lugar de `group` e `ai`).
2. **Uma etapa é uma fila**, opcionalmente restrita a nomes de job (`queue` + `jobs?`), como `ai.jobs`. Uma fila pode pertencer a mais de um flow.
3. **Trace = uma execução do flow.** O id nasce na entrada e é copiado de pai para filho. A chave de negócio (ex.: `videoId`) é outra coisa: é o que liga execuções diferentes do mesmo item e serve de atalho de busca (ver P3).
4. **O trace viaja no payload do job**, num campo reservado (`data._trace` por default), escrito uma vez ao enfileirar e nunca reescrito. Nenhuma chave Redis nova é escrita pelo worker.
5. **Helpers nunca derrubam o job**: mesma regra do helper de agente. Falha de observabilidade não vira falha nem retry.
6. **Agregados e índice de traces vêm do metrics collector** (eventos terminais, como throughput e agentes). Collector desligado: as abas Flow e Trace não aparecem, a aba Config continua (mesma regra de `history`/`agents`). Só conta com o monitor vivo, como o throughput; isso é dito no estado vazio.
7. **Retenção**: o collector lê o job no evento terminal. Fila de flow não pode usar `removeOnComplete/removeOnFail: true`; job removido antes da leitura conta como `lost` e a tela avisa (mesma regra das filas de agente).
8. **Busca é limitada e determinística**: trace id, job id ou valor exato da chave de negócio. Sem busca por texto livre nem expressão.
9. **Índice de traces é limitado** por flow (teto configurável). Trace mais velho que o teto não é encontrado pela busca; a tela diz isso em vez de mostrar resultado vazio mudo.
10. **Etapas ainda em andamento** (waiting/active/delayed) aparecem no trace como pendentes, por uma leitura limitada das filas do flow (ver P6).
11. **Divergência desenho x código é dado, não erro**: a validação aponta o que o código faz e a definição não declara (e vice-versa). Não bloqueia a tela.
12. Textos vindos de job (mensagem de erro, returnvalue, ids) são texto puro na UI. Nada vira HTML.
13. Visual segue o tema existente (dark "horizon" e light, paletas de accent); o design é referência de layout.

## Fora do escopo

- Editar flow pela UI, criar flow pelo `+` da barra de flows.
- Inferir o flow só a partir dos jobs, sem definição (a definição é obrigatória; o observado só valida).
- Disparar/reprocessar um trace inteiro pela UI (retry continua por job, como hoje).
- Métricas de flow no endpoint Prometheus (rótulos com nome de etapa e chave de negócio em rota sem auth; reabrir com Security se pedirem).
- Integração com OpenTelemetry/trace distribuído fora do Redis (o `traceId` pode ser o mesmo, mas exportar spans fica para depois).
- `FlowProducer` do BullMQ como mecanismo obrigatório. Pode ser usado como fonte complementar de aresta, não substitui `_trace`.
- Mudanças de negócio nos flows da Vyral (corrigir divergências é decisão do dono do app, listada em `vyral-flows.md`).

## Critérios de Aceite (DoD)

- [ ] Contrato `_trace` v1 documentado (campos, quem escreve, exemplo real da Vyral) e exportado como tipo TS.
- [ ] Definição de flow aceita na config do monitor (Bull e BullMQ), validada no boot com aviso (não exceção) para etapa sem fila, aresta para etapa inexistente e ciclo sem etapa de conclusão.
- [ ] Helpers `startTrace` e `withTrace` exportados, sem dependência, compatíveis com Bull 3/4 e BullMQ 1+ (incluindo processor sandboxed), cobertos por teste de "nunca lança".
- [ ] Collector agrega por etapa (concluídos, falhas, lost, espera, processamento p50/p95, arestas observadas) e fim a fim, e indexa traces com teto, sem chave órfã; `clear`/`clearAll` apagam tudo.
- [ ] Aba Flow com KPIs, grafo + painel (A) e tabela indentada (B), alimentadas por dados reais.
- [ ] Aba Trace com busca por trace id, job id e chave de negócio, grafo com caminho (A) e gantt (B), etapas pendentes incluídas.
- [ ] Aba Config com a definição em texto, convenção de trace e validação.
- [ ] Modo demo (`VITE_ENABLE_MOCKS`) com o flow `content-ingest` do design.
- [ ] Skill `bull-horizon` estendida com instrumentação de flows.
- [ ] Vyral: flows declarados no setup do monitor, produtores instrumentados com `startTrace`/`withTrace`/`continueTrace`, monitor migrado de `@bull-monitor` 5.4 para `@bull-horizon` com `metrics` e todas as filas dos flows registradas (mudanças listadas em `vyral-flows.md`, feitas no repo da Vyral).
- [ ] Revisão de segurança aprovada (busca nova em rota sem auth, dados de job na tela de trace).

## Completeness Gate: perguntas abertas

O spec tem lacunas que só o usuário fecha. As premissas abaixo são os defaults que o Architect usou em `architecture.md`; confirmar ou corrigir antes do Tech Lead abrir tasks.

| # | Pergunta | Default recomendado |
|---|---|---|
| P1 | Quais opções entram por tela? Flow: grafo (A), tabela (B) ou as duas? Trace: grafo com caminho (A), gantt (B) ou as duas? | As duas em cada aba, alternáveis, como na 004 (A como padrão). |
| P2 | Formato da definição: objeto TS no setup do monitor ou arquivo `bullhorizon.flows.yaml` como no design? | Objeto TS tipado (`flows: [...]`), compartilhado com o worker como o `AI_AGENT`. A aba Config mostra a definição renderizada em YAML. Sem dependência de parser YAML no root. |
| P3 | Semântica do trace id: um id por execução (novo a cada entrada) ou o próprio videoId? | Um id por execução (`tr_` + 16 hex). Chave de negócio = `tiktokId` (único id do Q3 ao fim), com `videoId` e `content_id` como aliases de busca. Um vídeo que entra por d1, d7 e trending vira 3 traces, escolhidos pela lista de candidatos. |
| P4 | O trace pode ir em `data._trace` dos jobs da Vyral? (DTO com validação estrita rejeitaria campo extra) | Sim, `data._trace`, caminho configurável. |
| P5 | Retenção: na Vyral nada usa `true` (é idade de 30 min), o que basta para o collector. Mas "Abrir job" de trace com mais de 30 min cai em "job removido". Aceitar, ou subir a idade das filas do flow? | Aceitar 30 min; o metadado do trace fica no índice. |
| P6 | Etapas em andamento no trace: aceitar varredura limitada de waiting/active/delayed (teto por fila)? | Sim, teto de 500 jobs por fila por busca, marcado "parcial" quando estoura. |
| P7 | Escopo do piloto: a Vyral tem 9 flows (ver `vyral-flows.md`). Declarar e instrumentar todos, ou só `content-ingest` (o do design) e suas entradas? | Declarar 7 (`content-ingest`, `feed-ingest`, `product-ingest`, `trending-products`, `stats-refresh`, `legacy-import`, `legacy-cleanup`), instrumentar `content-ingest` e as 3 entradas primeiro. Crons de uma etapa, traduções e operações manuais ficam fora. |
| P8 | O `+` da barra de flows e o rótulo "16 queues" do design: o `+` some (painel read only)? | Some. O chip vira seletor quando houver mais de um flow. |
| P9 | Divergências desenho x código na Vyral (ver `vyral-flows.md`): a definição segue o código (o que roda) ou o desenho (o que deveria rodar)? | Segue o código; as divergências viram itens para o dono da Vyral decidir. |
| P10 | Janela dos KPIs: fixa em 24h como no design ou com seletor derivado da retenção (como `history`/`agents`)? | Seletor derivado de `metricsInfo`, default 24h. |
| P11 | Profundidade do índice de busca: quantos traces por flow? (2000 cobre ~3 h do volume da Vyral, ~6 MB de Redis; 20000 cobre ~1 dia, ~60 MB) | Default da lib 2000; na Vyral configurar 20000 se o Redis comportar. |
| P12 | O retorno do Whisper hoje pode vir pelo n8n (`TRANSCRIPTION_CALLBACK_URL` default) ou pelo webhook do `api`. Só o `api` dá para instrumentar. Trocar o callback para o `api`? | Sim. Com n8n, `contentSaveTranscription` só se liga ao trace pela busca por chave. |
| P13 | Na Vyral, cada vídeo vira um trace próprio ligado ao job da página/planner que o gerou (flows `feed-ingest`, `product-ingest`, `trending-products` separados de `content-ingest`). Ou o planner inteiro é um trace só? | Um trace por vídeo, ligado ao run (um run de 2000 vídeos não cabe num trace). |
| P14 | O design do módulo 05 diverge do código em 11 pontos (ex.: `IndexComments` não existe, fallback sai de `TranscriptionApi` e não de `SetupAuthor`, `SaveErrorState` nunca dispara por um bug no `ErrorHandlerService`). Corrigir o bug do `ErrorHandlerService` entra neste ciclo (repo da Vyral)? | Não entra na 005; vira item do dono da Vyral. A tela mostra o nó ON ERROR zerado e a validação aponta. |

## Decisões do Completeness Gate (2026-10-16)

O usuário pediu execução em paralelo, sem bloquear a conversa, e com as mensagens focadas no brand. Por isso o PO adotou os defaults recomendados, todos **revisáveis** quando o usuário olhar a 005:

1. Flow e Trace com as opções A e B alternáveis, A como padrão. Config só tem a opção A.
2. Definição em objeto TS (`Config.flows`). A aba Config exibe em YAML.
3. Um trace id por execução. Chave de negócio `tiktokId`, com `videoId` como alias de busca.
4. O trace viaja em `data._trace`.
5. A retenção de 30 min da Vyral basta. Trace mais velho que o job mostra "removido" ao abrir o job.
6. A varredura das etapas pendentes é limitada a 500 jobs por fila.
7. Piloto: declarar os 7 flows e instrumentar primeiro `content-ingest` e as 3 entradas.
8. O botão `+` da barra de flows sai.
9. A definição segue o código, não o desenho. As divergências ficam documentadas em `vyral-flows.md`.
10. Os KPIs têm seletor de janela, com 24h como padrão.
11. O índice guarda 2000 traces por flow por padrão na lib e 20000 na Vyral.
12. **Fica fora deste ciclo:** trocar o callback do Whisper do n8n para o webhook do `api`. É uma mudança de integração externa e precisa de decisão do dono. Até lá, o elo usa `continueTrace` onde der, ou aparece como quebra de trace documentada.
13. Um trace por vídeo, ligado ao run que o gerou.
14. O bug do `ErrorHandlerService` fica fora; é do dono da Vyral. Fica registrado em `vyral-flows.md`.
