# QA 005: backend de Flows (T001 a T009)

**Data:** 2026-10-16
**Escopo:** `packages/root` (não commitado): `flow/`, `shared/attempt.ts`, `metrics/histogram.ts`, `metrics/flow-metrics.ts`, mudanças no `metrics-collector.ts` e no `main.ts`, `gql/type-defs/flows.ts`, `gql/data-sources/flows/`, resolvers, testes `flow-*.test.ts` e `flows-resolvers.test.ts`.
**Insumos:** `spec.md` (com as Decisões do Completeness Gate), `architecture.md`, `tasks.md` e os desvios declarados pelo Developer.

## Veredito: Reprovado

Dois achados Major: (G1) falhas definitivas que ainda tinham tentativas sobrando não entram em nenhum agregado nem no índice; (G2) jobs pendentes de uma etapa que já tem job no trace (leque) não aparecem no trace. Os dois foram reproduzidos com Redis real nas duas libs. O resto do backend está correto: suporte dual, propagação do trace, busca, índice com despejo sem órfão, `clear`, helpers que nunca lançam.

## Como foi verificado

- Leitura de todo o código novo e do diff de `packages/root`.
- `npx jest packages/root`: 13 suites, 322 testes, todos verdes. Na primeira rodada, 5 suítes de agente e `flows-resolvers` nem compilavam, por uma mudança de tipos em andamento de outro dev (`AgentsSummary.skipped`). Na segunda rodada estava tudo verde. `npx tsc --noEmit -p packages/root`: ok. `npx eslint packages/root/src --ext .ts`: ok.
- **Smoke com Redis real**: Redis 7 em container Docker temporário (porta 56380, já removido), `packages/root` compilado em `/tmp/qa005/dist` e script `/tmp/qa005/smoke.js`, tudo fora do repo. Foram montados dois flows iguais, um em Bull 3.27 e outro em BullMQ 1.76: `A` (entrada) > `B` > `C` (conclusão), com `onError: E` e `trace.key: videoId`. O processor de `A` faz leque de 5 jobs `B` com `withTrace` em `queue.add`:
  1. ok;
  2. falha e enfileira `E`;
  3. falha na 1a tentativa e conclui na 2a (`attempts: 2`);
  4. falha definitiva com tentativas sobrando (`job.discard()` no Bull, `UnrecoverableError` no BullMQ, `attempts: 3`);
  5. `delay: 60000`, ou seja, pendente.

  Os `B` que concluem enfileiram `C`. Depois do tick, os resolvers `Query.flowSummary` e `Query.flowTrace` (por trace id, job id e chave) foram chamados. Também rodei um segundo collector com `recentTraces: 2`, 5 traces e `clear`.

## Achados

### G1 [Major] Falha definitiva com tentativas sobrando é descartada

- **Onde:** `packages/root/src/metrics/flow-metrics.ts:595`, em `_ingest`, no bloco `if (status === 'failed') { const max = Number(job.opts?.attempts); if (Number.isFinite(max) && attempt < max) return; }` (desvio declarado "retried failures not counted").
- **Causa:** nem o Bull (`global:failed`, publicado só por `moveToFinished`) nem o BullMQ 1.x (`failed` no stream de eventos) emitem evento de falha numa tentativa que vai ter retry. Então o guard nunca filtra um retry de verdade. O que ele filtra são as falhas definitivas que acabam antes de esgotar `attempts`: `job.discard()` (Bull), `UnrecoverableError` e backoff que devolve `-1` (BullMQ), e job que excede `maxStalledCount`.
- **Reprodução (smoke real, as duas libs):** o job `B` 4 está no set `failed` com `attemptsMade = 1` e `opts.attempts = 3`. Resultado: `B.failed = 1` (esperado 2), o job não aparece no trace (`flowTrace` lista só a falha comum) e não conta nos KPIs de falha. Ao mesmo tempo, os "erros recentes" da etapa (lidos do set `failed`) mostram esse job, então a tela fica inconsistente.
- **Sugestão:** tratar todo evento `failed` como terminal (é o que as duas libs garantem) e remover o guard. Ou, se for para manter alguma defesa, confirmar o estado `failed` do job em vez de comparar com `opts.attempts`. Ajustar o teste `skips a failure that will be retried` em `flow-metrics.test.ts:279`.

### G2 [Major] Irmão pendente de etapa já vista some do trace (leque)

- **Onde:** `packages/root/src/gql/data-sources/flows/index.ts:723`, `_scanFrontier`: a fronteira só inclui etapas que **não** têm nenhum job no trace (`seen.has(edge.from) && !seen.has(edge.to)`).
- **Reprodução (smoke real, as duas libs):** o `B` 5 (atrasado, no set `delayed` com o `_trace` do mesmo trace) não aparece em `flowTrace` (os jobs de `B` listados são `[1 completed, 2 failed, 3 completed]`, nenhum `pending`). O trace sai com status `COMPLETED`, sem nenhum sinal de que ainda há trabalho em andamento.
- **Impacto:** a regra 10 da spec ("etapas ainda em andamento aparecem no trace como pendentes") não vale para leque, e a spec cita o leque como caso comum ("às vezes em leque"). A implementação segue a definição de fronteira do `architecture.md` §4.4, então a correção passa pelo Architect.
- **Sugestão:** incluir na fronteira também as etapas vistas que são destino de aresta com origem vista (o custo continua limitado por `pendingScanLimit` por fila), ou, no mínimo, as etapas de `next` de um pai que tem mais filhos no índice do que concluídos. Avaliar se `COMPLETED` deve virar `RUNNING` quando há pendente.

### G3 [Minor] Passagem pela etapa `onError` vira "aresta não declarada"

- **Onde:** `normalizeFlows` não cria aresta implícita para `onError`, e `getSummary` marca `B > E` como `declared: false`.
- **Reprodução:** smoke: `edges` traz `{"from":"B","to":"E","declared":false}` e o check `undeclared-edge` sai como `warn`. Em produção, toda falha tratada gera esse aviso na aba Config (US007) e polui a validação. O contrato não tem `kind` de erro para declarar essa aresta.
- **Sugestão:** tratar arestas com destino em `onError` como declaradas (tipo próprio ou implícito a partir de qualquer etapa).

### G4 [Minor] Busca por trace id não acha trace sem nenhum evento terminal

- **Onde:** `getTrace`, passo 1 (`index.hasTrace`).
- **Análise de código:** um trace aberto com `startTrace`, cuja entrada ainda está na fila ou ativa, não está no índice. A busca pelo trace id cai em `NONE`. A busca pelo job id funciona, porque varre as filas. Vale documentar em `docs/flows.md` (T016), ou fazer o passo 1 tentar a varredura das entradas quando o id tem formato de trace.

## Verificado e OK

**Regras da spec (backend)**
- Regra 1/2: definição só no código; etapa = fila + `jobs` opcional; `normalizeFlows` nunca lança e transforma problema em check (testes do Developer).
- Regra 3/4: trace por execução, em `data._trace`, escrito só no `add`; `withTrace` copia só os campos conhecidos, incrementa `hop` e grava o pai. Smoke: os `C` têm `parentStepId = B` nas duas libs.
- Regra 5: `startTrace`, `withTrace`, `encodeTrace` e `continueTrace` nunca lançam (try/catch total, `onError` protegido, data não objeto, hop 64, pai sem trace), conforme os testes de `flow-trace.test.ts`. Não há I/O e as únicas dependências são `crypto` e `shared/attempt`.
- Regra 6: sem collector, `flows` responde e `flowSummary`/`flowTrace` devolvem `null` (teste do Developer).
- Regra 7: job removido conta como `lost` na etapa, ou em `(queue)` quando a fila tem mais de uma etapa.
- Regra 8: busca exata por trace id, job id ou chave; `query` vazia ou com mais de 256 chars dá erro; consulta desconhecida dá `NONE` (smoke). A busca por job id fica limitada às filas distintas do flow (no máximo 64).
- Regra 9: `indexFull` sinalizado; o índice é limitado por `recentTraces`.

**Suporte dual Bull/BullMQ (smoke real)**
- `withTrace(job, data)` em `queue.add` propaga o trace nas duas libs (`parent.queue` vem de `job.queue.name` no Bull e de `queueName` no BullMQ).
- Tentativas por `shared/attempt`: a entrada tem `attempt 1`; o `B` 3, que conclui na 2a tentativa, é indexado com `attempt 2`; a falha simples tem `attempt 1`. Igual nas duas libs (o BullMQ 1.76 incrementa `attemptsMade` na ativação, e `terminalAttempts` com o hint do provider trata isso).
- Agregados iguais nas duas libs: `entries = 1`, `done = 2`, `errors = 1`, `B.completed = 2`, `B.retried = 1`, `coverage = 1`, arestas `A > B` e `B > C` observadas.
- Busca por trace id (`TRACE_ID`), por job id de um `C` (`JOB_ID`, mesmo trace) e por `videoId` (`KEY`) funcionando nas duas libs.

**Índice e chaves**
- Despejo com `recentTraces: 2` e 5 traces: sobram 2 traces, e cada membro de `traces::jobs`, `traces::keys` e `traces::meta` pertence a um trace mantido (nenhum órfão).
- `clear(queue)` numa fila do flow apaga todas as chaves do flow (série, camadas e as 4 chaves do índice); nenhuma chave `*flow-mq*` sobra no Redis. Isso bate com o desvio declarado.
- Escrita do índice num `MULTI` com membros determinísticos: evento repetido não duplica (teste do Developer). `ZLEXCOUNT` até `\0~` não conta marcadores, porque os `queueId` são base64.

**Varredura de pendentes**
- Limitada a `pendingScanLimit` (default 500) por fila: o tamanho da página é `min(100, limite - lidos)`, então nunca lê além do teto. Ao estourar, a resposta sai com `partial: true` (teste `flows-resolvers.test.ts:565`). Só varre filas da fronteira (mas ver G2).

**Robustez de leitura**
- `_trace` lido do Redis é validado campo a campo (`hasOwn`, padrão do trace id e do flow, `hop` de 0 a 64, recortes). Caminhos de chave e aliases rejeitam `__proto__`, `prototype` e `constructor`. Records com nome de protótipo e lixo vindo do Redis são tratados (testes do Developer).
- O refactor do histograma (`metrics/histogram.ts`) não muda o percentil do agente (teste `matches latencyPercentile on the agent bands`). Testes do agente verdes.

## Próximo passo

Devolver ao Developer: G1 (remover ou trocar o guard) e G2 (fronteira com irmãos pendentes, que precisa de aval do Architect por mudar o §4.4). G3 e G4 podem ir no mesmo ciclo ou na doc (T016). Depois, nova rodada de QA e Security (T017).

## Correções (Developer, 2026-10-16)

Decisões do Architect registradas em `architecture.md` §7.1 (§4.4 atualizado). Só `packages/root`; schema GraphQL sem mudança (typings não regenerados).

- **G1** `metrics/flow-metrics.ts`: guard de `opts.attempts` removido; todo evento `failed` é terminal. Teste `counts every failure event as final, attempts left or not (G1)` (Bull e BullMQ): falha na tentativa 1 de 3 conta `f = 1`, entra no índice com `a = 1` e a mensagem.
- **G2** `gql/data-sources/flows/index.ts`: `_scanFrontier` virou `_scanPending`, que varre as filas de todas as etapas (limite por fila mantido); `traceStatus` só dá `COMPLETED*` sem pendentes. Teste `keeps a trace RUNNING while a fan-out sibling is delayed (G2)`: irmão `delayed` de `Extract` aparece como `pending`, trace `RUNNING`; removido o irmão, volta a `COMPLETED`. O teste de RUNNING agora confere que cada fila do flow é lida uma vez por status.
- **G3** `getSummary`: aresta observada `etapa > onError` sai `declared: true` e não gera `undeclared-edge`. Teste `treats a step -> onError edge as implicitly declared (G3)`.
- **G4** `getTrace`: trace id fora do índice cai na varredura de pendentes antes de `NONE`. Teste `finds a trace id with no terminal event yet via the pending scan (G4)` (entrada `waiting` encontrada como `TRACE_ID`/`RUNNING`; id inexistente segue `NONE`).

Validação: `npx jest packages/root` 13 suítes / 328 testes verdes; `tsc --noEmit` root ok; `eslint packages/root/src` ok; build do root ok.

## Re-teste (QA, 2026-10-16)

### Veredito: Aprovado

G1 a G4 foram corrigidos e confirmados com Redis real nas duas libs. Ficou um achado novo, Minor (G5), que não bloqueia.

**Como foi verificado**
- Smoke repetido (Redis 7 em Docker, já removido; Bull 3.27 e BullMQ 1.76; root recompilado em `/tmp/qa005/dist`), com cenários novos: a promoção do irmão atrasado e uma entrada atrasada para testar a busca por trace id antes de qualquer evento terminal.
- `npx jest` no repo inteiro: 21 suítes, 403 testes, todos verdes. Isso inclui `packages/ui` e a feature nova de skip do agente (`agent-skip.test.ts`, `agent-metrics`, `agents-resolvers`). Nenhuma falha de UI, nem mesmo de trabalho em andamento. `tsc --noEmit` no root: ok. `eslint packages/root/src`: ok.

**Resultados (iguais em Bull e BullMQ)**
- G1: `B.failed = 2`. A falha definitiva com tentativas sobrando (`discard` no Bull, `UnrecoverableError` no BullMQ) conta nos agregados e aparece no trace com a mensagem.
- G2: o irmão `delayed` de `B` aparece no trace como `pending`. Depois de promovido e concluído, o trace fica `COMPLETED`, sem pendentes, com 10 jobs.
- G3: `B > E` sai `declared: true` e não gera o check `undeclared-edge`.
- G4: um trace com a entrada atrasada (nada terminou) é achado pelo trace id como `TRACE_ID` / `RUNNING`.
- Sem regressão: busca por job id, por chave e `NONE`; tentativas (`attempt 2` no retry); arestas `A > B` e `B > C`; `coverage = 1`; despejo com `recentTraces: 2` sem órfão; `clear` sem chave restante.

### G5 [Minor] Trace com pendente e uma falha sem filho sai `FAILED`, não `RUNNING`

- **Onde:** `packages/root/src/gql/data-sources/flows/index.ts:942-945` (`traceStatus` testa `FAILED` antes de `RUNNING`).
- **Reprodução (smoke):** no leque, o `B` 4 falha de vez sem enfileirar `E`, enquanto o `B` 5 está `delayed`. O trace sai `FAILED` com um job `pending` listado. Quando o `B` 5 conclui e o `C` termina, o mesmo trace vira `COMPLETED`. O status muda de "falhou" para "concluído", e o operador pode tomar como definitivo um trace que ainda está andando.
- **Sugestão:** com pendente, devolver `RUNNING` antes de `FAILED` (a falha continua visível no job). Pode entrar no próximo ciclo ou junto da UI (T012/T014).

**Próximo passo:** liberar para o Security (T017) e depois para o code review do Tech Lead.

## Correção G5 (Tech Lead, 2026-10-16)

Em `gql/data-sources/flows/index.ts`, o status do trace agora segue esta ordem:
1. `RUNNING` enquanto houver qualquer job pendente.
2. Sem nada pendente: `FAILED` se houver falha sem continuação.
3. Senão, `COMPLETED` (ou `COMPLETED_WITH_FALLBACK`).
4. Senão, `UNKNOWN`.

Assim acaba a troca de FAILED para COMPLETED quando um irmão termina. A suíte do root passa (328). Ainda falta um teste dedicado ao cenário, que fica para a UI/QA final.
