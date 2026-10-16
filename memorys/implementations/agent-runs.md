# Runs de agente IA (implementação)

> Fragmento de `memorys/architecture.md` (ADR-004). Cobre o helper `createAgentRun`,
> a série de agentes no collector, as queries `agent*` e a tela Agents.
> Introduzido na task 004 (2026-10-15). Contrato público: `docs/agent-runs.md`.

## Onde cada coisa mora

- `packages/root/src/agent/`: contrato, corte de nível, tetos, resumo default e o
  recorder. Roda no worker do app consumidor. Não importa nada do resto do pacote.
- `packages/root/src/metrics/tiered-series.ts`: retenção em camadas genérica,
  usada pelo throughput e pela série de agentes. Mudou a mecânica? Os dois mudam.
- `packages/root/src/metrics/agent-metrics.ts`: ingestão por evento terminal,
  ponto agregado, índice de runs recentes (zset + hash) com a conversa em `c`.
- `packages/root/src/gql/data-sources/agents/`: leitura de runs do `job.log`,
  custo na leitura, corte defensivo, conversa.
- `packages/ui/src/screens/agents/`: Metrics, Runs, run (graph/waterfall) e
  conversa (chat/list). Lógica pura em `model.ts` e `conversation-model.ts`.

## Armadilhas que custaram uma rodada de QA

- **Número da tentativa difere entre as libs.** Bull 3 só incrementa
  `attemptsMade` quando a tentativa falha; BullMQ 1.x incrementa ao ativar o job
  (`moveJobFromWaitToActive.lua`). `defaultAgentRunAttempt` trata os dois (e
  `attemptsStarted` do BullMQ 5). Qualquer código novo que derive tentativa do
  job tem que passar por ele.
- **Records com chave vinda de conteúdo** (nome de tool, modelo, finishReason,
  conversationId) usam `Object.create(null)` e `hasOwnProperty.call`, nunca `in`.
  Um tool chamado `constructor` derrubava o `agentsSummary` (NaN em campo `Int!`).
- **Releitura no collector**: o app pode chamar `finish()` sem `await`, e a linha
  chega depois do evento `completed`. A releitura única acontece quando nenhuma
  linha pertence à tentativa que acabou de terminar, não só quando nenhuma linha
  nova apareceu.
- **`lost` em fila mista** conta também jobs que não são de agente removidos
  antes da leitura: o evento não traz o nome do job. Limitação documentada.
- **FakeRedis dos testes** (`__tests__/helpers/agent-fakes.ts`): `zrange` com
  stop antes do start precisa devolver vazio, como o Redis real. Já houve um
  bug ali que fazia o índice descartar entradas cedo e mascarava testes.
- **Aviso de conversa incompleta**: "índice cheio" sozinho fica sempre verdadeiro
  em produção (o brand passa de 2000 runs rápido). A regra exige também que o
  alcance do índice antes da primeira mensagem seja menor que a maior pausa da
  conversa (mínimo 30 min).

## Fluxo de trabalho

- Codegen v1 quebra com graphql 16 e o config da UI espera servidor em :3000.
  O caminho usado: imprimir o SDL a partir dos `typeDefs` do root e rodar o
  codegen v1 com graphql 15 num diretório temporário fora do repo. O diff do
  `typings/gql.ts` vem com reordenação; é esperado até a migração para o v5.
- A suíte de UI roda pela raiz (`npx jest packages/ui`): o pacote não tem script
  `test`, e o `make ui.test` está quebrado.
- O consumidor piloto (brand-api) usa pnpm. Para testar a lib local antes de
  publicar: `npm pack` do root/express e trocar os pacotes dentro de uma cópia
  `cp -al` do `node_modules`, sem tocar no `node_modules` do usuário.
