# Arquitetura 005: Flows e traces

**Status:** 🏛️ Proposta do Architect, depende das respostas P1 a P11 do `spec.md` (os defaults recomendados estão assumidos aqui)
**Data:** 2026-10-16
**ADR:** ADR-005 (proposta) em `memorys/architecture.md`
**Precedente direto:** ADR-004 / `docs/todo/004-agentes-ia/architecture.md` (helper no worker, série própria no collector, índice capado)

## 0. Resumo das decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | Flow declarado em **objeto TS** na config do monitor (`Config.flows`), não em YAML | Tipado, sem parser no root, compartilhável com o worker como o `AI_AGENT`. A aba Config renderiza em YAML para leitura. |
| D2 | Trace viaja em **`data._trace`** (contrato `FlowTraceV1`), escrito uma vez ao enfileirar | `job.data` é igual em Bull 3/4 e BullMQ 1..5 e chega ao processor sandboxed. `opts` custom não sobrevive em todas as versões do BullMQ. Não é read-modify-write (o que derrubou `data` na 004). |
| D3 | Helpers **`startTrace` / `withTrace`** puros e síncronos em `packages/root/src/flow/` | Sem Redis, sem dependência, nunca lançam. Mesmo isolamento do `agent/`. |
| D4 | Etapa = **fila (+ nomes de job opcionais)**; agregados por etapa **não exigem `_trace`** | A aba Flow funciona no dia 1 só com a definição e o collector. O `_trace` acrescenta caminho, fim a fim e arestas observadas. |
| D5 | Agregados numa **série `TieredSeries` por flow** (`::flow`), alimentada pelos eventos terminais que já existem | Mesma retenção em camadas, sobrevive ao `removeOnComplete` numérico, sem varrer jobs. |
| D6 | Tempos por **histograma de faixas fixas** (processamento, espera, fim a fim) | Mesclável por soma, p50/p95 interpolados na leitura, zero dependência (lição da 004). |
| D7 | **Índice de traces em zsets lexicográficos** por flow, com teto, sem chave por trace | Busca por trace id e por chave de negócio em O(log N + M), escrita só com `ZADD` (idempotente, sem read-modify-write entre réplicas), despejo que apaga tudo do trace. Nenhuma chave órfã. |
| D8 | Etapas **pendentes** do trace lidas na hora, só da **fronteira** (filas das etapas seguintes às já vistas), com teto | O collector só vê eventos terminais. Varrer as 16 filas a cada busca seria amplificação. |
| D9 | Uma tela **Flows** com abas Flow / Trace / Config, opções A e B alternáveis | P1. Flow e Trace exigem o collector; Config não. |
| D10 | Sem métricas de flow no `/metrics` Prometheus | Nome de etapa e chave de negócio como label em rota sem auth. Reabrir com Security. |

## 1. Contrato `_trace` v1

### 1.1 Tipo (exportado de `@bull-horizon/root`)

```ts
export const FLOW_TRACE_FIELD = '_trace';

export type FlowTraceV1 = {
  v: 1;
  /** Uma execução do flow. Nasce na entrada, copiado de pai para filho. */
  traceId: string;            // default `tr_` + 16 hex; aceito [A-Za-z0-9_.:-]{1,64}
  flow: string;               // id do flow na config
  /** Valor da chave de negócio (ex.: videoId), String(). Opcional. */
  key?: string;               // até 128 chars
  /** ms epoch de quando a entrada foi enfileirada. Base do fim a fim. */
  startedAt: number;
  /** Ausente na entrada. */
  parent?: {
    queue?: string;           // nome da fila do pai (ausente em sandbox sem queue)
    jobId: string;
    name?: string;            // nome do job do pai (resolve a etapa em fila com vários jobs)
    attempt?: number;         // tentativa do pai que enfileirou (retry do pai = filho duplicado)
  };
  /** Profundidade a partir da entrada. Teto 64: protege contra laço de re-enfileiramento. */
  hop: number;
};
```

O design mostra `step`, `parentJobId`, `attempt` e `enqueuedAt`. Mapeamento: `step` é **derivado no servidor** (fila + nome do job, o worker não declara a própria etapa e não pode errar isso), `enqueuedAt` é `job.timestamp`, `parentJobId` e `attempt` estão em `parent`. A aba Config e o painel do trace mostram o `_trace` real, não o do design.

### 1.2 Regras do contrato

- Escrito **uma vez**, ao enfileirar. Nunca atualizado depois (sem `job.update`).
- O campo é configurável por flow (`trace.field`, default `_trace`) para apps que já usam o nome.
- Payload sem `_trace` válido = job "sem trace": entra nos agregados da etapa, conta em `untraced`, não entra no índice nem em arestas.
- Leitura defensiva no servidor: tipos checados, strings recortadas, `traceId` fora do padrão descartado, `hop > 64` descartado.

### 1.3 Chave de negócio e aliases

A chave (`_trace.key`) é fixada na entrada e herdada: na Vyral é o `tiktokId`, o único id presente do Q3 ao fim. Mas o operador pensa em `videoId`, que só nasce no Q5. Por isso o flow declara `trace.aliases`: caminhos em `job.data` que o **collector** lê em cada job do trace (ex.: `videoId`, `videoIds.0`, `content_id`) e indexa como chaves extras do mesmo trace (no máximo 4 valores distintos por trace, 128 chars cada). A busca por `videoId` acha o trace aberto com `tiktokId`. Aliases também ligam pela busca jobs que chegaram **sem** `_trace` (callback do n8n): na tela, aparecem como "ligados por chave", não como parte do caminho.

## 2. Config do setup

### 2.1 Tipos (`packages/root/src/typings/config.ts` + `flow/contract.ts`)

```ts
export type FlowNext =
  | string                                         // etapa seguinte, incondicional
  | {
      to?: string;                                 // etapa seguinte
      end?: string;                                // ou: ramo terminal com rótulo ("só atualiza números")
      when?: string;                               // rótulo da condição (só exibição)
      kind?: 'next' | 'fallback' | 'sidecar';      // default 'next'
    };

export type FlowStepConfig = {
  /** Nome da fila (`Queue.name`). Default: a chave da etapa. */
  queue?: string;
  /** Só estes nomes de job são a etapa. Omitido = todos. */
  jobs?: string[];
  label?: string;
  description?: string;
  /** Condição de execução da etapa (só exibição), ex.: "language != pt-BR". */
  when?: string;
  next?: FlowNext | FlowNext[];
};

export type FlowConfig = {
  id: string;                     // [a-z0-9-_.:], até 64
  label?: string;
  /** Grupo da sidebar que ganha o selo FLOW. Default: o grupo comum às filas do flow, se houver um só. */
  group?: string;
  entry: string | string[];
  /** Etapa de erro (nó ON ERROR). */
  onError?: string;
  /** Etapas cuja conclusão fecha o trace. Default: etapas sem `next` (exceto onError) + ramos `end`. */
  complete?: string[];
  trace?: {
    field?: string;               // default '_trace'
    /** Caminho com pontos em `job.data` da chave de negócio, ex.: 'videoId'. */
    key?: string;
    /** Rótulo da chave na UI, ex.: 'videoId'. Default = último segmento de `key`. */
    keyLabel?: string;
    /** Caminhos extras em `job.data` indexados como chave do mesmo trace (ver 1.3). Até 8. */
    aliases?: string[];
  };
  steps: Record<string, FlowStepConfig>;
};

export type FlowsOptions = {
  /** Traces guardados no índice por flow. Default 2000. */
  recentTraces?: number;
  /** Jobs guardados por trace. Default 300. */
  jobsPerTrace?: number;
  /** Teto de jobs lidos por fila ao procurar etapas pendentes. Default 500. */
  pendingScanLimit?: number;
};

export type Config = {
  // ...existente
  flows?: FlowConfig[];
  flowsOptions?: FlowsOptions;
};
```

### 2.2 Normalização e validação no boot (`flow/definition.ts`)

`normalizeFlows(config.flows, queues)` roda no construtor do `BullMonitor` e produz `NormalizedFlow` (etapas com `queueId` resolvido, arestas explícitas com `kind`, nós `end` sintéticos, `complete` calculado). **Nunca lança**: problemas viram `FlowCheck` (nível `error`/`warn`) servidos na aba Config e um `console.warn` único por flow:

- etapa cuja fila não está em `config.queues` (`error`);
- `next.to` / `entry` / `onError` / `complete` apontando para etapa inexistente (`error`, aresta descartada);
- flow sem etapa de conclusão alcançável (`warn`); ciclos são permitidos (retry por callback na Vyral), o `hop` limita o trace;
- id de flow repetido (o segundo é ignorado, `error`);
- tetos: no máximo 32 flows, 64 etapas por flow, 8 `next` por etapa (excedente descartado com `warn`).

Chaves de etapa e de flow vêm da config (confiável), mas são guardadas em `Map` e recortadas: a mesma regra de `own-property` vale porque o `_trace` lido do Redis referencia essas chaves.

### 2.3 Uso (Vyral, resumo; versão completa em `vyral-flows.md`)

```ts
import type { FlowConfig } from '@bull-horizon/root';

export const CONTENT_INGEST: FlowConfig = {
  id: 'content-ingest',
  label: 'Ingestão de conteúdo',
  group: 'Content',
  entry: 'content:VerifyIfVideoExist',
  onError: 'content:SaveErrorState',
  trace: { key: 'videoId' },
  steps: {
    'content:VerifyIfVideoExist': {
      next: [
        { to: 'content:ExtractTiktokVideoInfo', when: 'novo' },
        { end: 'só atualiza números', when: 'já existe' },
      ],
    },
    // ...
  },
};

new BullMonitorExpress({ queues, metrics: {}, flows: [CONTENT_INGEST] });
```

## 3. Helpers (`packages/root/src/flow/`)

### 3.1 Isolamento

`flow/` segue a regra do `agent/` (guidelines): não importa `gql/`, collector nem libs de terceiros; só `crypto` do Node para o id. Pode importar o cálculo de tentativa de `agent/recorder.ts` (`defaultAgentRunAttempt`), que deve ser movido para `shared/attempt.ts` sem mudar o export público. Extraível para `@bull-horizon/flow` sem refactor.

### 3.2 API

```ts
/** Abre um trace na entrada do flow (HTTP, cron, evento, primeira fila). */
export function startTrace<T extends object>(
  data: T,
  options: {
    flow: string;
    key?: string | number;      // se omitido e o flow tiver trace.key, o servidor lê do data
    traceId?: string;           // reaproveitar um id externo (request id, OTel)
    /** Job que originou a entrada em outro flow (página do planner -> vídeo). Vira `parent`, hop 0. */
    parent?: FlowTraceParent;
    field?: string;             // default '_trace'
    now?: number;
    onError?: (err: unknown) => void;
  }
): T;

/** Dados do filho carregando o trace do pai. Uso: queue.add(name, withTrace(job, { videoId })) */
export function withTrace<T extends object>(
  parent: FlowTraceParent,      // o job do processor (Bull, BullMQ ou wrapper sandboxed)
  data: T,
  options?: {
    flow?: string;              // obrigatório só se o pai não tiver trace (abre um novo)
    key?: string | number;      // sobrescreve a chave herdada
    field?: string;
    onError?: (err: unknown) => void;
  }
): T;

/** Lê o trace de um job ou payload. undefined se ausente/inválido. */
export function readTrace(jobOrData: unknown, field?: string): FlowTraceV1 | undefined;

/** Estrutural: Job do Bull, Job do BullMQ ou objeto do processor sandboxed. */
export type FlowTraceParent = {
  id?: string | number | null;
  name?: string;
  data?: unknown;
  queue?: { name?: string };    // Bull
  queueName?: string;           // BullMQ
  attemptsMade?: number;
  attemptsStarted?: number;     // BullMQ 5
  updateProgress?: unknown;     // marca BullMQ (mesma heurística do agent)
};
```

### 3.3 Comportamento

- Devolve **cópia rasa** `{ ...data, [field]: trace }`; nunca muta o `data` recebido nem o do pai.
- `withTrace` copia do pai só os campos conhecidos (`traceId`, `flow`, `key`, `startedAt`, `hop + 1`), validados. Nada do resto do payload do pai é copiado (sem prototype pollution, sem vazar campo).
- Pai sem trace válido: abre um trace novo com `options.flow` e preenche `parent` mesmo assim (o servidor mostra a aresta, o trace começa ali). Sem `options.flow`: devolve `data` sem trace e chama `onError`.
- `hop >= 64`: devolve `data` sem trace e chama `onError` (laço de re-enfileiramento não vira trace infinito).
- `data` que não é objeto simples (string, array, `null`): devolve inalterado e chama `onError`.
- **Nunca lança**: corpo inteiro em `try/catch`, `onError` também protegido. Em erro devolve o `data` original.
- `parent.attempt` usa o cálculo de tentativa da 004 (Bull 3 `attemptsMade + 1`; BullMQ 1..4 `attemptsMade`; BullMQ 5 `attemptsStarted`).
- Retries do pai enfileiram filhos de novo (com `attempt` diferente). O servidor mostra os dois; dedupe é do app (jobId determinístico), não da lib.

### 3.4 Ligação entre flows

`startTrace(..., { parent: job })` abre um trace novo (um por item) mas guarda o job de origem em `parent`. Assim o planner que gera 2000 vídeos não vira um trace de 2000 jobs (o teto `jobsPerTrace` cortaria): cada vídeo tem o seu trace em `content-ingest`, e a faixa do trace mostra "veio de `feed-ingest` · `ingest:top-videos:page` job X" com link para o trace de origem (resolvido pelo `_trace` do job pai, quando ele ainda existir).

### 3.5 Fronteira externa (HTTP de ida e volta)

Quando o elo entre duas etapas passa por fora do Redis (Vyral: f-2 chama o Modal, o Modal chama um webhook, o webhook enfileira f-4), o `_trace` precisa atravessar como texto:

```ts
/** Trace do job serializado para levar numa URL/cabeçalho/payload externo. base64url, ≤ 512 chars. */
export function encodeTrace(job: FlowTraceParent, field?: string): string | undefined;

/** No receptor (webhook): dados do próximo job continuando o trace recebido. Inválido = data sem trace. */
export function continueTrace<T extends object>(
  encoded: unknown,
  data: T,
  options?: { parentQueue?: string; field?: string; onError?: (err: unknown) => void }
): T;
```

O `encodeTrace` carrega `traceId`, `flow`, `key`, `startedAt`, `hop` e o pai (fila, job, nome, tentativa). O `continueTrace` valida tudo como entrada não confiável (mesmas regras de leitura do servidor) e incrementa `hop`. Sem assinatura: o trace é observabilidade, não autorização; quem forja um trace só bagunça o próprio painel (registrado no modelo de ameaças).

### 3.6 Fila de entrada sem helper

Entradas que o app não controla bem (cron do Bull `repeat`, produtores em outros apps) podem não chamar `startTrace`. Regra no servidor: job de uma etapa `entry` **sem** `_trace` recebe trace **implícito** `traceId = "<queue>:<jobId>"` no índice (não no Redis do job). Os filhos desse job, se usarem `withTrace`, abrem um trace novo com `parent` apontando para ele, e o servidor junta os dois pelo `parent`. Fallback de busca pela chave de negócio continua valendo.

## 4. Collector (`packages/root/src/metrics/flow-metrics.ts`)

### 4.1 Fonte do evento

Os hooks `onGlobalJobCompletion` / `onGlobalJobFailure` já existentes. Para fila que pertence a algum flow:

1. `getJob(id)` uma vez por evento. Refactor pequeno: `_onJobComplete`/`_onJobFail` do `MetricsCollector` buscam o job uma vez e repassam para throughput, agentes e flows (hoje o throughput busca no `completed` e o agente busca de novo). O agente mantém a própria releitura.
2. Nulo: `lost++` na etapa (se a fila tiver uma etapa só) ou em `(queue)`. Fim.
3. Resolve a(s) etapa(s) por `queue.id` + `job.name` (`Map` montado no boot).
4. Calcula, **sem `_trace`**: tentativa terminal (função nova `terminalAttempts(job, status)`, testada nas duas libs, ver 4.5), `proc = finishedOn - processedOn`, `wait = processedOn - (timestamp + (opts.delay ?? 0))` **só quando a tentativa terminal é a primeira** (com retry, `processedOn` é o da última tentativa e a "espera" incluiria backoff; esses jobs contam em `retried`).
5. Com `_trace` válido: aresta `parentStep > step` (pai resolvido por `parent.queue` + `parent.name`; sem `queue`, procura o `jobId` nas filas das etapas declaradas como predecessoras, no máximo 8 `getJob`), fim a fim se a etapa estiver em `complete` e o status for `completed` (`finishedOn - startedAt`), e escrita no índice (4.3), incluindo os valores de `trace.aliases` lidos do `job.data` como chaves extras.
6. Nada disso é aguardado pelo hook (`void`), erros logados, nunca propagados. Mesma regra da 004.

Idempotência: o índice usa `ZADD` com membro determinístico (repetir o evento não duplica). Os contadores da série **não** são idempotentes (mesma limitação aceita do throughput: réplicas do monitor contam em dobro). Documentar.

### 4.2 Ponto da série

```ts
/** Faixas (ms) dos três histogramas. Índice length = overflow. Mudar exige `h` novo. */
export const FLOW_DURATION_BOUNDS_MS = [
  10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, 30000,
  60000, 120000, 300000, 600000, 1200000, 1800000, 3600000, 7200000,
];

type THist = Record<number, number>; // índice da faixa -> contagem, esparso

export type TFlowStepPoint = {
  c: number; f: number; lost: number; untraced: number; retried: number;
  pr: THist; prSum: number; prMax: number;   // processamento
  wq: THist; wqSum: number; wqN: number; wqMax: number; // espera na fila
};

export type TFlowPoint = {
  timestamp: number;
  windowMs: number;
  h: 1;
  steps: Record<string, TFlowStepPoint>;     // chave = id da etapa (config)
  e2e: THist; e2eN: number; e2eSum: number; e2eMax: number;
  entries: number;                            // terminais da(s) etapa(s) de entrada
  done: number;                               // conclusões fim a fim
  errors: number;                             // passagens pela etapa onError
  edges: Record<string, number>;              // 'from>to', from pode ser '(unknown)'
};
```

- Records com `Object.create(null)` e `hasOwnProperty.call` na leitura (lição F1 da 004). `edges` com teto de 64 chaves por ponto, excedente em `(other)`; chaves recortadas a 160 chars também na leitura.
- Série **esparsa**: ponto só quando o flow teve evento no tick. Uma série **por flow** (não por fila): uma leitura serve a tela inteira.
- Merge: soma em contadores e histogramas (por índice), `max` nos máximos.
- Percentil: o mesmo algoritmo do agente (acumula até `q * total`, interpola na faixa, overflow devolve o máximo). Extrair `histogramQuantile` de `agent-metrics.ts` para `metrics/histogram.ts` e reusar.
- Custo: ~1,5 KB por ponto com 16 etapas ativas (histogramas esparsos). Pior caso (evento em todo minuto) ~6,5 MB por flow no raw de 3 dias + ~1,5 MB nas camadas. Aceito, registrado no ADR.

### 4.3 Chaves

| Chave | Tipo | Conteúdo |
|---|---|---|
| `<redisPrefix>flow:<flowId>::flow` | list | série raw de `TFlowPoint` |
| `<redisPrefix>flow:<flowId>::flow::r<everyMs>` | list | camadas de `retention.rollups` |
| `<redisPrefix>flow:<flowId>::traces` | zset | score = `startedAt`, membro = `traceId` |
| `<redisPrefix>flow:<flowId>::traces::jobs` | zset lex (score 0) | membro = `traceId \x00 queueId \x00 jobId \x00 attempt \x00 <json TFlowTraceJob>` |
| `<redisPrefix>flow:<flowId>::traces::keys` | zset lex (score 0) | membro = `key \x00 traceId` |
| `<redisPrefix>flow:<flowId>::traces::meta` | hash | `traceId` → `{ k?, s, x? }` (chave, início, truncado) |

`TieredSeries` recebe `queue = 'flow:' + flowId` e `suffix = '::flow'`; o prefixo `flow:` não colide com `Queue.id`, que é base64 do `clientName()` (alfabeto sem `:`).

`TFlowTraceJob` (só metadado, nunca payload):

```ts
{ s: string;  q: string; j: string; a: number;     // etapa, queueId, jobId, tentativa terminal
  st: 'c' | 'f';                                   // completed / failed
  t0: number; t1: number | null; t2: number | null; // enfileirado, início, fim
  p?: [string, string];                            // [queueId, jobId] do pai
  e?: string }                                     // failedReason, 160 chars, 1a linha
```

**Escrita** (um `MULTI` por evento): `ZADD traces NX startedAt traceId`, `ZADD traces::jobs 0 member`, `ZADD traces::keys 0 key\x00traceId` (se houver chave), `HSET meta traceId {...}` (idempotente: os campos são constantes por trace). Teto de jobs por trace: antes do `MULTI`, `ZLEXCOUNT` no prefixo; acima de `jobsPerTrace` marca `x: 1` no meta e não grava o job.

**Despejo** (depois da escrita, quando `ZCARD traces > recentTraces`): `ZRANGE traces 0 n` pega os mais antigos; para cada um, `ZREMRANGEBYLEX traces::jobs [id\x00 (id\x01`, `ZREM traces::keys key\x00id` (a chave vem do meta), `HDEL meta id`, `ZREM traces id`. Tudo do trace sai junto: **nenhuma chave por trace, nada órfão**. Custo de despejo O(jobs do trace).

`clear`/`clearAll` (botões da tela `history`) apagam também as seis chaves de cada flow. `_allKeys` ganha as chaves de flow.

Memória do índice: ~180 B por job × 16 jobs × 2000 traces ≈ 6 MB por flow no default. Na Vyral (≈18 mil entradas/dia) 2000 traces cobrem ~3 h; ver P11.

### 4.4 Etapas pendentes (leitura, não collector)

Na busca, depois de ler os jobs terminais do trace, o servidor varre as filas de **todas as etapas do flow** (distintas, no máximo 64), não só a fronteira: um irmão de leque numa etapa que já tem job concluído também está pendente (ajuste pós-QA G2). Para cada fila, lê `waiting`, `active`, `delayed`, `paused` (+ `prioritized` no BullMQ) em páginas até `pendingScanLimit` por fila e filtra em memória por `readTrace(job).traceId`. Achou: o job entra com `status` real e `pending: true`. Estourou o teto: `partial: true` na resposta. Um trace só é `COMPLETED`/`COMPLETED_WITH_FALLBACK` quando nenhum job dele está pendente em nenhuma etapa.

### 4.5 Tentativa terminal (lição da 004)

`terminalAttempts(job, status)`: BullMQ (tem `updateProgress`) `attemptsStarted ?? attemptsMade`; Bull 3/4 `completed` → `attemptsMade + 1`, `failed` → `attemptsMade` (o Bull incrementa ao falhar). Teste com fixtures das duas libs, nos dois status. Qualquer código novo que derive tentativa do job passa por aqui ou pelo `defaultAgentRunAttempt`.

## 5. GraphQL (`gql/type-defs/flows.ts`, `gql/data-sources/flows/`)

```graphql
enum FlowEdgeKind { NEXT CONDITIONAL FALLBACK SIDECAR END }
enum FlowStepKind { STEP END ERROR }
enum FlowCheckLevel { OK WARN ERROR }
enum FlowTraceMatch { TRACE_ID JOB_ID KEY NONE }
enum FlowTraceStatus { RUNNING COMPLETED COMPLETED_WITH_FALLBACK FAILED UNKNOWN }

type FlowStep {
  id: ID!; kind: FlowStepKind!; label: String!; description: String; when: String
  queue: String; queueId: ID; jobs: [String!]   # null em END
  sharedQueue: Boolean!                          # fila com mais de uma etapa: contagens ao vivo são da fila
}
type FlowEdge { from: ID!; to: ID!; kind: FlowEdgeKind!; when: String; declared: Boolean! }
type FlowCheck { level: FlowCheckLevel!; code: String!; message: String! }

type Flow {
  id: ID!; label: String!; group: String; keyLabel: String
  entry: [ID!]!; complete: [ID!]!; onError: ID
  steps: [FlowStep!]!; edges: [FlowEdge!]!
  definition: String!          # YAML renderizado no servidor (serializador próprio, ~50 linhas)
  checks: [FlowCheck!]!        # checks estáticos do boot
}

type FlowStepError { message: String!; count: Int!; lastJobId: ID }
type FlowStepStats {
  stepId: ID!
  waiting: Int!; active: Int!; delayed: Int!; failedNow: Int!   # ao vivo (getJobCounts)
  completed: Int!; failed: Int!; lost: Int!; untraced: Int!; retried: Int!
  throughputPerMin: Float!
  procP50: Float; procP95: Float; waitAvg: Float; waitP95: Float
  failureRate: Float!
  bottleneck: Boolean!
  spark: [Int!]!               # 32 buckets de concluídos na janela
  errors: [FlowStepError!]!    # top 5, lidos do set failed (até 200 jobs), na janela
}
type FlowSummary {
  flowId: ID!; since: Float!
  entries: Int!; done: Int!; errors: Int!; failed: Int!
  e2eAvg: Float; e2eP50: Float; e2eP95: Float
  bottleneck: ID
  coverage: Float              # 1 - untraced / total, null sem eventos
  steps: [FlowStepStats!]!
  edges: [FlowEdgeStats!]!     # declaradas + observadas não declaradas
  checks: [FlowCheck!]!        # dinâmicos: cobertura, lost, aresta não declarada, declarada nunca vista
}
type FlowEdgeStats { from: ID!; to: ID!; count: Int!; declared: Boolean!; waitAvg: Float }

type FlowTraceJob {
  stepId: ID!; queueId: ID!; jobId: ID!; attempt: Int!
  status: JobStatus!
  parentQueueId: ID; parentJobId: ID; parentStepId: ID
  enqueuedAt: Float!; startedAt: Float; finishedAt: Float
  waitMs: Float; processMs: Float
  failedReason: String
  fallback: Boolean!           # entrou por aresta FALLBACK
  pending: Boolean!            # veio da varredura da fronteira
}
type FlowTrace {
  traceId: ID!; key: String; startedAt: Float!; finishedAt: Float; durationMs: Float
  status: FlowTraceStatus!
  jobs: [FlowTraceJob!]!
  longestWait: FlowTraceJob
  truncated: Boolean!          # bateu jobsPerTrace
  partial: Boolean!            # fronteira estourou pendingScanLimit
}
type FlowTraceCandidate { traceId: ID!; startedAt: Float!; status: FlowTraceStatus! }
type FlowTraceResult {
  matchedBy: FlowTraceMatch!
  trace: FlowTrace
  candidates: [FlowTraceCandidate!]!   # busca por chave com mais de uma execução, mais recente primeiro, até 20
  indexFull: Boolean!                  # índice no teto: "pode ser mais antigo que o índice"
}

extend type Query {
  flows: [Flow!]!
  flowSummary(flow: ID!, since: Float): FlowSummary          # null sem collector
  flowTrace(flow: ID!, query: String!, traceId: ID): FlowTraceResult  # null sem collector
}
```

Detalhes:

- **Resolução da busca** (`query` com `trim`, 1..256 chars, senão erro de validação): 1) `traceId` exato no zset `traces`; 2) `jobId`: `getJob` em cada fila distinta do flow (deduplicadas, no máximo 64), o primeiro que tiver `_trace` define o trace (sem `_trace`, devolve o trace implícito da 3.6 se for entrada); 3) chave: `ZRANGEBYLEX traces::keys [query\x00 (query\x01`, ordena por `startedAt` do meta. `traceId` opcional escolhe um candidato.
- **Leitura do trace**: `ZRANGEBYLEX traces::jobs [id\x00 (id\x01`, parse defensivo de cada membro, dedupe por `queueId+jobId` (fica a maior tentativa), + fronteira (4.4).
- **Status do trace**: `COMPLETED` se alguma etapa de `complete` concluiu; `COMPLETED_WITH_FALLBACK` se além disso algum job entrou por aresta `FALLBACK`; `FAILED` se há job `failed` sem filho e nenhuma conclusão; `RUNNING` se há pendente; senão `UNKNOWN`.
- **Gargalo**: etapa com maior `waitAvg` na janela, desempate por `waiting` ao vivo; só marca se `waitAvg >= 1s`.
- **Erros recentes** por etapa: `getJobs(['failed'], 0, 199)` da fila, filtra nome da etapa e `finishedOn >= since`, agrupa pela primeira linha do `failedReason` recortada em 120 chars (`Map`), top 5.
- `returnvalue`, `stacktrace` e `data` do job **não** vêm no trace: a linha expandida (gantt B) chama o `Query.job(queue, id)` existente sob demanda. Mantém a resposta do trace pequena e não abre um segundo caminho de leitura de payload.
- Sem collector: `flows` responde (aba Config), `flowSummary`/`flowTrace` devolvem `null`.
- Args de lista: nenhum. `flow` desconhecido: `null`.

## 6. UI (`packages/ui/src/screens/flows/`)

### 6.1 Roteamento e sidebar

- `TScreen` ganha `'flows'`. Entrada **Flows** (`AccountTree`) na sidebar entre Overview e Agents, visível só quando `Query.flows` não é vazio. Guarda no `switch.tsx` como a de `agents`.
- Flow/Trace exigem `metricsEnabled`; sem collector a tela abre direto em Config com aviso (mesma regra de `history`).
- O grupo da sidebar cujo nome é `flow.group` ganha ícone `account_tree`, fundo destacado e o selo `FLOW · <id>` (no `QueueGroup` atual). Escolher fila na sidebar a partir da tela Flows leva para `jobs` (regra geral; Flows não é exceção como Agents).
- Store `stores/flows.ts` (zustand persistido, padrão de `stores/agents.ts`): flow selecionado, aba, layout por aba (`A`/`B`), etapa selecionada, linha aberta, busca, `traceId` escolhido, job selecionado no trace.

### 6.2 Componentes

| Componente | Conteúdo |
|---|---|
| `index.tsx` | barra de chips de flow, cabeçalho (label, id, "N queues · setup · read only"), abas, busca com botão TRACE (Enter dispara) |
| `FlowTab.tsx` | `Kpis` (5 cartões) + toggle A/B |
| `FlowGraph.tsx` | canvas com nós posicionados por `layoutFlowGraph`, SVG de arestas (bezier, tracejado em condicional/fallback, marcador), rótulos de aresta, tags GARGALO/FALLBACK/ON ERROR, nó `end` tracejado. Reusado pela aba Trace com `highlight` |
| `StepPanel.tsx` | painel da etapa (métricas 2×3, sparkline, erros recentes com link, VER JOBS DA FILA) |
| `FlowTable.tsx` | opção B: tabela indentada (cotovelo por profundidade), barras de throughput e espera (escala log), linha expansível (sparkline, erros, próximas etapas) |
| `TraceTab.tsx` | faixa do trace (id, chave, início, duração, jobs, status, maior espera, CLEAR TRACE), lista de candidatos quando a chave tem várias execuções, avisos `partial`/`truncated`/`indexFull` |
| `TracePath.tsx` | opção A: painel "Caminho do evento" + bloco `_trace` do job escolhido |
| `TraceGantt.tsx` | opção B: eixo com ticks, espera hachurada + processamento, cores ok/falhou/fallback/pendente, linha expansível (`_trace`, timing, returnvalue ou stacktrace via `Query.job`, Abrir job) |
| `ConfigTab.tsx` | definição em YAML com numeração e copiar, convenção `_trace` com exemplo, lista de checks |
| `model.ts` | lógica pura e testada: `layoutFlowGraph` (camadas por caminho mais longo a partir da entrada, ordem por baricentro, fallback deslocado para a coluna ao lado, ON ERROR fora do fluxo principal, `end` como nó pequeno), profundidade da tabela, geometria do gantt, `traceStatus`, ordenação de candidatos |

Sem biblioteca de grafo (mesma escolha do `layoutRunGraph` da 004). Estilo com `makeStyles` e cores via `alpha(theme.palette.*)` (guidelines). Textos vindos de job são texto puro.

### 6.3 Navegação para Jobs

"VER JOBS DA FILA", contagem FAILED, erro recente e "Abrir job" chamam a mesma ação da tela Agents que já leva para `jobs` com fila e status selecionados; "Abrir job" abre o job pelo id (busca por id existente na lista).

### 6.4 Demo (`VITE_ENABLE_MOCKS`)

`demo-mocks/network/flows/`: o flow `content-ingest` com os números do design (constantes `S`, `EDGES`, `ERRORS`, `TRACE` do `05 Flows.dc.html`), um trace `tr_9f2c41e7b0` com fallback, uma busca por videoId com duas execuções e o YAML. Filas `content:*` adicionadas aos mocks de `queues` no grupo `Content`.

## 7. Modelo de ameaças (para o Security validar)

| Superfície | Risco | Controle |
|---|---|---|
| `flowTrace(query)` em rota sem auth | amplificação (varrer filas) | busca exata, sem jsonata nem texto livre; `getJob` só nas filas do flow (dedupe, ≤ 64); fronteira com `pendingScanLimit`; `query` ≤ 256 |
| `_trace` lido do Redis (escrito por app) | NaN em `Int!`, prototype pollution, strings gigantes | parse por campo, `Map`/`Object.create(null)`, `hasOwnProperty.call`, recortes na leitura (o leitor não confia no escritor) |
| `trace.key` e `trace.field` (caminho com pontos) | acesso a `__proto__`/`constructor` | getter próprio que rejeita esses segmentos e só segue own properties |
| Chave de negócio guardada no índice | PII se o app escolher e-mail/CPF como chave | doc: chave deve ser id interno; recorte 128; some no despejo; `clear` apaga. Security decide se exige opção de hash |
| Tela de trace | XSS por `failedReason`/ids | texto puro, nada de HTML/markdown |
| Helper no worker | derrubar job | nunca lança, sem I/O |
| `continueTrace` no webhook do app | trace forjado vindo de fora | validado como entrada não confiável, sem assinatura de propósito (observabilidade, não autorização); pior caso é um trace errado no painel |
| `/metrics` Prometheus | topologia/chaves como label | fora (D10) |

Sem mudança de mount nos adapters: não reabre a regra de mount-order do ADR-001. A aba nova só lê; nenhuma mutation.

## 7.1 Ajustes pós-QA (2026-10-16, decisões do Architect sobre `qa-report-backend.md`)

- **G1**: todo evento de falha é final (nem Bull nem BullMQ emitem falha para tentativa que vai ter retry). O filtro "tentativas restantes" do collector saiu; `discard()`, `UnrecoverableError`, backoff `-1` e stalled contam como falha definitiva nos agregados e no índice. A numeração de tentativa continua em `shared/attempt.ts`.
- **G2**: a varredura de pendentes cobre todas as etapas do flow (§4.4 atualizado), com o mesmo teto por fila. `COMPLETED` exige zero pendentes no trace.
- **G3**: a aresta de qualquer etapa para a etapa `onError` é implicitamente declarada (tipo onError): sai como `declared: true` em `FlowSummary.edges` e não gera `undeclared-edge`. Não entra em `Flow.edges` nem em `unseen-edge` (sem mudança de schema).
- **G4**: busca por trace id sem nada no índice (trace aberto, sem evento terminal) cai na varredura limitada de pendentes, comparando `_trace.traceId`, antes de responder `NONE`. Roda depois das buscas por job id e por chave.
- **Pós-Security (S1/S2/S4)**: passo 4 só para id no formato `tr_`+16 hex ou com `traceId` explícito; `flowTrace` memoizado por request, no máximo 2 varreduras por request e 2000 jobs lidos por varredura (além dos 500 por fila); o score do zset `traces` é a hora de ingestão (não `startedAt`, que fica no meta para exibição, recortado a agora + 5 min); o teto `jobsPerTrace` conta a faixa inteira do trace menos os marcadores.

## 8. Fatiamento para o Tech Lead

Numeração para o `tasks.md`. P1 = caminho crítico do piloto; P2 = completa o design.

| ID | Prio | Task | Depende |
|---|---|---|---|
| T001 | P1 | `flow/contract.ts` + `flow/definition.ts`: tipos `FlowConfig`/`FlowTraceV1`, `normalizeFlows` com checks, getter de caminho seguro. Testes de config inválida (nunca lança) | |
| T002 | P1 | `flow/trace.ts`: `startTrace` (com `parent`), `withTrace`, `readTrace`, `encodeTrace`, `continueTrace`; mover cálculo de tentativa para `shared/attempt.ts` (+ `terminalAttempts`). Testes: Bull 3, BullMQ 1, BullMQ 5, sandbox sem `queue`, data não-objeto, hop 64, pai sem trace, `onError` que lança | |
| T003 | P1 | `Config.flows`/`flowsOptions` no `BullMonitor`, exports no `index.ts` | T001 |
| T004 | P1 | Extrair `histogramQuantile` para `metrics/histogram.ts` (refactor puro, testes do agente verdes) e o fetch único do job no `MetricsCollector` | |
| T005 | P1 | `metrics/flow-metrics.ts`: ingestão por evento terminal, ponto `TFlowPoint`, série `::flow`, `lost`/`untraced`/`retried`, arestas, fim a fim. Testes com FakeRedis (inclui `zrangebylex`) | T001, T002, T004 |
| T006 | P1 | Índice de traces (4.3): escrita em `MULTI`, teto por trace, despejo sem órfão, `clear`/`clearAll`. Teste de despejo que confere que nenhuma chave/membro sobra | T005 |
| T007 | P1 | GraphQL `flows` + `flowSummary` (stats por etapa, KPIs, gargalo, erros recentes, checks dinâmicos) | T003, T005 |
| T008 | P1 | GraphQL `flowTrace`: resolução trace id / job id / chave, candidatos, fronteira pendente, status do trace | T006, T007 |
| T009 | P1 | Codegen + `typings/gql.ts` (root e ui) pelo caminho documentado na 004 | T007, T008 |
| T010 | P1 | UI: rota `flows`, sidebar (entrada + selo FLOW no grupo), store, cabeçalho, busca, aba Config | T009 |
| T011 | P1 | UI: aba Flow opção A (`layoutFlowGraph`, `FlowGraph`, `StepPanel`, KPIs) + testes do `model.ts` | T010 |
| T012 | P1 | UI: aba Trace opção A (grafo com caminho + `TracePath`) | T011 |
| T013 | P2 | UI: aba Flow opção B (`FlowTable`) | T011 |
| T014 | P2 | UI: aba Trace opção B (`TraceGantt` com expansão via `Query.job`) | T012 |
| T015 | P1 | Demo mocks `content-ingest` | T010 |
| T016 | P1 | `docs/flows.md` (contrato, setup, retenção, limites) + extensão da skill `skills/bull-horizon` (referência `flows.md`, troubleshooting) | T002, T008 |
| T017 | P1 | Security review (`security-review.md` na 005) | T008, T012 |
| T018 | P1 | Vyral (repo da Vyral, fora deste repo): declarar flows, `startTrace` nas entradas, `withTrace` nos `add`, retenção numérica, conferir a validação. Lista exata em `vyral-flows.md` §5 | T003, T016, publicação beta |
| T019 | P2 | Changeset (`minor`) + skill de exemplo com o flow da Vyral anonimizado | T016 |

Ordem sugerida: T001–T004 em paralelo, T005–T009, T010–T012 + T015 (piloto visível), T016–T018, depois T013/T014/T019.
