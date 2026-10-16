# Troubleshooting

Formato: sintoma, causas prováveis em ordem, como confirmar, correção.

## A fila não aparece no painel

1. **Não foi passada ao monitor.** `BullModule.registerQueue` sozinho não basta. Confirme que a fila tem `@InjectQueue` no construtor do `BullMonitorService` e entra no array `queues`. Correção: injetar e incluir (checklist em `setup-nestjs.md`).
2. **Fila crua, sem adapter**, ou adapter de outra cópia de `@bull-horizon/root`. Sintoma no log de boot: `Since version 3.0.0 every queue should be wrapped in bull or bullmq adapter`. O monitor checa `instanceof Queue` do root que ele carregou; duas versões de `@bull-horizon/root` no `node_modules` (ex. root `6.4` na app e `6.5` dentro do adapter) quebram essa checagem. Confirme com `npm ls @bull-horizon/root`. Correção: mesma versão em todos os `@bull-horizon/*` e dedupe.
3. **Adapter errado**: `BullAdapter` numa fila `bullmq` (ou o inverso). A fila pode aparecer vazia ou dar erro ao listar. Correção: `bull` → `BullAdapter`, `bullmq` → `BullMQAdapter`.
4. **Prefixo Redis diferente** (BullMQ com `prefix` custom, ou outro DB/host). A fila aparece sem jobs. Confirme a conexão/prefixo usada pela instância injetada.
5. **Sidebar filtrada**: na tela Agents a sidebar mostra só filas de agente; volte para Overview.
6. `setQueues()` chamado depois com uma lista menor substitui a lista inteira.

## A fila aparece fora do grupo esperado

`group` vem de `QUEUE_GROUPS[queue.name]`. A chave do mapa tem que ser exatamente o nome da fila (mesma constante). Sem entrada no mapa, a fila fica solta.

## Sem histórico / sem gráfico de throughput / sem Metrics history

1. **Collector desligado**: falta `metrics` na config (é opt-in). Correção: `metrics: {}`.
2. **Fila em `metrics.blacklist`.**
3. **Monitor acabou de subir**: a série só começa após o primeiro `collectInterval`; nada é retroativo.
4. **Buracos na série**: o monitor ficou fora do ar (restart, deploy). Esperado.
5. **Período longo não oferecido**: o seletor só mostra janelas que a retenção cobre. Para mais tempo, adicione uma camada em `retention.rollups`.
6. `startMetricsCollector()` chamado sem `metrics` loga `Metrics collector is not initialized`.

## Prometheus

- **404 em `/metrics`**: `prometheus` não ligado, ou URL errada. No Express/Nest o endpoint fica sob o mount (`/bull/metrics`); em Fastify/Koa/Hapi, sob o `baseUrl`.
- **Só gauges, sem `_total`**: falta `metrics`.
- **`_total` zera**: restart do monitor; normal para counter (`rate()` trata).
- **401 no scrape**: a rota está atrás da mesma auth do painel; configure `basic_auth` no scraper ou libere só na rede interna.
- **Métricas de agente**: não são exportadas, por design.

## Aba Agents não aparece

1. Nenhuma fila declarada com `ai` no adapter. Correção: `new BullAdapter(queue, { group, ai: AI_AGENT })`.
2. A fila de agente não está no array `queues` (ver primeira seção).

## Agents aparece, mas sem abas Metrics/Runs/Conversa

Sem collector: as queries retornam `NO_COLLECTOR` e as abas somem. Correção: `metrics: {}`.

## Agents vazio (Metrics/Runs sem dados), mas os jobs completam

1. **Worker sem `createAgentRun`**: o código que consome a fila é antigo (deploy do worker não saiu, ou outra instância/versão ainda pega jobs). Confirme: o resumo de Metrics mostra `unrecorded` > 0 (job de agente terminou sem linha de run e sem run no returnvalue), e o modal de Logs do job não tem `bull-horizon:agent-run`. Correção: deploy do worker com `createAgentRun` e desligar as instâncias antigas.
2. **Worker antigo que devolve o trace no `return`**: o painel usa o returnvalue como fallback (`source: returnvalue` no run). Funciona, mas sem as tentativas que falharam e com o conteúdo completo gravado no Redis pelo Bull, seja qual for o `detail`. Correção: mesma do item 1.
3. **Collector ligado há pouco**: nada é retroativo; só conta o que terminou com o monitor no ar.

## O run não aparece no job

1. **`finish`/`fail` não foram chamados** (ou o processo caiu antes): a tentativa fica como job comum. Confira que o service chama `await recorder.finish(...)` no sucesso e `await recorder.fail(...)` no catch.
2. **O nome do job não está em `ai.jobs`.** Só os nomes listados são lidos como run.
3. **Job removido**: `removeOnComplete: true`/`removeOnFail: true` apagam job e logs. Correção: retenção numérica ou `{ age, count }`.
4. **Fora da cauda de 200 linhas**: muitos `note()`/`job.log()` depois de uma tentativa empurram a linha do run para fora. Correção: poucas notas por tentativa.
5. **`finish` sem `await`**: em geral resolve com a releitura de 2 s do collector, mas pode chegar depois do evento. Correção: `await` antes de retornar/relançar.
6. Linha acima de 512 KB (só se `limits` foi muito aumentado) é ignorada na leitura.
7. Confira no modal de Logs do job se existe a linha `bull-horizon:agent-run {...}`.

## Contagem `unrecorded` nas métricas de agente

`unrecorded` = job de agente que terminou sem nenhum run: nem linha `bull-horizon:agent-run` no log, nem run válido no returnvalue. Diferente de `lost` (job já removido). Causa quase sempre: worker sem `createAgentRun` (ver "Agents vazio"). Também conta se `ai.jobs` inclui um nome de job que o worker não instrumenta.

## Contagem `lost` nas métricas de agente

`lost` = evento terminal cujo job já tinha sumido. Causas: `removeOnComplete: true`/`removeOnFail: true` na fila de agente, ou, numa fila mista, jobs que não são de agente com remoção imediata (Bull/BullMQ não mandam o nome do job no evento). Correção: retenção numérica para todos os jobs da fila, ou mover os não agente para outra fila.

## Custo "sem preço" / custo errado

1. Nome do modelo gravado no run diferente da chave do `ai.pricing` (`models/gemini-3.8-flash` vs `gemini-3.8-flash`). Comparação exata, case-insensitive. Correção: usar a mesma string em `createAgentRun({ model })` e no pricing.
2. Modelo ausente da tabela: adicione `{ input, output }` em USD por 1M tokens (ex. `'gemini-3.8-flash': { input: 0.75, output: 3.75 }`).
3. Custo de runs antigos mudou: é calculado na leitura com o pricing atual. Esperado.

## Warning `detailMismatch`

Log: `[bull-horizon] queue "X" declares detail "basic" but carries runs recorded at "full"`. O worker gravou `full` e o monitor declara `basic`: o painel corta ao servir, mas o conteúdo **já está no Redis**. Correção: importar o mesmo `AI_AGENT` no worker e no monitor; o conteúdo antigo some quando os jobs forem removidos pela retenção (ou limpe a fila).

## Conversa incompleta ou ausente

- Sem `conversationId` no `input` do helper: o run não tem conversa.
- Sem collector: a Conversa não existe.
- Índice de runs recentes cheio (`ai.recentRuns`, 2000 por fila): mensagens antigas saem e a tela avisa. Aumente `recentRuns`.
- Runs gravados antes do monitor estar no ar não entram no índice.

## Tentativa com número errado

Passou um objeto próprio em vez do job real como `job`. Passe o job do Bull/BullMQ, ou `attempt` explícito (1-based).

## GraphQL / body parser / Apollo

- **Erro de body já consumido ou JSON duplo-parseado** no Express/Nest: `await monitor.init({ disableBodyParser: true })` quando o app já faz parse de JSON.
- **Shutdown pendurado** no Express: `init({ httpServer })` liga o drain do Apollo.
- **Introspection** fica desligada em `NODE_ENV=production`; ligue com `gqlIntrospection: true` se precisar (lembrando que a rota não tem auth).
- **Hapi** segue em `apollo-server-hapi` v3 (sem suporte first-party do Apollo v4). Se o projeto exige deps sem EOL, prefira Express/Fastify/Koa.
- **Vindo de `@bull-monitor/*` < 6**: dependências `apollo-server-*` antigas podem sobrar no lockfile; remova-as junto com o rename para `@bull-horizon/*`.

## Painel abre, mas ações retornam erro

Fila marcada `readonly: true`: o servidor recusa mutações (retry, remove, add, clean) nessa fila. Esperado.
