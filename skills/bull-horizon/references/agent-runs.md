# Filas de agente de IA (agent runs)

Objetivo: cada tentativa de um job de agente vira **um run** no painel (passos LLM, tools, tokens, tempo, custo). O worker grava o run com `createAgentRun` (exportado por `@bull-horizon/root`, sem dependências: só usa `job.log()` e `attemptsMade`); o monitor declara a fila com `ai`. Contrato completo: `docs/agent-runs.md` do repositório.

O que aparece:

- **Run view** (ação "Agent run" no job): grafo (request, passos, tools, resposta) e waterfall com tokens por passo. Uma linha por tentativa: falha e retry lado a lado.
- **Tela Agents** na sidebar (só se houver fila `ai`): **Metrics** (latência p50/p95, passos por run, stats de tool, tokens e custo por modelo, desfechos), **Runs** (runs recentes com filtros e ordenação) e **Conversa**. Metrics/Runs/Conversa exigem o collector (`metrics`).

## 0. O caminho certo: onde o run mora

**O run vive no `job.log`, numa linha por tentativa, gravada pelo `createAgentRun`.** Esse é o mecanismo principal, e a tela Agents foi desenhada em cima dele. O resto do job só aponta para ele:

| Parte do job | O que vai | O que **não** vai |
|---|---|---|
| `job.data` (input) | ids opacos: `{ messageId, conversationId }` | texto do usuário, prompt, dado pessoal |
| `job.log` | 1 linha `bull-horizon:agent-run {...}` por tentativa, já cortada no nível da fila, mais linhas humanas sem conteúdo sensível | o rastro completo |
| `returnvalue` | uma referência pequena: `{ messageId, conversationId, attempt, status }` | o run, o rastro, a resposta |
| Seu banco | o rastro completo (`recorder.run`), se quiser guardar | |

Por que log, e não `returnvalue`:

- **Tentativa que falha só aparece no log.** O job relança o erro para o Bull tentar de novo, e o `returnvalue` não existe nesse caso. Justamente o run que mais interessa investigar se perderia.
- **Retry fica lado a lado.** Cada tentativa anexa a sua linha.
- **O corte de privacidade acontece antes do Redis.** O `createAgentRun` corta no processo do app. O `returnvalue` o Bull grava como vier, e o corte só valeria ao exibir.
- **A API é a mesma no Bull e no BullMQ**, e a linha some junto com o job.

O painel ainda lê um `AgentRunV1` do `returnvalue` quando não há linha no log, mas isso é **só compatibilidade** para workers antigos (aparece o chip "from return value" no run). Não desenhe um job novo assim.

Checklist do job no padrão:

1. `job.data` só com ids. O worker carrega o resto do banco.
2. `createAgentRun({ job, model, agent: AI_AGENT })` no começo da tentativa. **Não passe `attempt`**: o helper deriva do job e trata a diferença entre Bull e BullMQ (o `attemptsMade` do BullMQ já vem incrementado).
3. `await recorder.finish(...)` ou `await recorder.fail(err)` **antes** de o processor retornar ou relançar. Assim a linha chega antes do evento `completed`/`failed` que o monitor escuta.
4. O processor retorna só a referência. Nunca o run.
5. Verificação: no modal de Logs do job aparece "agent run (attempt N)" com Open run, e o run **não** tem o chip "from return value". Se aparecer o chip, ou o aviso "agent jobs finished without a run", algum worker ainda roda código antigo.

## Índice

0. O caminho certo
1. Checklist de decisão
2. Config compartilhada
3. Monitor
4. Processor e service (AI SDK v6)
5. Summarize customizado
6. Retenção
7. Conversa
8. Pricing e custo
9. Tetos
10. Como verificar
11. Erros comuns

## 1. Checklist de decisão (antes de codar)

1. **Qual fila?** A fila onde o job chama o LLM. Separe a fila de agente das demais (chamada de LLM é lenta e não deve segurar outros workers).
2. **Quais jobs?** Se a fila mistura agente e não agente (ex. `reply` e `translate`), liste em `ai.jobs` só os de agente. Omitido = todos.
3. **Nível de detalhe:**
   - `basic` (default, e o que `ai: true` dá): modelo, tempos, tokens, nomes/duração/resumo das tools, cards (tipo + título), erro do run, `conversationId`. **Sem** input/output de tool, sem texto.
   - `full`: grava também input/output das tools, texto dos passos, resposta final e fala do usuário no Redis.
   - Regra: dado sensível (saúde, financeiro, PII, mensagem de usuário) = `basic`. `full` só em fila de teste/investigação ou com o painel atrás de auth. Em `full` o conteúdo fica legível no modal de Logs para qualquer um que alcance o painel e vai para os backups RDB/AOF do Redis.
4. **Retenção:** `removeOnComplete`/`removeOnFail` precisam ser número ou idade. `true` apaga o run junto com o job (vira `lost`).
5. **Preço:** qual o nome exato do modelo que vai em `model`? É a chave do `ai.pricing`.
6. **Collector:** o monitor tem `metrics`? Sem ele só existe a Run view por job; Metrics, Runs e Conversa somem.

## 2. Config compartilhada

**Um** objeto `AgentQueueConfig` num arquivo de constantes da fila, importado no monitor **e** no worker. O nível vale onde o helper roda; o monitor usa a cópia dele para cortar de novo ao servir e marcar `detailMismatch` se divergir.

```ts
// ai-queue.constants.ts
import type { AgentQueueConfig } from '@bull-horizon/root';

export const AI_QUEUE = 'app:ai';
export const AI_JOBS = { REPLY: 'reply', TRANSLATE: 'translate' } as const;

/** Mesmo objeto no monitor e no worker. */
export const AI_AGENT: AgentQueueConfig = {
  jobs: [AI_JOBS.REPLY], // omitido = todos os jobs da fila
  detail: 'basic',       // 'basic' (default) ou 'full'
  label: 'Assistentes',  // nome na tela Agents; default = nome da fila
};
```

## 3. Monitor

No `BullMonitorService` (ver `setup-nestjs.md`):

- `ai: AI_AGENT` no `BullAdapter`/`BullMQAdapter` da fila de agente, ao lado de `group`;
- `metrics: {}` (ou a config de métricas existente) para Metrics/Runs/Conversa;
- `ai: { pricing: { '<modelo>': { input, output } } }` em USD por 1M tokens. `recentRuns` (default 2000 por fila) só se precisar de mais histórico no índice.

```ts
super({
  queues: queues.map(
    queue =>
      new BullAdapter(queue, {
        group: QUEUE_GROUPS[queue.name],
        ai: queue.name === AI_QUEUE ? AI_AGENT : undefined,
      }),
  ),
  metrics: { collectInterval: { minutes: 1 } },
  ai: {
    pricing: { 'gemini-3.8-flash': { input: 0.75, output: 3.75 } }, // USD por 1M tokens
    // recentRuns: 2000,
  },
});
```

Fila não injetada no `BullMonitorService` não aparece no painel. Proteja a rota com auth se usar `full`.

## 4. Processor e service (AI SDK v6)

Exemplos com `@nestjs/bull`. Para BullMQ: `BullMQAdapter` no monitor e `WorkerHost` de `@nestjs/bullmq` no worker; `createAgentRun` é igual (o job do BullMQ também tem `log()` e `attemptsMade`; o helper normaliza a numeração da tentativa entre Bull v3, BullMQ 1-4 e BullMQ 5+).

### Processor

```ts
// ai.processor.ts
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { createAgentRun } from '@bull-horizon/root';

import { AI_AGENT, AI_JOBS, AI_QUEUE } from './ai-queue.constants';
import { AiReplyService } from './services/ai-reply.service';

@Processor(AI_QUEUE)
export class AiProcessor {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(private readonly replies: AiReplyService) {}

  @Process({ name: AI_JOBS.REPLY, concurrency: 4 })
  async reply(job: Job<{ messageId: string; conversationId: string }>) {
    const recorder = createAgentRun({
      job,                               // o job real (define a tentativa)
      model: this.replies.modelName(),   // mesma chave do ai.pricing
      agent: AI_AGENT,                   // fonte do nível de detalhe
      input: { conversationId: job.data.conversationId }, // id opaco
      onError: err => this.logger.warn(`trace do job ${job.id}: ${String(err)}`),
    });
    // O service chama finish/fail com await e relança o erro.
    // Sem `attempt`: o helper deriva do job (Bull e BullMQ contam diferente).
    await this.replies.run(job.data.messageId, recorder);
    // Retorno = só uma referência. O run mora no job.log.
    return {
      messageId: job.data.messageId,
      conversationId: job.data.conversationId,
      attempt: recorder.run.attempt,
      status: 'replied',
    };
  }
}
```

### Service

```ts
import { generateText, stepCountIs } from 'ai';
import type { AgentRunRecorder } from '@bull-horizon/root';

async run(messageId: string, recorder: AgentRunRecorder) {
  try {
    const result = await generateText({
      model: this.model.model(),
      system,
      messages,
      tools,
      stopWhen: stepCountIs(6),
      experimental_onStepStart: ({ stepNumber }) => recorder.stepStart(stepNumber),
      experimental_onToolCallFinish: event =>
        recorder.tool({
          stepNumber: event.stepNumber,
          name: event.toolCall.toolName,
          input: event.toolCall.input,
          durationMs: event.durationMs,
          success: event.success,
          output: event.success ? event.output : undefined,
          error: event.success ? undefined : event.error,
        }),
      onStepFinish: event => recorder.stepFinish(event),
    });

    const cards = collector.cards.map(c => ({ type: c.type, title: c.title }));
    await recorder.finish(result.text, cards);
    await this.save(messageId, result.text, recorder.run); // rastro completo no seu banco, se quiser
  } catch (err) {
    // Saneie se o erro pode ecoar prompt/resposta: o mesmo erro vai para o
    // `error` do run (gravado em basic) e para o failedReason do job.
    const safe = new Error(
      err instanceof Error ? `agent failed: ${err.constructor.name}` : 'agent failed',
    );
    await recorder.fail(safe);
    throw safe; // Bull aplica attempts/backoff; a próxima tentativa grava outra linha
  }
}
```

### Regras do padrão

1. `createAgentRun({ job, model, agent: AI_AGENT, onError })` no começo da tentativa. `model` = mesmo nome usado no pricing.
2. Callbacks do `generateText` (AI SDK v6): `experimental_onStepStart`, `experimental_onToolCallFinish`, `onStepFinish`, como acima. `stepFinish` lê `stepNumber`, `finishReason`, `usage.inputTokens/outputTokens` e `text` do evento.
3. Sucesso: `await recorder.finish(text, cards)` (cards = `{ type, title }[]`) **antes** de retornar. **O título do card é gravado em `basic`.** Se pode carregar dado pessoal (nome do paciente, diagnóstico), use título genérico ou vazio: `cards.map(({ type }) => ({ type, title: '' }))` ou `title: 'Receita'`.
4. Erro: `await recorder.fail(err)` e **relance** para o Bull aplicar `attempts`/backoff. Cada tentativa grava sua própria linha. Se o erro pode ecoar prompt/resposta (`TypeValidationError`, `InvalidToolInputError` do AI SDK carregam o valor na mensagem), **saneie antes do `fail()` e antes de relançar**: o Bull grava a mensagem relançada, sem teto, em `failedReason` e `stacktrace`, legíveis no painel. Encurtar o `error` do run não protege nada.
5. Não envolva o recorder em `try/catch` próprio: ele nunca lança nem rejeita (Redis fora, `job.log` travado por mais de 5 s, callback seu que lança). `onError` serve só para logar. `finish`/`fail` são idempotentes (só a primeira chamada grava).
6. Rastro completo no seu banco: `recorder.run` (com tetos, sem corte de nível). Só o corte vai para o Redis.
7. Linhas humanas extras: `recorder.note('...')`. **`note` não passa pelo corte de nível** (gravado como está em qualquer `detail`, recortado a 4000 chars). Nunca escreva conteúdo sensível numa nota. Poucas notas por tentativa (ver Tetos: cauda de 200 linhas).
8. Já existe hook próprio por evento (linhas legíveis, `job.progress`)? Use `onEvent` em vez de duplicar callbacks:

```ts
onEvent: e => {
  if (e.type === 'tool') job.progress({ step: e.step, label: e.tool.name }).catch(() => undefined);
},
```

Opções do helper: `job`, `model` (obrigatórios), `agent`, `detail` (vence `agent`), `attempt` (passe quando `job` não for um job real do Bull/BullMQ, ex. wrapper em sandbox), `input`, `summarize`, `isEmpty`, `onEvent`, `onError`, `limits`, `now`.

## 5. Summarize customizado (opcional)

O default já é sem conteúdo: `"3 results"`, `"object (ok, message)"`, `"string (42 chars)"`, `"refused"` (objeto com `ok === false`), `"failed: TypeError"` (tool que falhou, só a classe do erro). Nomes de chave só aparecem quando todos parecem identificador de código; um objeto indexado por dado (`{ "maria@x.com": ... }`) vira `"object (N keys)"`. Chave que parece identificador mas é dado (ex. username `jdoe`) não é detectada: nesse caso escreva o seu.

Em `basic`, o `summarize` é **a única coisa** da saída da tool que chega ao Redis: devolva contagens, nomes de chave ou rótulo fixo, **nunca valores** (nome, diagnóstico, texto livre).

```ts
createAgentRun({
  // ...
  summarize: (tool, output) => {
    if (tool === 'getHealthSummary') return 'resumo de saúde'; // rótulo fixo, nunca o texto
    const o = output as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') return 'sem retorno';
    if (o.ok === false) return 'recusado'; // não ecoar o motivo se puder conter dado
    const lists = Object.entries(o).filter(([, v]) => Array.isArray(v));
    return lists.length ? lists.map(([k, v]) => `${k}: ${(v as unknown[]).length}`).join(', ') : 'ok';
  },
  isEmpty: (_tool, output) =>
    Array.isArray((output as { items?: unknown[] })?.items) &&
    !(output as { items: unknown[] }).items.length,
});
```

## 6. Retenção

```ts
await queue.add('reply', data, { attempts: 2, removeOnComplete: 500, removeOnFail: 500 });
// ou, em Bull 4+ / BullMQ: removeOnComplete: { age: 86400, count: 1000 }
```

`true` remove o job e seus logs no mesmo script Redis que emite o evento terminal: o collector chega tarde e conta `lost`. Numa fila mista, dê retenção numérica também aos jobs que não são de agente (job removido conta como `lost` antes de o nome ser checado). O run vive exatamente o tempo do job: reduzir N também reduz o tempo que conteúdo `full` fica exposto.

### Compatibilidade: run no returnvalue

Worker antigo que devolve o trace (AiTrace v1) no `return` em vez de usar `createAgentRun`: o monitor aceita o returnvalue como run da tentativa que completou (`source: returnvalue` no GraphQL), se passar no mesmo check de formato e no teto de 512 KB, e nunca duplica uma tentativa que já tem linha no log. É caminho de compatibilidade: **não registra tentativas que falharam** e o Bull grava o returnvalue como está, então **conteúdo `full` vai para o Redis seja qual for o `detail`** (o corte só vale ao servir e no índice). O caminho recomendado continua sendo `createAgentRun`, sem devolver o trace. Job de agente sem linha e sem returnvalue válido conta como `unrecorded`.

## 7. Conversa (opcional)

Para agrupar os runs de uma conversa (aba Conversa, botão "View whole conversation" no run):

```ts
const recorder = createAgentRun({
  job, model, agent: AI_AGENT,
  input: { conversationId: chat.id, text: userMessage }, // text só em full
});
```

- `conversationId` tem que ser **id opaco** (UUID ou chave do banco). **Nunca email, telefone, documento ou nome, nem hash deles** (hash sem salt é reversível): é gravado em `basic`, vai para o índice de runs recentes e aparece no painel.
- `input.text` (fala do usuário) só é gravado em `full`. Em `basic`, fala e resposta aparecem como "not recorded at basic detail"; meta, cadeia de tools e cards aparecem nos dois níveis.
- Uma mensagem = um job (a última tentativa). Teto de 100 mensagens na tela.
- Fonte = índice de runs recentes (`ai.recentRuns`, default 2000 por fila), só com collector e só runs ingeridos com o monitor no ar. Com o índice cheio, mensagens antigas saem e a tela avisa que a conversa pode estar incompleta. Precisa de mais? Aumente `recentRuns`.

## 8. Pricing e custo

- `cost = (inputTokens × input + outputTokens × output) / 1_000_000`, em USD, por passo, run e modelo.
- Chave do pricing = nome do modelo **como gravado no run**: comparação exata, case-insensitive. `gemini-3.8-flash` não casa com `models/gemini-3.8-flash`.
- Modelo sem preço mostra tokens e **"sem preço"**, nunca `$0`. Totais somam só os modelos com preço e sinalizam os sem preço.
- Custo calculado **na leitura**: mudar `ai.pricing` muda o custo exibido de runs passados. É estimativa (ignora desconto de cache, faixas de prompt).
- Exemplo de preço público atual: `'gemini-3.8-flash': { input: 0.75, output: 3.75 }`. Registre a fonte e a data num comentário ao lado da tabela.

## 9. Tetos (defaults, ajustáveis em `limits`)

| Item | Teto |
|---|---|
| output / input de tool | 2048 chars de JSON (acima vira `{ truncated, chars, preview }`) |
| texto de passo, resposta, `input.text` | 4000 chars |
| erro do run / erro de tool | 500 / 200 chars |
| summary, título de card | 120 chars |
| `model`, nome de tool, `finishReason`, tipo de card, `conversationId` | 120 chars (fixo, `AGENT_RUN_ID_CHARS`) |
| `note(line)` | 4000 chars; não respeita o nível |
| passos / tools por passo / cards | 50 / 50 / 20 |
| linha inteira | 64 KB; acima, degrada (outputs, inputs, textos, esqueleto basic) e marca `truncated` |
| escrita do `finish`/`fail` | resolve em até 5 s mesmo se o Redis travar |

Leitura: só as **últimas 200 linhas** do log do job são lidas (todas as linhas contam, não só as de run); linha de run acima de 512 KB é ignorada.

Formato no log: `bull-horizon:agent-run {"v":1,"detail":"basic",...}`, uma linha por tentativa. No modal de Logs a linha aparece recolhida.

## 10. Como verificar no painel

1. Rode um job de agente. A sidebar mostra **Agents** (só com fila de agente declarada).
2. Abra o job: a ação "Agent run" mostra grafo e waterfall, um run por tentativa. Sem run = `finish`/`fail` não foram chamados (ou o processo caiu antes).
3. No modal de Logs do job: uma linha `bull-horizon:agent-run {...}` por tentativa. Em `basic`, confira que não há `input`, `output`, `text` nas tools/passos.
4. Conversa: "View whole conversation" aparece quando o run tem `conversationId` e o collector está ligado.
5. Metrics e Runs: só com collector, e só contam com o monitor no ar. Custo "sem preço" = nome do modelo não bate com o pricing.

## 11. Erros comuns

| Erro | Efeito | Correção |
|---|---|---|
| `removeOnComplete: true` na fila de agente | runs viram `lost`, sem dados (em fila mista, jobs não agente removidos também contam como `lost`) | número ou `{ age }` |
| `finish`/`fail` sem `await` | linha pode chegar depois do evento; collector relê uma vez em 2 s | `await` antes de retornar/relançar |
| muitos `recorder.note()` / `job.log()` por tentativa | só as últimas 200 linhas são lidas: run de tentativa anterior sai da janela (some do painel e das métricas) | poucas notas por tentativa |
| passar objeto próprio em vez do job real | número da tentativa errado (Bull e BullMQ contam `attemptsMade` diferente) | passar o job do Bull/BullMQ, ou `attempt` explícito |
| engolir o erro depois do `fail` | Bull não faz retry; tentativa some como sucesso | relançar |
| relançar/`fail` com erro que ecoa prompt | conteúdo no `error` do run (mesmo em `basic`) e no `failedReason` | sanear antes: mesmo erro sem conteúdo no `fail` e no `throw` |
| título de card com dado pessoal | título vai para o Redis em `basic` | título genérico ou `''` |
| conteúdo sensível em `recorder.note()` | nota não respeita o nível | só texto operacional |
| `detail` diferente no monitor e no worker | `detailMismatch` + `console.warn`; conteúdo `full` já está no Redis | importar o mesmo `AI_AGENT` nos dois |
| `full` em fila com dado sensível | PII legível no painel e nos backups | `basic`; `full` só em teste ou com auth |
| `summarize` que devolve o valor (`String(output)`) | vaza conteúdo mesmo em `basic` | só contagens/chaves |
| `model` diferente da chave do pricing (`models/x` vs `x`) | custo "sem preço" | mesmo nome nos dois |
| try/catch em volta do recorder, ou `await` de `job.log` próprio | código morto ou job falhando por Redis | confiar no "nunca lança"; usar `onError` |
| email/telefone como `conversationId` | dado pessoal em `basic`, no índice e no painel | id opaco (UUID, chave do banco) |
| esperar a conversa inteira de um chat antigo | mensagens fora do índice de runs recentes não aparecem | aumentar `ai.recentRuns` |
| fila não injetada no `BullMonitorService` | fila não aparece | injetar e passar o adapter |
| fila em `metrics.blacklist` | sem agregados de agente | tirar da blacklist |
| esperar métricas de agente no Prometheus | não existem | ver no painel |
