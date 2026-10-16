# Templates: jobs de agente no Bull Horizon

Exemplos para NestJS com `@nestjs/bull` (Bull 3/4). Para BullMQ troque `BullAdapter` por `BullMQAdapter` (`@bull-horizon/root/dist/bullmq-adapter`) e o processor por `WorkerHost` de `@nestjs/bullmq`; o `createAgentRun` é igual (o job do BullMQ também tem `log()` e `attemptsMade`).

## Constantes (compartilhadas)

```ts
// ai-queue.constants.ts
import type { AgentQueueConfig } from '@bull-horizon/root';

export const AI_QUEUE = 'app:ai';
export const AI_JOBS = { REPLY: 'reply', TRANSLATE: 'translate' } as const;

/** Mesmo objeto no monitor e no worker. */
export const AI_AGENT: AgentQueueConfig = {
  jobs: [AI_JOBS.REPLY],
  detail: 'basic',
  label: 'Assistentes',
};
```

## Monitor

```ts
// bull-monitor.service.ts
import { BullMonitorExpress } from '@bull-horizon/express';
import { BullAdapter } from '@bull-horizon/root/dist/bull-adapter';
import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';

import { AI_AGENT, AI_QUEUE } from '../ai/ai-queue.constants';
import { PUSH_QUEUE } from '../push/push-queue.constants';

const QUEUE_GROUPS: Record<string, string> = { [PUSH_QUEUE]: 'App', [AI_QUEUE]: 'Assistentes IA' };

@Injectable()
export class BullMonitorService extends BullMonitorExpress {
  constructor(@InjectQueue(PUSH_QUEUE) push: Queue, @InjectQueue(AI_QUEUE) ai: Queue) {
    const queues: Queue<unknown>[] = [push, ai];
    super({
      queues: queues.map(
        queue =>
          new BullAdapter(queue, {
            group: QUEUE_GROUPS[queue.name],
            ai: queue.name === AI_QUEUE ? AI_AGENT : undefined,
          })
      ),
      metrics: { collectInterval: { minutes: 1 } }, // necessário para Metrics/Runs
      ai: {
        pricing: { 'gemini-3.8-flash': { input: 0.75, output: 3.75 } }, // USD por 1M tokens
      },
    });
  }
}
```

O router continua montado como antes (ex.: `app.use('/bull', monitor.router)` após `await monitor.init()`). Proteja a rota com auth se usar `full`.

## Processor

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
      job,
      model: this.replies.modelName(),
      agent: AI_AGENT,
      input: { conversationId: job.data.conversationId },
      onError: err => this.logger.warn(`trace do job ${job.id}: ${String(err)}`),
    });
    // O service chama finish/fail com await e relança o erro.
    await this.replies.run(job.data.messageId, recorder);
  }
}
```

## Service (generateText, AI SDK v6)

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
      err instanceof Error ? `agent failed: ${err.constructor.name}` : 'agent failed'
    );
    await recorder.fail(safe);
    throw safe; // Bull aplica attempts/backoff; a próxima tentativa grava outra linha
  }
}
```

Se já existe um hook próprio por evento (linhas legíveis no log, `job.progress`), use `onEvent` em vez de duplicar callbacks:

```ts
onEvent: e => {
  if (e.type === 'tool') job.progress({ step: e.step, label: e.tool.name }).catch(() => undefined);
},
```

## Summarize

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
  isEmpty: (_tool, output) => Array.isArray((output as { items?: unknown[] })?.items) && !(output as { items: unknown[] }).items.length,
});
```

## Tetos (defaults, ajustáveis em `limits`)

| Item | Teto |
|---|---|
| output / input de tool | 2048 chars de JSON (acima vira `{ truncated, chars, preview }`) |
| texto de passo, resposta, `input.text` | 4000 chars |
| erro do run / erro de tool | 500 / 200 chars |
| summary, título de card | 120 chars |
| `model`, nome de tool, `finishReason`, tipo de card, `conversationId` | 120 chars (fixo, `AGENT_RUN_ID_CHARS`; o monitor recorta de novo na leitura) |
| `note(line)` | 4000 chars (`textChars`); não respeita o nível |
| passos / tools por passo / cards | 50 / 50 / 20 |
| linha inteira | 64 KB; acima, degrada (outputs, inputs, textos, esqueleto basic) e marca `truncated` |
| escrita do `finish`/`fail` | resolve em até 5 s mesmo se o Redis travar |
