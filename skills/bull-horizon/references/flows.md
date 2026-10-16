# Flows e traces

Flow = pipeline de negócio que atravessa várias filas (um job enfileira o próximo, com leque, fallback e fila de erro). A tela **Flows** mostra o flow como o código executa, onde ele engasga, e o caminho de **um** item, achado pelo trace id que viaja de job em job em `data._trace`. Documentação completa: `docs/flows.md` no repositório.

Divisão de papéis:

- **Monitor**: declara o flow em `flows` (etapas = filas, quem segue quem). O painel só lê. Não há editor de flow.
- **Worker**: copia o trace do pai para o filho com `withTrace` em todo `queue.add`.
- **Collector** (`metrics`): agrega por etapa e indexa os traces para a busca.

Run de agente abre o que acontece **dentro** de um job. Flow abre o que acontece **entre** jobs.

## Índice

1. Checklist de decisão
2. Declarar o flow no monitor
3. Propagar o trace nos workers
4. Fronteira externa (webhook)
5. Retenção e collector
6. O que a tela mostra
7. Status do trace
8. Tetos
9. Flows e runs de agente juntos
10. Erros comuns

## 1. Checklist de decisão (antes de codar)

1. **Qual é o item de negócio?** Um trace = uma execução do flow para um item (um vídeo, um pedido). Lote grande (planner que gera 2000 itens) **não** é um trace: cada item abre o seu com `startTrace({ ..., parent: job })`.
2. **Qual é a chave de negócio?** O id que o operador vai colar na busca (`trace.key`, caminho em `job.data`). Tem que ser **id interno opaco** (UUID, chave do banco, id de plataforma que não é dado pessoal). **Nunca** email, telefone, documento ou nome, **nem hash de um deles** (hash de dado pessoal se reverte por dicionário). A chave vai para o índice e para a tela, e a busca exata roda na rota sem auth: com dado pessoal ela vira oráculo de existência ("esse email passou pelo flow?").
3. **Quais filas são etapas?** Toda etapa precisa estar em `queues` do monitor. Uma fila com vários nomes de job pode ter várias etapas (`jobs`).
4. **Onde o trace nasce?** Toda entrada (HTTP, cron, evento) chama `startTrace`. Entrada que você não controla ganha trace implícito (ver §3).
5. **Algum elo sai do Redis?** Serviço externo que responde num webhook: `encodeTrace` na ida, `continueTrace` na volta (§4).
6. **Retenção:** `removeOnComplete`/`removeOnFail` numérico ou `{ age }` em todas as filas do flow. `true` vira `lost`.
7. **Collector:** `metrics: {}` no monitor. Sem ele só a aba Config aparece.
8. **DTO estrito?** Se o payload é validado com whitelist, libere o campo `_trace` (ou mude `trace.field`).

## 2. Declarar o flow no monitor

Arquivo compartilhado entre monitor e workers (mesma ideia do `AI_AGENT`): o `id` do flow e o campo do trace precisam bater dos dois lados.

```ts
// flows.ts
import type { FlowConfig } from '@bull-horizon/root';

export const CONTENT_INGEST: FlowConfig = {
  id: 'content-ingest', // [a-z0-9_.:-], até 64
  label: 'Content ingest',
  group: 'Content', // grupo da sidebar que ganha o selo FLOW
  entry: 'content:check',
  onError: 'content:save-error', // nó ON ERROR
  complete: ['content:index'], // conclusão fecha o trace e mede o fim a fim
  trace: { key: 'itemId', keyLabel: 'itemId' },
  steps: {
    'content:check': {
      next: [
        { to: 'content:fetch', when: 'new' },
        { end: 'only refreshes counters', when: 'exists' },
      ],
    },
    'content:fetch': { next: 'content:save' },
    'content:save': { next: 'content:captions' },
    'content:captions': {
      next: [
        { to: 'content:index', when: 'captions found' },
        { to: 'content:transcribe', when: 'no captions', kind: 'fallback' },
      ],
    },
    'content:transcribe': {
      next: { to: 'content:save-transcript', kind: 'fallback' },
    },
    'content:save-transcript': { next: 'content:index' },
    'content:index': {},
    'content:save-error': {},
  },
};
```

No `BullMonitorService` (NestJS, ver `setup-nestjs.md`):

```ts
this.monitor = new BullMonitorExpress({
  queues: this.queues.map(
    (q) => new BullAdapter(q, { group: QUEUE_GROUPS[q.name] })
  ),
  metrics: {}, // obrigatório para as abas Flow e Trace
  flows: [CONTENT_INGEST],
  flowsOptions: { recentTraces: 2000 }, // opcional, ver §8
});
```

Regras da definição:

- Chave de `steps` = nome da fila, a menos que `queue` diga outro. `jobs` restringe a etapa a nomes de job (match explícito vence etapa sem `jobs` na mesma fila).
- Aresta: `'id'`, `{ to, when?, kind? }` ou ramo terminal `{ end: 'rótulo', when? }`. `kind`: `next` (default; com `when` é desenhada condicional), `fallback` (tracejada, marca "concluído via fallback") ou `sidecar`.
- `complete` default: etapas sem `next` (menos `onError`) + ramos `end`. Declare explícito quando o fim real é outro.
- Aresta de qualquer etapa para `onError` conta como declarada.
- Ciclo é permitido (laço de retry por fila); o `hop` (64) corta o trace.
- **Validação nunca derruba o monitor**: vira check na aba Config + um `console.warn` por flow (`unknown-queue`, `unknown-step`, `no-completion`, `duplicate-flow`, `invalid-trace-key`...). Tetos: 32 flows, 64 etapas, 8 `next` por etapa, 8 aliases.

## 3. Propagar o trace nos workers

Helpers de `@bull-horizon/root`, puros e síncronos (sem Redis), Bull 3/4 e BullMQ 1+ (inclusive processor sandboxed). Devolvem cópia rasa do `data` e **nunca lançam**: em qualquer problema devolvem o `data` intacto e chamam `onError`. Não envolva em `try/catch`.

```ts
import { startTrace, withTrace } from '@bull-horizon/root';

// Entrada: abre o trace.
await checkQueue.add(
  'check',
  startTrace({ itemId }, { flow: 'content-ingest', key: itemId })
);

// Todo elo: o filho herda o trace do pai.
await fetchQueue.add('fetch', withTrace(job, { itemId: job.data.itemId }), {
  removeOnComplete: { age: 1800 },
  removeOnFail: { age: 172800 },
});
```

- `startTrace(data, { flow, key?, traceId?, parent?, onError? })`: `traceId` reaproveita id externo (request id); default `tr_` + 16 hex. `parent: job` liga o trace novo ao job de outro flow que o originou (planner → item).
- `withTrace(job, data, { flow?, key?, onError? })`: copia só os campos do trace (nunca o resto do payload do pai), `hop + 1`, `parent` = o job. Pai sem trace: abre um novo se `flow` vier; senão devolve `data` sem trace.
- `readTrace(jobOrData)`: o trace do job, ou `undefined`.
- **Todo `add`/`addBulk` do flow passa por `withTrace`.** Filho sem trace conta como `untraced` na etapa, não aparece no caminho e não conta a aresta.
- Entrada que você não controla (cron `repeat`, produtor em outro app) sem `startTrace`: o job de etapa `entry` ganha trace implícito `"<fila>:<jobId>"` só no índice (buscável). Os filhos só entram num trace com `withTrace(job, data, { flow })`, que abre um trace novo com `parent` apontando para ele.
- Retry do pai enfileira os filhos de novo; os dois aparecem no trace. Dedupe é do app (`jobId` determinístico).

## 4. Fronteira externa (webhook)

Quando o elo passa por fora do Redis (worker chama serviço externo que responde num webhook, que enfileira a próxima etapa):

```ts
// Worker que chama o serviço externo.
const trace = encodeTrace(job); // base64url, até 512 chars; undefined sem trace
await transcriber.start({
  url,
  callbackUrl: `${API}/webhooks/transcript?trace=${trace ?? ''}`,
});

// Handler do webhook.
await saveTranscriptQueue.add(
  'save',
  continueTrace(
    req.query.trace,
    { itemId, transcript },
    { parentQueue: 'content:transcribe' }
  )
);
```

`continueTrace` valida a entrada como não confiável; inválido = `data` sem trace. O trace **não é assinado**: é observabilidade, não autorização. Nunca use para decidir acesso.

## 5. Retenção e collector

- O collector lê o job no evento `completed`/`failed`. Fila de flow com `removeOnComplete: true`/`removeOnFail: true`: o job some antes e conta como `lost` na etapa (ou em `(queue)` se a fila tem várias etapas, porque o evento não traz o nome do job).
- O índice guarda só metadado (etapa, job, tentativa, horários, pai, 1ª linha do erro). Trace mais velho que o job mostra o caminho, mas "Abrir job" diz **"Job removed from Redis (retention)"**. Quer abrir jobs antigos pelo trace: aumente a idade.
- **Abas Flow e Trace só com collector** (`metrics`). Sem ele `flowSummary`/`flowTrace` devolvem `null`; a aba Config funciona.
- Só conta com o monitor no ar. Nada é retroativo.
- Contadores não são idempotentes entre réplicas do monitor (como o throughput). O índice de traces é.

## 6. O que a tela mostra

Sidebar ganha **Flows** quando há flow declarado. Por flow:

- **Flow** (collector): KPIs na janela (entradas, concluídos fim a fim, fim a fim p50/p95, gargalo, falhas), alternando **Graph** (nós com waiting/active/failed ao vivo, throughput, espera média nas arestas, fallback, ON ERROR, tag de gargalo) e **Table** (árvore indentada com p50/p95, espera na fila, taxa de falha). Clique na etapa: sparkline, erros recentes agrupados, próximas etapas, link para os jobs da fila.
- **Trace** (collector): caminho de uma execução em **Graph** (caminho aceso) ou **Timeline** (espera hachurada + processamento). Cada job abre `_trace`, timing, returnvalue ou stacktrace e o job.
- **Config** (sem collector): definição em YAML (read only), convenção `_trace`, validação: checks do boot + cobertura de `_trace`, `lost`, arestas observadas não declaradas (`undeclared-edge`) e declaradas nunca vistas (`unseen-edge`).

**Busca** no cabeçalho: trace id, job id ou valor exato da chave de negócio (1 a 256 chars, sem texto livre). Chave com várias execuções lista até 20 candidatos, mais recente primeiro. A varredura de pendentes tem orçamento limitado por requisição: a busca nunca lê filas inteiras.

## 7. Status do trace

Na ordem:

1. **RUNNING**: algum job do trace ainda está waiting/active/delayed/paused (achado pela varredura de pendentes).
2. **FAILED**: um job terminou em falha sem enfileirar filho (beco sem saída).
3. **COMPLETED**: job de etapa `complete` concluiu, ou job de etapa com ramo `end` concluiu sem filho. **COMPLETED_WITH_FALLBACK**: além disso, algum job entrou por aresta `fallback`.
4. **UNKNOWN**: nada acima (jobs saíram do índice, ou o caminho parou numa etapa que não é de conclusão).

Pendente decide primeiro: falha num ramo não aparece FAILED e depois vira COMPLETED quando o irmão termina.

## 8. Tetos

| Teto                            | Default       | Efeito                                                                                                                                             |
| ------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flowsOptions.recentTraces`     | 2000 por flow | Traces no índice da busca. Mais velhos saem inteiros (sem chave órfã); a busca avisa "pode ser mais antigo que o índice". ~180 B por job por trace |
| `flowsOptions.jobsPerTrace`     | 300           | Jobs por trace; o excedente não é indexado e o trace fica `truncated`                                                                              |
| `flowsOptions.pendingScanLimit` | 500 por fila  | Jobs lidos por fila (waiting, active, delayed, paused, prioritized) na varredura de pendentes; estourou = `partial`                                |
| `hop`                           | 64            | `withTrace`/`continueTrace` param de propagar                                                                                                      |
| `encodeTrace`                   | 512 chars     | Acima disso devolve `undefined`                                                                                                                    |
| Chaves por trace                | 4             | Valores distintos (key + aliases), 128 chars cada                                                                                                  |

## 9. Flows e runs de agente juntos

Fila de agente pode ser etapa de flow. Instrumente os dois: enfileire o job de agente com `withTrace(job, data)` e grave a tentativa com `createAgentRun` (ver `agent-runs.md`). Do trace você abre o job; do job, o run de agente. Canais diferentes: run em `job.log`, trace em `data._trace`.

## 10. Erros comuns

| Erro                                                     | Efeito                                                                      | Correção                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `queue.add` sem `withTrace` num elo                      | filho `untraced`, caminho quebra ali, aresta não conta                      | `withTrace(job, data)` em todo add do flow               |
| `startTrace` faltando na entrada                         | só trace implícito `<fila>:<jobId>`; filhos sem trace                       | `startTrace` em toda entrada                             |
| um trace para o lote inteiro                             | trace bate `jobsPerTrace` (`truncated`), status confuso                     | um trace por item com `startTrace({ ..., parent: job })` |
| `removeOnComplete: true`                                 | jobs viram `lost`, sem trace                                                | número ou `{ age }`                                      |
| etapa com fila fora de `queues`                          | check `unknown-queue`, etapa sem números                                    | injetar a fila no monitor                                |
| `flow` diferente entre monitor e worker                  | jobs com `_trace` de outro flow são ignorados (contam como `untraced`)      | importar o mesmo `FlowConfig` nos dois                   |
| DTO estrito rejeita `_trace`                             | job falha na validação do payload                                           | liberar o campo ou mudar `trace.field`                   |
| email/telefone/documento/nome (ou hash deles) como chave | dado pessoal no índice e na tela; busca sem auth vira oráculo de existência | id interno opaco (UUID, chave do banco)                  |
| elo via webhook sem `encodeTrace`/`continueTrace`        | trace quebra na volta                                                       | levar o trace na URL/payload do callback                 |
| esperar que `trace.aliases` ligue job sem `_trace`       | não liga: alias só é lido de job com trace                                  | levar o trace pelo hop (`continueTrace`)                 |
| confiar no trace para autorização                        | qualquer um forja                                                           | trace é só observabilidade                               |

## Limitações conhecidas

- **`trace.aliases` só cobre jobs com trace.** Os valores são lidos do `job.data` de jobs que carregam `_trace` (ou de entrada com trace implícito) e indexados como chaves extras do mesmo trace. Job que chega **sem** `_trace` (enfileirado por sistema externo que você não instrumenta) não é ligado a trace nenhum pelo alias: só conta como `untraced`.
- Sem métricas de flow no Prometheus (nome de etapa e chave virariam label em rota sem auth).
