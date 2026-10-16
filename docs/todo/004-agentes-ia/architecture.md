# Arquitetura 004: Agentes IA

**Status:** 🏛️ Desenho fechado pelo Architect, aguardando Tech Lead
**Data:** 2026-10-15
**Entrada:** `spec.md` (PO) + `design/06 Agentes IA.dc.html` (Run A, Run B, Métricas A, Métricas B)
**ADR:** ADR-004 em `memorys/architecture.md`
**Ameaças:** `threat-model.md` (Security valida antes do release)

## 0. Resumo das decisões

| Tema | Decisão |
|---|---|
| Onde o run vive | **Uma linha estruturada em `job.log`** por tentativa, com prefixo fixo. Funciona em sucesso, falha e retry, em Bull v3/v4 e BullMQ. |
| Contrato | `AgentRunV1` = `AiTrace` v1 do brand + campos opcionais (`detail`, `input`, `tool.empty`, `tool.startedAt`, `tool.outputChars`, `truncated`). Payload atual do brand continua válido. |
| Corte de detalhe | No helper, no processo do app, antes do `job.log`. O servidor corta de novo ao servir (defesa em profundidade). |
| Config | `ai` por fila no `BullAdapter`/`BullMQAdapter` (ao lado de `group`) + `ai.pricing` global no `Config`. |
| Helper | `createAgentRun()` exportado por `@bull-horizon/root`, módulo `src/agent/` sem dependências, nunca lança nem rejeita. |
| Agregados | Collector ouve `completed`/`failed` (já existentes), lê as linhas de run do job, deduplica por `ZADD NX` e acumula numa série própria com a mesma retenção em camadas. |
| Latência | Histograma de faixas fixas (mesclável por soma), p50/p95 estimados na leitura. Sem dependência nova. |
| Custo | Calculado **na leitura** a partir dos tokens por modelo e da tabela do setup. Sem preço = `null`, nunca `0`. |
| UI | Tela nova `agents` na sidebar (só com fila de agente). Run abre a partir do job (ação na linha) e da lista de runs. |

## 1. Contrato v1 do run

### 1.1 Tipos (exportados de `@bull-horizon/root`)

```ts
export const AGENT_RUN_VERSION = 1;
/** Prefixo da linha de log que carrega o run. Tudo depois dele é JSON. */
export const AGENT_RUN_LOG_PREFIX = 'bull-horizon:agent-run ';

export type AgentRunDetail = 'full' | 'basic';

export interface AgentRunTool {
  name: string;
  ok: boolean;
  durationMs: number;
  /** Resumo curto e sem conteúdo (ex.: "8 results"). Sempre presente. */
  summary: string;
  /** Novo. Tool respondeu sem resultado útil (lista vazia, null, {}). */
  empty?: boolean;
  /** Novo. ISO; o helper calcula como fim - durationMs. Posiciona a barra no waterfall. */
  startedAt?: string;
  /** Novo. Tamanho do JSON da saída, em caracteres. Seguro no basic. */
  outputChars?: number;
  /** full. Entrada da tool, truncada (ver § 1.3). */
  input?: unknown;
  /** full. Saída da tool, ou { truncated: true, chars, preview } acima do teto. */
  output?: unknown;
  /** full. Mensagem de erro da tool, truncada. */
  error?: string;
}

export interface AgentRunStep {
  /** 1, 2, 3... */
  step: number;
  startedAt: string;
  durationMs: number | null;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** full. Texto que o modelo escreveu no passo, truncado. */
  text?: string;
  tools: AgentRunTool[];
}

export interface AgentRunCard {
  type: string;
  title: string;
}

export interface AgentRunV1 {
  v: 1;
  /** Novo. Nível aplicado na gravação. Ausente = payload legado, tratado como 'full'. */
  detail?: AgentRunDetail;
  model: string;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  steps: AgentRunStep[];
  /** Resposta final. `text` só no full; `cards` (tipo + título) nos dois níveis. */
  final: { text?: string; cards: AgentRunCard[] } | null;
  /** Erro da tentativa, truncado em 500. Presente nos dois níveis (ver threat-model § 4). */
  error: string | null;
  /** Novo, reservado para a aba Conversa. `text` só no full. */
  input?: { conversationId?: string; text?: string };
  /** Novo. O helper degradou o run para caber no teto de bytes (§ 1.3). */
  truncated?: boolean;
}
```

**Compatibilidade com o brand:** todos os campos do `AiTrace` v1 mantêm nome e tipo. Os novos são opcionais e os que viraram opcionais (`text`, `input`, `output`) continuam aceitos quando presentes. Um `AiTrace` gravado hoje no banco do brand é um `AgentRunV1` válido.

### 1.2 O que cada nível mantém

| Campo | `basic` | `full` |
|---|---|---|
| `v`, `detail`, `model`, `attempt`, tempos, tokens (run e passo), `finishReason` | sim | sim |
| `steps[].text` | **não** | sim |
| `tools[].name/ok/durationMs/summary/empty/startedAt/outputChars` | sim | sim |
| `tools[].input`, `tools[].output` | **não** | sim |
| `tools[].error` | **não** (fica `ok: false` + `summary`) | sim |
| `final.cards` (tipo + título) | sim | sim |
| `final.text` | **não** | sim |
| `error` (run) | sim | sim |
| `input.conversationId` | sim | sim |
| `input.text` | **não** | sim |

Os campos cortados são **omitidos** (chave ausente), não preenchidos com `''` ou `null`. A UI distingue "vazio" de "não gravado neste nível" pelo `detail`.

Default do nível: **`basic`**. Quem quiser `full` declara.

### 1.3 Tetos (no helper)

| Item | Teto | Igual ao brand |
|---|---|---|
| `tools[].output` | 2048 chars de JSON, acima vira `{ truncated, chars, preview }` | sim (`TRACE_OUTPUT_MAX`) |
| `tools[].input` | 2048 chars, mesmo formato | novo |
| `steps[].text`, `final.text`, `input.text` | 4000 chars | sim (`TRACE_TEXT_MAX`) |
| `error` (run) / `tools[].error` | 500 / 200 chars | sim / novo |
| `summary` | 120 chars | novo |
| passos / tools por passo / cards | 50 / 50 / 20 | novo |
| linha inteira | **64 KB** | novo |

Acima de 64 KB o helper degrada nesta ordem, até caber: remove `output` das tools, depois `input`, depois os textos. Marca `truncated: true`. Se ainda não couber, grava só o esqueleto `basic`.

### 1.4 Derivados (servidor, não fazem parte do contrato)

- `finishReason` do run = o do último passo.
- `outcome`: `error` se `error != null`; `max-steps` se o último passo terminou em `tool-calls` (o loop parou com o modelo ainda pedindo tool); senão o `finishReason` do último passo (`stop`, `length`, `content-filter`...), `unknown` se nulo.
- `cost` (run e passo): `(in * preço.input + out * preço.output) / 1e6`, `null` sem preço.
- `overheadStartMs` = `trace.startedAt - job.processedOn` e `overheadEndMs` = `job.finishedOn - trace.finishedAt` (nós `request`/`response` do design). Só para a **última** tentativa: `processedOn` é sobrescrito a cada tentativa. Nas anteriores, `null`.
- Nó `request` do grafo: `job.data` (já está no Redis em qualquer nível) + `model`, `attempt`, `input.conversationId`.

### 1.5 Exemplo real (`basic`, run `fa1809e7` do design)

```text
bull-horizon:agent-run {"v":1,"detail":"basic","model":"gemini-3.8-flash","attempt":1,
"startedAt":"2026-10-14T19:05:28.514Z","finishedAt":"2026-10-14T19:05:43.328Z","durationMs":14814,
"inputTokens":9534,"outputTokens":1057,"input":{"conversationId":"c-7f21"},
"steps":[
 {"step":1,"startedAt":"2026-10-14T19:05:28.567Z","durationMs":4086,"finishReason":"tool-calls","inputTokens":2788,"outputTokens":154,
  "tools":[{"name":"listRecipes","ok":true,"durationMs":55,"summary":"0 resultados","empty":true,"startedAt":"2026-10-14T19:05:32.594Z","outputChars":14}]},
 {"step":2,"startedAt":"2026-10-14T19:05:32.657Z","durationMs":7219,"finishReason":"tool-calls","inputTokens":2962,"outputTokens":774,
  "tools":[{"name":"proposeRecipe","ok":true,"durationMs":0,"summary":"objeto (ok, message)","empty":false,"startedAt":"2026-10-14T19:05:39.876Z","outputChars":79}]},
 {"step":3,"startedAt":"2026-10-14T19:05:39.879Z","durationMs":3431,"finishReason":"stop","inputTokens":3784,"outputTokens":129,"tools":[]}],
"final":{"cards":[{"type":"RECIPE","title":"Crepioca recheada"}]},"error":null}
```

(Quebras de linha só para leitura; a linha real é um JSON único.) O mesmo run em `full` acrescenta `steps[].text`, `tools[].input/output`, `final.text` e `input.text`.

## 2. Onde o run vive no job

| Opção | Bull v3/v4 | BullMQ | Problema |
|---|---|---|---|
| `returnvalue` | só no `completed` | só no `completed` | Tentativa que relança o erro não grava nada. O brand não retorna valor. **Descartada.** |
| `job.update(data)` com chave reservada | substitui `data` inteiro | idem | Read-modify-write sobre o payload do app (corrida com quem também atualiza), polui busca jsonata, o modal "editar data" pode apagar o run, e o payload de retry carrega o run anterior. **Descartada.** |
| Chave Redis própria por job/tentativa | precisa do client + id da fila no helper | idem (client é `Promise`) | Ciclo de vida desacoplado do job (órfãs após `removeOnComplete`, exige TTL), helper acoplado ao esquema de chaves do monitor, não funciona em processor sandboxed do Bull (o job é um proxy sem client). **Descartada.** |
| **Linha estruturada em `job.log`** | `RPUSH <job>:logs` | `RPUSH <job>:logs` | Linha grande no modal de Logs (a UI colapsa) e some com `removeOnComplete: true` (vale para qualquer opção ligada ao job). **Escolhida.** |

Por que `job.log`:
- Cada tentativa anexa a sua linha. Falha, retry e sucesso convivem na mesma lista, em ordem. Atende a regra 4 da spec sem depender do estado do job.
- API idêntica nas duas libs (`job.log(row): Promise`), e o Bull v3 já repassa `log` no processor sandboxed (`lib/process/sandbox.js`).
- Ciclo de vida do job: some quando o job some. Sem órfãs nem TTL.
- O brand já escreve em `job.log` por esse mesmo caminho (`jobTraceSink`).

Regras de leitura:
- Uma linha é run quando começa com `AGENT_RUN_LOG_PREFIX`. O resto é JSON, validado por um guard de forma (`v === 1`, `steps` array, tipos numéricos). Linha inválida é ignorada, nunca derruba a query.
- Leitura limitada: `getJobLogs(jobId, -200, -1)` (o helper grava a linha do run **por último** na tentativa, então ela está na cauda). `Queue.getJobLogs` ganha `start?/end?` opcionais nos dois adapters (as duas libs já aceitam).
- Linhas acima de 512 KB são ignoradas pelo parser (teto de leitura, independente do teto de escrita).

**Requisito de integração a documentar:** fila de agente não pode usar `removeOnComplete: true` / `removeOnFail: true` (remove o job, e os logs, no mesmo script que emite o evento). Número (`500`, como o brand) ou idade servem. O collector conta esses casos como `lost` e a UI mostra o aviso.

## 3. Config do setup

### 3.1 Por fila (`packages/root/src/queue.ts`)

```ts
export type AgentQueueConfig = {
  /**
   * Nomes de job tratados como run. Omitido = todos os jobs da fila.
   * Ex.: brand-app:ai tem `reply` (agente) e `translate-exercises` (não).
   */
  jobs?: string[];
  /** Nível gravado pelo helper. Default 'basic'. */
  detail?: AgentRunDetail;
  /** Nome do agente na tela Agents. Default: nome da fila. */
  label?: string;
};

export type QueueConfig = {
  readonly?: boolean;
  group?: string;
  /** `true` = todos os jobs, nível basic. */
  ai?: AgentQueueConfig | boolean;
};
```

`Queue` ganha `get agent(): Maybe<Required<Pick<AgentQueueConfig,'detail'>> & AgentQueueConfig>` (normalizado, `undefined` fora de fila de agente) e `isAgentJob(name: string): boolean`. Os dois adapters herdam sem mudança além do tipo.

### 3.2 Global (`packages/root/src/typings/config.ts`)

```ts
/** USD por 1 milhão de tokens. */
export type AgentModelPrice = { input: number; output: number };

export type AgentsConfig = {
  /** Chave = nome do modelo como gravado no run (comparação exata, case-insensitive). */
  pricing?: Record<string, AgentModelPrice>;
  /** Tamanho do índice de runs recentes por fila (Métricas B). Default 2000. */
  recentRuns?: number;
};

export type Config = {
  // ...existentes
  ai?: AgentsConfig;
};
```

`typings/config.ts` hoje tem um `QueueConfig` duplicado e desatualizado (só `readonly`). Remover e reexportar o de `queue.ts`.

### 3.3 Uso (brand)

```ts
// ai-queue.constants.ts, compartilhado entre monitor e worker
export const AI_AGENT: AgentQueueConfig = { jobs: ['reply'], detail: 'basic', label: 'Assistentes' };

// bull-monitor.service.ts
new BullAdapter(queue, { group: QUEUE_GROUPS[queue.name], ai: queue.name === AI_QUEUE ? AI_AGENT : undefined });
super({ queues, metrics: {...}, ai: { pricing: { 'gemini-3.8-flash': { input: 0.75, output: 3.75 } } } });
```

O nível vale **onde o helper roda**. Por isso o mesmo objeto (`AI_AGENT`) é passado ao adapter e ao helper. O adapter usa o `detail` para cortar de novo ao servir e para avisar quando o run gravado tem mais detalhe que o declarado (`detailMismatch`).

## 4. Helper (`packages/root/src/agent/`)

### 4.1 Pacote e isolamento

- Exportado do índice de `@bull-horizon/root` (o brand já depende dele). Nenhum pacote novo neste ciclo.
- `src/agent/*` **não importa** nada de `gql/`, `metrics-collector`, `main`, nem libs de terceiros. Tipos do AI SDK são estruturais (duck typing), sem dependência de `ai`. Isso deixa o módulo extraível para um `@bull-horizon/agent` depois, se o custo de importar o root no worker incomodar.
- Arquivos: `contract.ts` (tipos, constantes, `parseAgentRunLine`, `isAgentRunV1`), `detail.ts` (`applyAgentRunDetail`), `limits.ts`, `summarize.ts` (resumo e `empty` default), `recorder.ts`, `index.ts`.

### 4.2 API

```ts
/** O mínimo que o helper usa do job. Bull Job e BullMQ Job satisfazem. */
export interface AgentRunJobLike {
  attemptsMade: number;
  log(row: string): Promise<unknown>;
}

export type AgentRunEvent =
  | { type: 'start'; run: AgentRunV1 }
  | { type: 'step-finish'; step: AgentRunStep; run: AgentRunV1 }
  | { type: 'tool'; step: number; tool: AgentRunTool; run: AgentRunV1 }
  | { type: 'finish'; run: AgentRunV1 }
  | { type: 'fail'; run: AgentRunV1 };

export interface CreateAgentRunOptions {
  job: AgentRunJobLike;
  model: string;
  /** Fonte do nível. `detail` explícito vence. Default 'basic'. */
  agent?: AgentQueueConfig;
  detail?: AgentRunDetail;
  /** Default job.attemptsMade + 1. */
  attempt?: number;
  input?: { conversationId?: string; text?: string };
  /** Resumo da saída de uma tool. Default genérico, sem conteúdo (§ 4.4). */
  summarize?: (tool: string, output: unknown) => string;
  /** Tool sem resultado. Default § 4.4. */
  isEmpty?: (tool: string, output: unknown) => boolean;
  /** Hook síncrono por evento (o brand monta as linhas pt-BR e o progress aqui). Erros são engolidos. */
  onEvent?: (event: AgentRunEvent) => void;
  /** Diagnóstico de falhas internas do helper (Redis fora, JSON inválido). Nunca relança. */
  onError?: (err: unknown) => void;
  limits?: Partial<AgentRunLimits>;
  now?: () => Date;
}

export interface AgentRunRecorder {
  /**
   * Run completo (com tetos, SEM corte de nível), para o app guardar onde quiser.
   * O brand continua gravando isto em ai_messages.trace. Ao Redis vai só o corte.
   */
  readonly run: AgentRunV1;
  /** experimental_onStepStart. stepNumber 0-based do SDK. */
  stepStart(stepNumber?: number): void;
  /** onStepFinish. */
  stepFinish(event: {
    stepNumber?: number;
    finishReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    text?: string;
  }): void;
  /** experimental_onToolCallFinish (já normalizado, como no brand). */
  tool(event: {
    stepNumber?: number;
    name: string;
    input: unknown;
    durationMs: number;
    success: boolean;
    output?: unknown;
    error?: unknown;
  }): void;
  /** Fecha o run com sucesso e grava a linha. Resolve depois do job.log. Nunca rejeita. */
  finish(text: string, cards?: AgentRunCard[]): Promise<void>;
  /** Fecha o run com erro e grava a linha. Resolve depois do job.log. Nunca rejeita. */
  fail(err: unknown): Promise<void>;
  /** Linha livre no log do job (texto puro, fire-and-forget). */
  note(line: string): void;
}

export function createAgentRun(options: CreateAgentRunOptions): AgentRunRecorder;
export function applyAgentRunDetail(run: AgentRunV1, detail: AgentRunDetail): AgentRunV1;
export function parseAgentRunLine(line: string): AgentRunV1 | null;
```

Comportamento:
- Só `finish`/`fail` escrevem o run no Redis: **uma** linha por tentativa, no fim. Sem escrita por passo (economiza RTT e mantém a linha na cauda).
- `finish` e `fail` são idempotentes: a segunda chamada é ignorada. Se o app não chamar nenhum dos dois (crash do processo), não há linha. A tentativa aparece como job sem run.
- `finish`/`fail` devolvem `Promise<void>` que **nunca rejeita**. Recomendação documentada: `await recorder.finish(...)` antes de o processor retornar, para a linha chegar antes do evento `completed`. Quem chama sem `await` (o brand hoje) continua funcionando: o collector tenta de novo uma vez se não achar a linha da última tentativa (§ 5.2).
- `ensureStep` com a mesma semântica do brand (passo criado sob demanda, `stepNumber` 0-based vira `step` 1-based).
- `tool.startedAt` = `now() - durationMs` no momento do `tool()`.

### 4.3 Regra "nunca lança"

Todo método público é envolto em `try/catch`. Toda escrita é `.catch(onError)`. `onEvent`, `summarize` e `isEmpty` do usuário também rodam protegidos (resumo que lança vira `'?'`, `isEmpty` que lança vira `undefined`). `JSON.stringify` com referência circular cai no fallback `String(value)`. Teste obrigatório: job cujo `log` lança síncrono, rejeita, ou nunca resolve não altera o retorno do processor. Regra registrada em `memorys/guidelines.md`.

### 4.4 Defaults genéricos (sem conteúdo)

- `summarize`: `null/undefined` → `"no output"`; array → `"N results"`; objeto com uma lista → `"N results"`; várias listas → `"a: N, b: M"`; `ok === false` → `"refused"`; senão `"object (k1, k2, ...)"` (só as 5 primeiras chaves); primitivo → `"string (N chars)"` / `"number"` / `"boolean"`. **Nunca o valor.** O default do brand (`clip(String(output), 80)` para primitivo) vaza conteúdo e não é copiado.
- `isEmpty`: `null/undefined`, `[]`, `{}`, ou objeto cujas listas são todas vazias.
- O brand passa os seus (`summarizeOutput` pt-BR) e mantém o `getHealthSummary` sem conteúdo.

### 4.5 Migração do brand (fora deste repo, task do brand)

`TraceRecorder` vira um wrapper fino: cria `createAgentRun({ job, model, agent: AI_AGENT, summarize: summarizeOutput, onEvent })`, o `onEvent` emite as linhas pt-BR atuais e o `progress`. `trace.trace` passa a ser `recorder.run`. `AiTrace` vira alias de `AgentRunV1`. `jobTraceSink` continua só para as linhas humanas.

## 5. Collector

### 5.1 Arquivos

- Extrair de `metrics-collector.ts` a mecânica de camadas (append no raw, rollup tail read-modify-write, `_tierFor`, slice de cauda com alargamento) para `metrics/tiered-series.ts`, genérica sobre `TPoint` + função de merge. O throughput passa a usá-la sem mudar chave nem formato. **Refactor puro, coberto pelos testes existentes antes de qualquer código de agente.**
- Agentes em `metrics/agent-metrics.ts`, composto pelo `MetricsCollector` (que hoje tem 589 linhas e não deve crescer).

### 5.2 Fonte do evento

Os hooks `onGlobalJobCompletion` e `onGlobalJobFailure` que já existem. Para fila com `agent` e job com `isAgentJob(name)`:

1. `getJob(id)`. Nulo → `lost++` no acumulador do tick e fim.
2. `getJobLogs(id, -200, -1)`, filtra prefixo, `parseAgentRunLine`, aplica o `detail` da fila.
3. Se nenhuma linha nova aparecer (helper chamado sem `await`, linha ainda a caminho), agenda **uma** releitura em 2 s. Não depende de aritmética de `attemptsMade`, que difere entre Bull e BullMQ no `completed`.
4. Para cada run achado: `ZADD NX` no índice com membro `${jobId}:${attempt}:${startedAtMs}`. Retorno `0` = já ingerido, pula. Retorno `1` = acumula no tick e grava a entrada do índice.

Por que eventos terminais e não escrita do helper: o BullMQ emite `failed` no `QueueEvents` só na falha final (o retry não emite), e o Bull só publica `global:failed` ao mover para `failed`. Ler **todas** as linhas na hora do evento terminal cobre as tentativas intermediárias sem depender disso. O `ZADD NX` torna a ingestão idempotente: retry manual pelo painel, evento duplicado e **várias réplicas do monitor** não contam duas vezes (o throughput atual não tem essa proteção; não é escopo corrigir aqui).

Limitações a comunicar, não esconder: só conta com o monitor vivo; tentativas intermediárias entram no bucket do evento terminal, não no da hora em que rodaram (diferença de até `backoff`, segundos no brand).

### 5.3 Ponto da série de agentes

```ts
/** Faixas do histograma de latência, ms. Índice length = overflow. Mudar exige `h` novo. */
export const AGENT_LATENCY_BOUNDS_MS = [
  500, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12500, 15000,
  20000, 25000, 30000, 40000, 60000, 90000, 120000, 180000, 300000,
];

export type TAgentPoint = {
  timestamp: number;
  windowMs: number;
  h: 1;                 // versão das faixas
  runs: number;
  failed: number;       // error != null
  lost: number;         // job removido antes da leitura
  emptyRuns: number;    // runs com ao menos uma tool vazia
  durSum: number;
  durMax: number;
  lat: number[];        // contagem por faixa (21 posições)
  llmMs: number;        // soma de (step.durationMs - tools do passo)
  toolMs: number;
  steps: number[];      // [1, 2, 3, 4, 5+]
  outcomes: Record<string, number>;
  tools: Record<string, { c: number; e: number; z: number; ms: number }>; // calls, errors, empty, soma ms
  models: Record<string, { r: number; i: number; o: number }>;             // runs, tokens in, out
};
```

- Merge: soma em tudo, `max` em `durMax`, soma posição a posição nos arrays, união dos records somando.
- Cardinalidade: no máximo 50 tools e 20 modelos por ponto. O excedente vai para a chave `(other)`. Limita o ponto a ~2 KB.
- Ponto só é gravado no tick se `runs + lost > 0` (série esparsa). O slice de cauda continua correto: lista menos densa que a estimativa só faz o slice cobrir mais tempo, e o filtro por `timestamp` corta.
- Percentil: acumula as faixas até `q * total`, interpola linear dentro da faixa. Faixa de overflow devolve `durMax`. Erro máximo = largura da faixa (documentar na UI como "aprox.").
- Custo de Redis: ~2 KB por ponto com runs. Pior caso (run em todo minuto) ~9 MB por fila de agente no raw de 3 dias + ~2 MB nas camadas. Aceito; filas de agente são poucas. Registrado no ADR.

### 5.4 Chaves

| Chave | Tipo | Conteúdo |
|---|---|---|
| `<redisPrefix><queueId>::ai` | list | série raw de `TAgentPoint` |
| `<redisPrefix><queueId>::ai::r<everyMs>` | list | camadas, mesmas de `retention.rollups` |
| `<redisPrefix><queueId>::ai::runs` | zset | score = `finishedAt` ms, membro = `jobId:attempt:startedAtMs` |
| `<redisPrefix><queueId>::ai::runs::data` | hash | membro → `TAgentRunIndexEntry` JSON |

Mesmo prefixo do throughput (`bull_monitor::metrics::`), sem versionar. `clear(queue)`/`clearAll()` apagam também as quatro. Trim do índice após cada inserção: `ZREMRANGEBYRANK 0 -(recentRuns+1)` e `HDEL` dos membros removidos, no mesmo `MULTI`.

```ts
export type TAgentRunIndexEntry = {
  j: string; a: number; n: string;      // jobId, attempt, job name
  t: number; d: number | null;          // finishedAt ms, durationMs
  m: string; s: number;                 // model, steps
  i: number; o: number;                 // tokens
  oc: string;                           // outcome
  tc: [string, 0 | 1, 0 | 1][];         // cadeia: [tool, ok, empty], até 30
  e?: string;                           // error, 200 chars
};
```

O índice é sempre de nível basic, qualquer que seja o `detail` da fila.

## 6. GraphQL

Novo arquivo `gql/type-defs/agents.ts`, resolvers em `gql/resolvers/agents.ts`, data source `gql/data-sources/agents/` (lê logs via `BullDataSource` para run, e o collector para agregados). JSON livre segue o padrão atual (`String` com JSON, como `Job.data`).

```graphql
enum AgentRunDetail { full basic }

type AgentQueueConfig {
  jobs: [String!]
  detail: AgentRunDetail!
  label: String!
}

extend type Queue {
  "Null quando a fila não é de agente."
  agent: AgentQueueConfig
}

type AgentRunTool {
  name: String!
  ok: Boolean!
  durationMs: Float!
  summary: String!
  empty: Boolean
  startedAt: String
  outputChars: Int
  input: String     # JSON, só full
  output: String    # JSON, só full
  error: String     # só full
}

type AgentRunStep {
  step: Int!
  startedAt: String!
  durationMs: Float
  finishReason: String
  inputTokens: Int
  outputTokens: Int
  cost: Float       # null = sem preço
  text: String      # só full
  tools: [AgentRunTool!]!
}

type AgentRunCard { type: String! title: String! }
type AgentRunFinal { text: String cards: [AgentRunCard!]! }
type AgentRunInput { conversationId: String text: String }

type AgentRun {
  v: Int!
  detail: AgentRunDetail!
  "O run gravado tinha mais detalhe que o declarado na fila; o servidor cortou."
  detailMismatch: Boolean!
  model: String!
  attempt: Int!
  startedAt: String!
  finishedAt: String
  durationMs: Float
  inputTokens: Int!
  outputTokens: Int!
  finishReason: String
  outcome: String!
  cost: Float
  overheadStartMs: Float
  overheadEndMs: Float
  steps: [AgentRunStep!]!
  final: AgentRunFinal
  error: String
  input: AgentRunInput
  truncated: Boolean!
}

extend type Job {
  "Um por tentativa, em ordem. Vazio fora de fila/job de agente. Resolvido sob demanda."
  agentRuns: [AgentRun!]!
}

type AgentLatencyPoint {
  timestamp: Float!
  windowMs: Float!
  runs: Int!
  failed: Int!
  p50: Float
  p95: Float
}
type AgentStepsBucket { label: String! count: Int! }
type AgentToolStats {
  name: String!
  calls: Int!
  avgDurationMs: Float!
  errorRate: Float!
  emptyRate: Float!
}
type AgentModelStats {
  model: String!
  runs: Int!
  inputTokens: Float!
  outputTokens: Float!
  "Null = modelo sem preço na config."
  cost: Float
}
type AgentOutcomeCount { outcome: String! count: Int! }

type AgentsSummary {
  runs: Int!
  failed: Int!
  lost: Int!
  p50: Float
  p95: Float
  avgDurationMs: Float
  "Fração do tempo em passos LLM (llmMs / (llmMs + toolMs))."
  llmShare: Float
  inputTokens: Float!
  outputTokens: Float!
  "Soma dos modelos com preço. Null se nenhum tiver."
  cost: Float
  "Algum modelo da janela está sem preço."
  hasUnpricedModels: Boolean!
  avgSteps: Float
  runsWithEmptyTool: Int!
  latency: [AgentLatencyPoint!]!
  steps: [AgentStepsBucket!]!
  tools: [AgentToolStats!]!
  models: [AgentModelStats!]!
  outcomes: [AgentOutcomeCount!]!
}

enum AgentRunsFilter { all failed emptyTool slow }
enum AgentRunsSort { recent slowest costliest }

type AgentRunToolLink { name: String! ok: Boolean! empty: Boolean! }
type AgentRunListItem {
  queue: ID!
  jobId: ID!
  jobName: String!
  attempt: Int!
  finishedAt: Float!
  durationMs: Float
  model: String!
  steps: Int!
  inputTokens: Int!
  outputTokens: Int!
  cost: Float
  outcome: String!
  tools: [AgentRunToolLink!]!
  error: String
}
type AgentRunsPage {
  total: Int!
  "Contagem por filtro na mesma janela, para os chips."
  counts: AgentRunsCounts!
  items: [AgentRunListItem!]!
}
type AgentRunsCounts { all: Int! failed: Int! emptyTool: Int! slow: Int! }

extend type Query {
  "Run de uma tentativa. Sem attempt = última."
  agentRun(queue: ID!, jobId: ID!, attempt: Int): AgentRun
  "queues vazio/omitido = todas as filas de agente. until permite a janela anterior (comparativo)."
  agentsSummary(queues: [ID!], since: Float!, until: Float, maxPoints: Int): AgentsSummary
  agentRuns(
    queues: [ID!]
    since: Float!
    filter: AgentRunsFilter = all
    "Limiar do filtro slow. Default 15000."
    slowMs: Float = 15000
    sort: AgentRunsSort = recent
    offset: Int = 0
    limit: Int = 50
  ): AgentRunsPage
}
```

- `agentsSummary`/`agentRuns` exigem o collector (erro `NO_COLLECTOR`, mesma regra das métricas). `agentRun` e `Job.agentRuns` funcionam sem collector (leem o log).
- `agentRuns` lê `ZREVRANGEBYSCORE since +inf` (no máximo `recentRuns` por fila), `HMGET` das entradas, filtra/ordena/pagina em memória. `costliest` põe sem preço por último.
- Custo sempre no servidor, a partir de `config.ai.pricing`. A UI nunca conhece preço.
- Tipos novos entram no codegen da UI (`packages/ui`) e nos mocks.

## 7. UI

### 7.1 Roteamento

- `TScreen` ganha `'agents'`. `ScreenNav` mostra **Agents** só quando `queues.some(q => q.agent)`. Não é `needsMetrics`: sem collector a tela existe, mas só com o Run.
- Store novo `stores/agents.ts` (zustand, persist só de `view`, `runLayout`, `range`):

```ts
type TAgentsView = 'metrics' | 'runs' | 'run';
type TAgentsState = {
  view: TAgentsView;
  queue: string | null;          // null = todas as filas de agente
  run: { queue: string; jobId: string; attempt?: number } | null;
  runLayout: 'graph' | 'waterfall';
  range: string;                 // do time-range.ts existente
  backTo: 'jobs' | 'runs';
  openRun(run, backTo): void;    // seta run + view 'run' + changeScreen('agents')
};
```

- Tela `screens/agents/`: cabeçalho com seletor de fila e abas **Metrics** | **Runs** (Métricas A e B do design, que se complementam). Sem collector: as duas abas dão lugar ao aviso do padrão da tela `history`.
- `view === 'run'`: tela de run com KPIs, seletor de tentativa (quando `agentRuns.length > 1`), alternância **Graph** | **Waterfall** e botão voltar para `backTo`.
- Entrada pelo job: em `screens/jobs/List/Job/Actions.tsx`, ação **Agent run** quando a fila tem `agent` e `isAgentJob(job.name)` (a UI replica o filtro `jobs`). Clicar chama `openRun({ queue, jobId }, 'jobs')`.
- Entrada pela lista: linha clicável chama `openRun({ queue, jobId, attempt }, 'runs')`. Job removido: a tela mostra a entrada do índice e "job removed".
- Modal de Logs: linhas com o prefixo viram uma linha colapsada "agent run (attempt N)" com link para a tela de run. Sem isso o modal mostra um JSON de 64 KB.

### 7.2 Componentes

- **Graph (Run A):** layout calculado do run, não fixo como no design. Coluna 0 = `request`; coluna `i` = passo `i`; tools do passo empilhadas abaixo (o design tem uma por passo, o real pode ter várias em paralelo); última coluna = `response`. Arestas: request → s1, si → ti (desce), ti → s(i+1) (volta, "result"), sN → response (`outcome`). Painel do nó à direita com métricas e árvore de input/output (reusar `JsonTreeView`). Em `basic`, os blocos ausentes mostram "not recorded at basic detail".
- Barras de divisão Tempo / Tokens / Custo abaixo do grafo (design `splits`). Custo some quando `cost` é null ("no price").
- **Waterfall (Run B):** eixo = `durationMs` do run; linhas request, passos e tools (indentadas, posição por `tool.startedAt`, fallback fim do passo - duração), response. Barra de tokens por passo, linha expansível com os mesmos blocos do painel.
- **Metrics (Métricas A):** KPIs (runs, p50/p95 com "approx.", tokens, custo, falhas, passos por run), latência por bucket (recharts, barras p95 com p50 sobreposto), histograma de passos, tabela de tools (calls, avg, erro %, sem resultado %), tokens e custo por modelo, outcomes. Comparativo "vs período anterior" com uma segunda `agentsSummary` usando `until`.
- **Runs (Métricas B):** chips de filtro com `counts`, ordenação, linhas com a cadeia `req → tools (agrupadas ×N) → outcome`, tokens, duração (destaque acima de `slowMs`), custo, status.
- Seletor de janela derivado de `metricsInfo` (`time-range.ts`), como a `history`.
- Textos em inglês, padrão do painel. Estilo `makeStyles` + `alpha(theme.palette.*)`, nunca as cores hex do design.
- **Texto vindo do modelo nunca vira HTML.** `text`, `final.text` e `input.text` passam pelo componente `SafeMarkdown` (decisão do usuário, 2026-10-15): parser próprio que monta elementos React para negrito, itálico, código inline, quebras de linha e listas; link, imagem e HTML cru ficam como texto literal. `summary`, títulos de card e nomes de tool ficam em texto puro. Nada de `dangerouslySetInnerHTML` nem lib de markdown.

### 7.3 Demo (`VITE_ENABLE_MOCKS`)

Mocks novos em `demo-mocks/network/queries/`: uma fila `brand-app:ai` com `agent` em `get-queues`, `agentRun` a partir do `RUN` do design (em `full`, para a demo mostrar tudo), `agentsSummary` e `agentRuns` gerados com o mesmo downsampling do servidor (`downsample.ts`).

## 8. Fatiamento sugerido para o Tech Lead

1. **Refactor** `tiered-series.ts` extraído do collector, sem mudança de comportamento (testes atuais verdes).
2. **Contrato + helper** (`src/agent/`): tipos, detalhe, tetos, parser, recorder. Testes: corte `basic` (nenhuma chave proibida em nenhum nível do objeto), tetos, degradação de 64 KB, nunca lança, compat com um `AiTrace` real do brand.
3. **Config**: `QueueConfig.ai`, `Config.ai`, `Queue.agent`/`isAgentJob`, `getJobLogs(start, end)` nos dois adapters, remoção do `QueueConfig` duplicado.
4. **Collector de agentes**: ingestão por evento, dedupe, ponto, merge, histograma/percentil, índice, clear. Testes contra Bull e BullMQ (regra do suporte dual).
5. **GraphQL**: type-defs, data source, resolvers, custo, corte defensivo.
6. **UI**: store + roteamento + nav; Run (graph + waterfall); Metrics; Runs; ação no job; colapso no Logs modal.
7. **Demo mocks** + codegen.
8. **Docs**: contrato no README/docs (exemplo real), requisito de retenção do job, skill de instrumentação (US007, depois do contrato final).
9. **Security review** (threat-model.md) antes do release.
10. **Brand** (repo externo, task separada): wrapper do `TraceRecorder`, `AI_AGENT`, pricing.

Não entra: aba Conversa, módulo 05, métricas de agente no `/metrics` Prometheus (exporia nomes de tool e modelo como label; reabrir com Security se pedido).

## 9. Extensão: Conversa (T015–T018)

- **Índice:** `TAgentRunIndexEntry` ganha `c?: string` (`input.conversationId`, `clipId`). Entradas antigas sem `c` simplesmente não entram em conversa. Sem chave Redis nova: a conversa é montada filtrando o hash `::ai::runs::data` da fila (no máximo `recentRuns` entradas), o que mantém o custo limitado e sem chave órfã.
- **GraphQL:**
  ```graphql
  type AgentConversationMessage {
    jobId: ID!
    attempt: Int!
    startedAt: Float
    finishedAt: Float!
    durationMs: Float
    inputTokens: Int!
    outputTokens: Int!
    cost: Float
    outcome: String!
    steps: Int!
    "Passos resumidos (finishReason, duração, tokens, tools com nome/ok/empty/duração/summary). Lidos do log do job; vazio se o job sumiu."
    run: AgentRun
    "true quando o job já foi removido e só a entrada do índice existe."
    jobRemoved: Boolean!
  }
  type AgentConversation {
    queue: ID!
    conversationId: ID!
    messages: [AgentConversationMessage!]!
    "Pode haver mensagens mais antigas fora do índice de runs recentes."
    maybeIncomplete: Boolean!
    totals: AgentConversationTotals!
    tools: [AgentToolCount!]!
  }
  type AgentConversationTotals { messages: Int! durationMs: Float aiMs: Float! inputTokens: Float! outputTokens: Float! cost: Float steps: Int! toolCalls: Int! }
  type AgentToolCount { name: String! count: Int! }
  extend type Query { agentConversation(queue: ID!, conversationId: ID!): AgentConversation }
  ```
  `NO_COLLECTOR` sem collector. Mensagens ordenadas por `finishedAt`, deduplicadas por `jobId` (fica a maior tentativa), teto 100 (as mais recentes). `run` vem do log do job com o mesmo corte defensivo de `agentRun` (`detail` da fila). `maybeIncomplete` = o índice da fila está no teto e a entrada mais antiga do índice é mais nova que a primeira mensagem conhecida, ou o índice está cheio (heurística simples, documentar).
- **UI:** `TAgentsView` ganha `'conversation'`; store guarda `conversation: { queue, conversationId } | null` e `conversationLayout: 'chat' | 'list'` (persistido). Botão "View whole conversation" no painel "This run" quando `run.input.conversationId` existe e o collector está ligado. Tela com KPIs, alternância **Chat** (opção A) | **List** (opção B), "Messages over time", "Tools used", e abrir run de cada mensagem (voltar retorna à conversa). Texto do usuário e resposta via `SafeMarkdown`; em `basic`, "not recorded at basic detail".
- **Demo:** os 4 turnos `CONV` do design viram jobs `reply` com o mesmo `conversationId` `c-7f21` (o run `fa1809e7` é a mensagem 3).
