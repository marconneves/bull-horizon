# QA 004: backend (T001 a T005)

**Data:** 2026-10-15
**Escopo:** `packages/root` (mudanças não commitadas): `src/agent/`, `src/metrics/`, `metrics-collector.ts`, adapters Bull e BullMQ, `queue.ts`, `typings/config.ts`, `gql/type-defs/agents.ts`, `gql/data-sources/agents/`, resolvers.
**Insumos:** `spec.md`, `architecture.md` (§1 a §6 e desvios declarados pelo Developer), `threat-model.md` (pontos 1, 3, 5, 6, 9), `memorys/guidelines.md`.

## Veredito: Reprovado

Um achado Major (numeração de tentativa errada no BullMQ 1.x, quebra a regra do suporte dual) devolve ao Developer. A correção é pequena. Os demais achados são Minor e podem ir no mesmo ciclo. Todo o resto verificado está correto, inclusive o corte `basic` e a regra "nunca lança".

## Como foi verificado

- Leitura de todo o código novo e do diff de `packages/root`.
- Suite root: `npx jest packages/root`: 6 suites, 93 passaram, 5 pulados (os 5 testes de prova dos achados, ver abaixo). `npx tsc --noEmit -p packages/root`: ok. `npx eslint packages/root/src --ext .ts`: ok.
- Testes de prova novos em `packages/root/src/__tests__/qa-004-backend.test.ts`. Os marcados `QA-FINDING` descrevem o comportamento esperado e estão com `it.skip` para não quebrar a suite; todos falharam quando rodados sem o skip. O Developer deve tirar o skip ao corrigir.
- **Smoke com Redis real**: Redis 7 em container Docker temporário (porta 56379, já removido), `packages/root` compilado para `/tmp/qa004/dist` (fora do repo), script `/tmp/qa004/smoke.js` com uma fila Bull 3.27 e uma BullMQ 1.76 de verdade, `ai: { jobs: ['reply'], detail: 'basic' }`, processor usando `createAgentRun`, primeira tentativa falhando (`await rec.fail()` + throw) e a segunda com sucesso, jobs com `finish()` sem `await`, job com `removeOnComplete: true`, `MetricsCollector` real e `AgentsDataSource` chamado pelos resolvers `Query.agentRun` e `Job.agentRuns`.

## Achados

### F1 [Major] BullMQ 1.x: tentativa gravada com número a mais

- **Onde:** `packages/root/src/agent/recorder.ts:375-376` (default `attempt = job.attemptsMade + 1`).
- **Causa:** no BullMQ 1.76 (versão instalada e suportada, `memorys/architecture.md`), o script `moveJobFromWaitToActive.lua:10` faz `HINCRBY attemptsMade 1` ao ativar o job. Dentro do processor a primeira tentativa já vê `attemptsMade = 1`. No Bull v3 o contador só sobe na falha (`job.js:575`), então lá o default está certo.
- **Reprodução (smoke real):** job BullMQ com `attempts: 2`, primeira tentativa falha. Linhas gravadas: `[[2, "first attempt fails"], [3, null]]`. No Bull, o mesmo cenário grava `[[1, ...], [2, null]]`. `agentRun(attempt: 1)` no BullMQ devolve `null`, e a UI vai mostrar "tentativa 2" para a primeira execução.
- **Impacto:** seletor de tentativa, índice de runs (`a`) e a lista de runs mostram número errado em toda fila BullMQ 1.x. Agregados não são afetados (o membro do dedupe continua único).
- **Sugestão:** o helper não sabe qual lib está rodando. Opções: detectar o job do BullMQ por forma (ex.: presença de `token`/`queueQualifiedName`, ou `attemptsStarted` em versões novas) e usar `attemptsMade` sem `+1`; ou exigir `attempt` explícito na doc para BullMQ. Vale conferir também o comportamento do BullMQ ^4 citado na arquitetura. Adicionar teste com os dois formatos de job.

### F2 [Minor] Releitura só acontece quando nenhuma linha nova apareceu

- **Onde:** `packages/root/src/metrics/agent-metrics.ts:379`.
- **Divergência:** `architecture.md` §4.2 diz que o collector tenta de novo "se não achar a linha da última tentativa". O código só agenda a releitura quando `ingested === 0`. Num job com retry, as linhas das tentativas anteriores são novas no evento terminal (nem Bull nem BullMQ emitem evento global no retry), então a releitura não é agendada e a linha da última tentativa, se chegar depois do evento (`finish()` sem `await`, como o brand faz hoje), nunca é ingerida.
- **Reprodução:** teste `QA-FINDING: re-reads when the LAST attempt line is missing...` em `qa-004-backend.test.ts:61` (Bull e BullMQ): esperado `runs = 2`, recebido `1`. No smoke real a corrida não apareceu (o `RPUSH` do log sai antes do `moveToFinished`), por isso Minor e não Major.
- **Sugestão:** agendar a releitura também quando nenhuma das linhas novas tiver `finishedAt` posterior a `job.processedOn` (ou seja, a tentativa corrente ainda não apareceu), sem aritmética de `attemptsMade`.

### F3 [Minor] Falha interna em `finish`/`fail` perde a linha do run sem nova chance

- **Onde:** `packages/root/src/agent/recorder.ts:302` (`_closed = true` antes de montar e serializar) combinado com `recorder.ts:275` (getter de card) e `limits.ts:72` (`truncateValue` devolve a referência original do objeto do app).
- **Reprodução:** testes `qa-004-backend.test.ts:134` (card com getter `title` que lança) e `:150` (no nível `full`, o app transforma o `input` de uma tool em estrutura circular depois de `tool()`; o `JSON.stringify` da linha lança). Nos dois casos `finish()` resolve, `onError` é chamado, nada é gravado, e uma chamada posterior a `fail()` é ignorada.
- **Observação:** a regra "nunca lança" continua valendo (verificado). O problema é perder o run inteiro por um campo.
- **Sugestão:** copiar o valor ao gravar (`JSON.parse(text)` quando `ok`), proteger cada card individualmente, e em último caso gravar o esqueleto `basic`.

### F4 [Minor] `limits` com chave explícita `undefined` anula o default

- **Onde:** `packages/root/src/agent/recorder.ts:152` (`{ ...DEFAULT_AGENT_RUN_LIMITS, ..._options.limits }`).
- **Reprodução:** teste `qa-004-backend.test.ts:164`: `limits: { lineBytes: undefined }` faz toda linha virar esqueleto sem tools e `truncated: true`. Com `writeTimeoutMs: undefined` o timeout dispara na hora; com `textChars: undefined` os textos não são cortados.
- **Sugestão:** mesclar só valores numéricos finitos e positivos.

### F5 [Minor] Overhead calculado contra a tentativa errada enquanto o job está ativo

- **Onde:** `packages/root/src/gql/data-sources/agents/index.ts:101`.
- **Análise de código:** a última linha do log recebe `processedOn`/`finishedOn` do job. Se o job está rodando a tentativa N+1 (ainda sem linha), a última linha é da tentativa N e `overheadStartMs = startedAt(N) - processedOn(N+1)` sai negativo. O mesmo vale depois de um retry manual que ainda não gravou linha.
- **Sugestão:** só calcular overhead quando o job estiver em estado terminal e `startedAt >= processedOn`.

### F6 [Minor, documentação] `lost` conta jobs removidos que não são de agente

- **Onde:** `packages/root/src/metrics/agent-metrics.ts:367`.
- Em fila mista (`ai.jobs: ['reply']`) com `removeOnComplete: true`, o job some antes da leitura e o nome não é mais conhecido, então qualquer job removido conta como `lost`. Inevitável sem o nome no evento; documentar junto do requisito de `removeOnComplete` numérico (T010).

## Verificado e OK

**Regras de negócio da spec (backend)**
- Regra 1: só fila com `ai` e job que passa em `isAgentJob` (`ai.jobs` omitido = todos) vira run; linha fora do contrato `v: 1` é ignorada (`parseAgentRunLine` com guard de forma, teto de 512 KB, JSON inválido devolve `null`).
- Regra 2: default `basic` em todos os caminhos: sem config, `ai: true`, `detail` desconhecido (`normalizeAgentRunDetail`), helper sem `agent`/`detail`. `detail` explícito vence o da fila. Corte por whitelist antes do `job.log`; `recorder.run` fica sem corte só em memória. No smoke real, nenhuma linha `basic` contém os marcadores `SECRET` de `input.text`, `tools[].input/output`, `steps[].text` e `final.text`, nas duas libs.
- Regra 4: tentativa que falha grava a linha antes do throw e chega ao painel (smoke: `outcome: error` na tentativa 1, `failed` contado nos agregados das duas libs).
- Regra 5: `agentsSummary` e `agentRuns` sem collector lançam `NO_COLLECTOR` ("Metrics are not enabled"); `agentRun` e `Job.agentRuns` funcionam sem collector (smoke real).
- Regra 6: custo `null` (nunca 0) sem preço, no run, no passo, no item da lista e no resumo (`hasUnpricedModels`); preço com match case-insensitive (`Gemini-X` contra `gemini-x`: custo `0.00036` = (300 x 1 + 30 x 2) / 1e6, conferido nas duas libs). Preço não finito é descartado.
- `agentRun` com fila desconhecida lança `QUEUE_NOT_FOUND`; `agentRuns` limita `limit` a 500; `summarize` devolve "empty object" para `{}` (desvios declarados, conferidos).

**Suporte dual Bull/BullMQ**
- `getJobLogs(start, end)`: as duas libs (Bull 3.27 `getters.js:178`, BullMQ 1.76 `queue-getters.js:160`) fazem `LRANGE start end` em ordem ascendente; índices negativos contam da cauda. Smoke: `(-1, -1)` = última linha, `(0, 0)` = primeira, `(-200, -1)` em ordem cronológica, nas duas.
- Ingestão pelos eventos terminais nas duas libs, inclusive todas as tentativas no evento final; `removeOnComplete: true` vira `lost = 1` nas duas (smoke).
- Numeração de tentativa: correta no Bull (completed e failed); errada no BullMQ 1.x (F1).

**T001 refactor do throughput**
- `TieredSeries` reproduz linha a linha a lógica antiga: mesma chave raw (`redisPrefix + queueId`, sufixo vazio), mesmas camadas `::r<everyMs>`, mesmo JSON do ponto, mesmo trim, mesmo read-modify-write do rollup, mesmo alargamento do slice. `metrics-collector.test.ts` não foi alterado e continua verde.

**Helper (threat model 9, guideline do módulo)**
- Nenhum método público lança ou rejeita: `log` que lança síncrono, rejeita ou nunca resolve (resolve no `writeTimeoutMs`), `onEvent`, `onError`, `summarize`, `isEmpty` e `now` que lançam, valores circulares e BigInt, opções sem sentido (recorder no-op).
- `finish`/`fail` idempotentes: só a primeira grava, uma linha por tentativa; a linha do run é a última escrita do helper (`note` recusa o prefixo).
- `src/agent/` não importa nada de `gql/`, collector nem libs de terceiros; nenhuma dependência nova.
- Tetos e degradação de 64 KB (inclusive esqueleto sem tools) cobertos pelos testes do Developer; totais de tokens preservados acima do teto de passos.

**Collector**
- Dedupe `ZADD NX` idempotente entre duas instâncias do monitor no mesmo Redis, com eventos concorrentes e duplicados (`qa-004-backend.test.ts`, Bull e BullMQ).
- Releitura única em 2 s quando nenhuma linha aparece (teste do Developer), sem loop.
- Trim do índice: `ZRANGE` dos excedentes e `ZREM` + `HDEL` dos mesmos membros no mesmo `MULTI`; zset e hash ficam consistentes. Índice sempre `basic` (corte antes de indexar).
- `clear`/`clearAll` apagam todas as chaves de agente da fila (série raw `::ai`, cada camada `::ai::r<everyMs>`, zset `::ai::runs` e hash `::ai::runs::data`; 5 chaves com as duas camadas da retenção padrão) além do throughput. Smoke real: `EXISTS` 1 antes e 0 depois, nas duas libs.
- Percentil: faixas com limite superior inclusivo (500 na faixa 0, 501 na faixa 1, 300000 na última faixa, 300001 no overflow); interpolação chega exatamente na borda (p50 de [2, 2] = 500); o resultado nunca passa de `durMax`; overflow devolve `durMax`; sem runs devolve `null`.
- Cardinalidade limitada (50 tools, 20 modelos, 20 outcomes, `(other)`), ponto esparso, merge correto (testes do Developer).

**Threat model**
- Ponto 1: corte antes do Redis em todos os caminhos (`finish`, `fail`, degradação); o servidor corta de novo ao servir e marca `detailMismatch` (linha `full` ou legada em fila `basic`).
- Ponto 3: `summarize` default sem valor (só forma, contagens e até 5 nomes de chave).
- Ponto 5: tetos de escrita e leitura, cauda de 200 linhas, guard de forma, cardinalidade e índice capados.
- Ponto 6: linha falsificada só é lida em fila e job de agente, passa pelo guard de forma e é recortada ao nível da fila.
- Ponto 9: ver Helper acima.

## Próximo passo

Devolver ao Developer: corrigir F1 (obrigatório) e, de preferência, F2 a F5 no mesmo ciclo, tirando o `skip` dos testes `QA-FINDING` correspondentes. F6 vai para a doc (T010). Depois disso, nova rodada de QA e então Security (T013), já que a feature toca persistência de PII.

## Correções (Developer, 2026-10-15)

Os 5 testes `QA-FINDING` de `qa-004-backend.test.ts` estão sem `skip` e passam. Suite root: 6 suites, 111 testes, 0 pulados. Jest do repo inteiro: 8 suites, 139 testes. `tsc --noEmit` ok em `root`, e em `express`, `fastify`, `koa`, `hapi` e `cli` contra o build local do `root` (symlink). `eslint packages/root/src` e `prettier --check` ok.

- **F1 [Major] tentativa no BullMQ 1.x.** Conferido em `node_modules`: Bull 3.27 só incrementa `attemptsMade` na falha (`job.js:575`); BullMQ 1.76 incrementa ao ativar (`includes/moveJobFromWaitToActive.lua`, `HINCRBY attemptsMade 1`). Novo `defaultAgentRunAttempt(job)` em `recorder.ts` (exportado): usa `attemptsStarted` quando existe (BullMQ 5+, onde `attemptsMade` voltou a subir só na falha); senão, job BullMQ (tem `updateProgress()` e `progress` não é função, ao contrário do `progress()` do Bull) usa `attemptsMade` sem `+1`; qualquer outra coisa segue a regra do Bull (`+1`). `attempt` explícito continua vencendo. Testes com as classes `Job` reais do Bull e do BullMQ (sem Redis) e com `attemptsStarted`. Lado do collector e do data source: nenhum dos dois usa `attemptsMade` (o membro do dedupe é `jobId:attempt:startedAt` e a releitura agora é por tempo, ver F2), então não há o mesmo off-by-one lá.
- **F2 releitura.** `agent-metrics.ts`: a releitura agora é agendada quando nenhuma linha lida pertence à tentativa que acabou de terminar (`isCurrentAttemptRun`: `finishedAt` da linha `>= job.processedOn`), independentemente de linhas de tentativas anteriores terem sido novas. Sem `processedOn` (desconhecido) relê uma vez por segurança. Continua uma releitura só, sem loop e sem aritmética de `attemptsMade`. Teste extra: com a linha da última tentativa presente, não relê.
- **F3 linha perdida.** (a) `truncateValue` devolve sempre uma cópia JSON, nunca o objeto do app (mutação depois de `tool()` não afeta a linha); (b) cada campo de card é lido com proteção (getter que lança vira `''`, os outros cards ficam); (c) `_close` não depende mais do `build`: se o `build` lança, grava o que o run tem; se o `formatAgentRunLine` lança (ex.: app mutou `recorder.run` num ciclo), grava um esqueleto `basic` montado campo a campo só com primitivos, `truncated: true`, sem tools, e reporta ao `onError`. O recorder só marca `closed` quando uma linha foi produzida; se nenhuma puder ser montada fica aberto e um `fail()` posterior ainda grava. Na prática o esqueleto sempre sai, então um `fail()` depois de um `finish()` degradado é ignorado (uma linha por tentativa, a primeira vence), documentado. Proteção contra reentrada (`onEvent` chamando `fail` dentro do `finish`). "Nunca lança" mantido.
- **F4 `limits` com `undefined`.** `mergeLimits` só aceita números finitos e positivos; o resto mantém o default. Teste extra com `textChars`, `writeTimeoutMs`, `steps` e `toolsPerStep` inválidos.
- **F5 overhead.** `AgentsDataSource._overhead`: só calcula quando a última linha é da tentativa corrente do job (`isCurrentAttemptRun` + `startedAt >= processedOn`); `overheadEndMs` exige `finishedOn >= processedOn` (descarta `finishedOn` de antes de um retry manual) e `finishedOn >= finishedAt`. Nunca negativo: gap negativo vira `null`. Testes: tentativa nova sem linha, `finishedOn` antigo, gap negativo. Descrições GraphQL atualizadas.
- **F6 `lost` em fila mista.** Sem correção barata e correta: nem Bull nem BullMQ põem o nome do job no evento e o job já foi apagado. Comportamento mantido e nomeado: comentário no collector, descrição do campo `AgentsSummary.lost` no GraphQL (e em `typings/gql.ts`), `docs/agent-runs.md` (Limitations) e erros comuns da skill.
- **Doc-writer: summary de tool com falha.** Deixou de ser sobrescrito com `failed` sem contexto: agora é `failed: <ErrorClassName>` (nome do construtor, validado como identificador, até 60 chars), ou `failed` se o erro não é `Error`. Nunca a mensagem nem um `name` customizado (podem carregar conteúdo; a mensagem continua só em `tools[].error`, `full`). Teste garante que `SECRET` da mensagem/`name` não chega à linha `basic`.
- **Doc-writer: `"text": ""`.** O helper não cria mais `text: ''` no passo; `stepFinish` sem texto omite a chave. `applyAgentRunDetail` também omite texto vazio (linhas antigas com `""`). Exemplo em `docs/agent-runs.md` corrigido.
- **Doc-writer: cauda de 200 linhas.** Mantida: Redis não filtra lista no servidor, então varrer o log inteiro por prefixo custaria uma leitura completa por evento. Documentado em `docs/agent-runs.md` (Limits e Limitations) e nos erros comuns da skill (`note()` demais esconde runs anteriores).

Docs atualizadas: `docs/agent-runs.md` (numeração de tentativa por lib, opção `attempt`/`limits`, degradação na falha de build, regra da releitura, summary de tool com falha, texto omitido, cauda de 200, overhead, `lost`), `skills/bull-horizon-agent-jobs/SKILL.md` (erros comuns).

## Re-teste (QA, 2026-10-15)

### Veredito: Aprovado

F1 a F5 corrigidos e confirmados; F6 documentado como limitação (aceito). Nenhuma regressão encontrada.

**Como foi verificado**
- `npx jest packages/root`: 6 suites, 111 testes, 0 pulados (as 5 provas `QA-FINDING` sem `skip` e verdes). `npx tsc --noEmit -p packages/root`: ok. `npx eslint packages/root/src --ext .ts`: ok.
- Smoke com Redis real repetido (Redis 7 em Docker, já removido; Bull 3.27 e BullMQ 1.76; root recompilado em `/tmp/qa004/dist`), com um cenário novo para F2: job com retry cuja segunda tentativa chama `finish()` 500 ms depois de o processor retornar, então a linha chega depois do evento terminal. Todas as verificações passaram nas duas libs.

**Resultados**
- F1: linhas gravadas `[1, 2]` no Bull **e** no BullMQ (antes `[2, 3]` no BullMQ). `agentRun(attempt: 1)` devolve a tentativa com erro nas duas libs. A heurística de `defaultAgentRunAttempt` (`attemptsStarted` primeiro; BullMQ reconhecido por `updateProgress()` e `progress` não função; resto com a regra do Bull) também cobre os processors sandboxed das duas libs pela leitura do código. `attempt` explícito continua vencendo.
- F2: no cenário de finish atrasado, o índice tem as tentativas `[1, 2]` nas duas libs, ou seja, a releitura agora acontece mesmo quando a linha da tentativa anterior foi nova. `isCurrentAttemptRun` compara o `finishedAt` da linha com o `job.processedOn`. Os dois relógios são do host do worker, então não há risco prático de skew.
- F3: `truncateValue` devolve cópia (`JSON.parse` do texto já serializado); mutar o objeto do app depois de `tool()` não afeta mais a linha. O card com getter que lança não derruba a linha.
- F4: `mergeLimits` ignora valores que não sejam finitos e positivos.
- F5: overhead nunca negativo. No smoke, com o finish atrasado, `overheadEndMs = null` (o job terminou antes da linha) e `overheadStartMs >= 0`. Tentativas anteriores continuam com `null`.
- Agregados nas duas libs batem com o esperado: 7 runs, 4 falhas, 1 `lost` (`removeOnComplete: true`), custo calculado na leitura. `clear` apaga as 5 chaves de agente.
- Mudanças extras: o summary de tool com falha (`failed: <ErrorClass>`) não vaza a mensagem nem um `name` customizado (coberto por teste); o texto vazio do passo é omitido.

**Observação (sem severidade):** no BullMQ 1.x, uma tentativa recuperada de stall também incrementa `attemptsMade`, então a numeração conta as ativações e não só as tentativas que terminaram. Isso é coerente com a própria lib e não exige mudança; basta citar em `docs/agent-runs.md` se fizer sentido.

**Próximo passo:** liberar para o Security (T013), já que a feature persiste PII no nível `full`, e depois para o code review do Tech Lead.
