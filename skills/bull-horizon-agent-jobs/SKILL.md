---
name: bull-horizon-agent-jobs
description: Instrumenta filas e jobs de agente de IA para a visão Agents do Bull Horizon (@bull-horizon/root), com createAgentRun, config `ai` por fila e tabela de preço. Use ao "instrumentar fila de IA no bull-horizon", "criar job de agente", "trace de agente no bull", "mostrar run do agente no painel", ao escrever ou revisar jobs Bull/BullMQ que chamam generateText do AI SDK (experimental_onStepStart, onStepFinish, experimental_onToolCallFinish), processors NestJS com @Processor/@Process ou WorkerHost que rodam LLM, ou um BullMonitorExpress/BullMonitorService que precisa declarar fila de agente, pricing ou nível de detalhe basic/full.
---

# Jobs de agente no Bull Horizon

Objetivo: cada tentativa de um job de agente vira **um run** no painel (passos LLM, tools, tokens, tempo, custo). O worker grava o run com `createAgentRun`; o monitor declara a fila com `ai`. Referência completa do contrato: `docs/agent-runs.md` do repositório bull-horizon. Templates de código prontos: `references/templates.md` (nesta skill).

## 1. Checklist de decisão (antes de codar)

1. **Qual fila?** A fila onde o job chama o LLM. Fila de agente separada das demais (chamada de LLM é lenta e não deve segurar outros workers).
2. **Quais jobs?** Se a fila mistura agente e não agente (ex.: `reply` e `translate-exercises`), liste em `ai.jobs` só os de agente. Omitido = todos.
3. **Nível de detalhe:**
   - `basic` (default, e o que `ai: true` dá): modelo, tempos, tokens, nomes/duração/resumo das tools, cards (tipo + título), erro do run. **Sem** input/output de tool, sem texto.
   - `full`: grava também input/output das tools, texto dos passos, resposta final e fala do usuário no Redis.
   - Regra: dado sensível (saúde, financeiro, PII, mensagem de usuário) = `basic`. `full` só em fila de teste/investigação ou com o painel atrás de auth. Em `full` o conteúdo fica legível no modal de Logs para qualquer um que alcance o painel e vai para os backups RDB/AOF do Redis.
4. **Retenção:** a fila mantém o job? `removeOnComplete`/`removeOnFail` precisam ser número ou idade. `true` apaga o run junto com o job (vira `lost`).
5. **Preço:** qual o nome exato do modelo que vai em `model`? É a chave do `ai.pricing`.
6. **Collector:** o monitor tem `metrics` configurado? Sem ele só existe a visão do run por job; as abas Metrics e Runs somem.

## 2. Passo a passo

### 2.1 Config compartilhada

Crie **um** objeto `AgentQueueConfig` num arquivo de constantes da fila e importe-o no monitor **e** no worker. O nível vale onde o helper roda; o monitor usa a cópia dele para cortar de novo ao servir e marcar `detailMismatch` se divergir.

```ts
import type { AgentQueueConfig } from '@bull-horizon/root';
export const AI_QUEUE = 'app:ai';
export const AI_AGENT: AgentQueueConfig = { jobs: ['reply'], detail: 'basic', label: 'Assistentes' };
```

### 2.2 Monitor (NestJS + BullMonitorExpress)

No `BullMonitorService` (classe `@Injectable()` que estende `BullMonitorExpress` e recebe as filas por `@InjectQueue`):

- passe `ai: AI_AGENT` no `BullAdapter`/`BullMQAdapter` da fila de agente, ao lado de `group`;
- garanta `metrics: {}` (ou a config de métricas já existente);
- adicione `ai: { pricing: { '<modelo>': { input, output } } }` em USD por 1M tokens. `recentRuns` (default 2000) só se precisar.

Lembre: fila não injetada no `BullMonitorService` não aparece no painel. Template completo em `references/templates.md` § Monitor.

### 2.3 Worker / processor

Padrão obrigatório (template em `references/templates.md` § Processor e § Service):

1. `const recorder = createAgentRun({ job, model, agent: AI_AGENT, onError })` no começo da tentativa. `model` = mesmo nome usado no pricing.
2. Ligue os callbacks do `generateText` (AI SDK v6):
   - `experimental_onStepStart: ({ stepNumber }) => recorder.stepStart(stepNumber)`
   - `experimental_onToolCallFinish: e => recorder.tool({ stepNumber: e.stepNumber, name: e.toolCall.toolName, input: e.toolCall.input, durationMs: e.durationMs, success: e.success, output: e.success ? e.output : undefined, error: e.success ? undefined : e.error })`
   - `onStepFinish: e => recorder.stepFinish(e)`
3. Sucesso: `await recorder.finish(text, cards)` (cards = `{ type, title }[]`) **antes** de retornar. **O título do card é gravado em `basic`.** Se ele pode carregar dado pessoal (nome do paciente, diagnóstico), passe título genérico ou vazio: `cards.map(({ type }) => ({ type, title: '' }))` ou `title: 'Receita'`. Com dado de saúde, use título genérico.
4. Erro: `await recorder.fail(err)` e **relance** o erro para o Bull aplicar `attempts`/backoff. Cada tentativa grava sua própria linha. Se o erro pode ecoar prompt/resposta (ex.: `TypeValidationError`, `InvalidToolInputError` do AI SDK carregam o valor na mensagem), **saneie antes do `fail()` e antes de relançar**: crie um erro sem conteúdo, passe-o ao `fail()` e relance o mesmo. O Bull grava a mensagem relançada, sem teto, em `failedReason` e `stacktrace` do job, legíveis no painel; encurtar o `error` do run não protege nada.
5. Não envolva o recorder em `try/catch` próprio: ele nunca lança nem rejeita (Redis fora, `job.log` travado por mais de 5 s, callback seu que lança). Use `onError` só para logar.
6. Quer guardar o rastro completo no seu banco? Use `recorder.run` (completo, com tetos, sem corte de nível). Só o corte vai para o Redis.
7. Linhas humanas extras no log: `recorder.note('...')`. **`note` não passa pelo corte de nível**: é gravado como está em qualquer `detail` (só recortado a `textChars`, 4000). Nunca escreva conteúdo sensível numa nota.

### 2.4 `summarize` customizado (opcional)

O default já é sem conteúdo (`"3 results"`, `"object (ok, message)"`, `"string (42 chars)"`). Nomes de chave só aparecem quando todos os exibidos parecem identificador de código; um objeto indexado por dado (`{ "maria@x.com": ... }`) vira `"object (N keys)"`. Chave que parece identificador mas é dado (ex.: username `jdoe`) não é detectada: nesse caso escreva o seu. Se escrever o seu, em `basic` ele é **a única coisa** da saída da tool que chega ao Redis: devolva contagens, nomes de chave ou um rótulo fixo, **nunca valores** (nome, diagnóstico, texto livre). Mesma regra para títulos de card. Exemplo em `references/templates.md` § Summarize.

### 2.5 Retenção

```ts
await queue.add('reply', data, { attempts: 2, removeOnComplete: 500, removeOnFail: 500 });
// ou, em Bull 4+ / BullMQ: removeOnComplete: { age: 86400, count: 1000 }
```

Numa fila mista, dê retenção numérica também aos jobs que não são de agente: job removido conta como `lost` antes de o nome ser checado. Reduzir N também reduz o tempo que conteúdo `full` fica exposto.

### 2.6 Conversa (opcional)

Para o painel agrupar os runs de uma mesma conversa (aba Conversa, botão "View whole conversation" no run), passe o id da conversa ao helper:

```ts
const recorder = createAgentRun({ job, model, agent: AI_AGENT, input: { conversationId: chat.id, text: userMessage } });
```

- `conversationId` tem que ser **id opaco** (UUID ou chave do banco). **Nunca email, telefone, documento ou nome, nem hash deles** (hash sem salt de email ou telefone é reversível): ele é gravado em `basic`, vai para o índice de runs recentes e aparece no painel.
- `input.text` (fala do usuário) só é gravado em `full`. Em `basic` a mensagem mostra "not recorded at basic detail", assim como a resposta final; meta, cadeia de tools e cards aparecem nos dois níveis.
- Uma mensagem = um job (a última tentativa). Teto de 100 mensagens na tela.
- Fonte = índice de runs recentes (`ai.recentRuns`, default 2000 por fila), só com collector. Com o índice cheio, mensagens antigas saem e a tela avisa que a conversa pode estar incompleta. Precisa de histórico mais longo? Aumente `recentRuns`.

## 3. Como verificar no painel

1. Rode um job de agente. No painel, a sidebar mostra **Agents** (só aparece com fila de agente declarada).
2. Abra o job: a ação "Agent run" mostra grafo e waterfall, uma tentativa por run. Sem run = `finish`/`fail` não foram chamados (ou o processo caiu antes).
3. No modal de Logs do job deve haver uma linha `bull-horizon:agent-run {...}` por tentativa. Em `basic`, confira que não há `input`, `output`, `text` nas tools/passos.
4. Conversa: no painel "This run", "View whole conversation" aparece quando o run tem `conversationId` e o collector está ligado.
5. Abas Metrics e Runs: só com collector, e só contam com o monitor no ar. Custo aparece como "sem preço" se o nome do modelo não bater com o pricing (comparação exata, case-insensitive).

## 4. Erros comuns

| Erro | Efeito | Correção |
|---|---|---|
| `removeOnComplete: true` na fila de agente | runs viram `lost`, sem dados (em fila mista, jobs que não são de agente removidos também contam como `lost`) | número ou `{ age }` |
| `finish`/`fail` sem `await` | linha pode chegar depois do evento; collector relê uma vez em 2 s | `await` antes de retornar/relançar |
| muitos `recorder.note()` / `job.log()` por tentativa | só as últimas 200 linhas do log são lidas: o run de uma tentativa anterior sai da janela (some do painel e das métricas) | poucas notas por tentativa |
| passar um objeto próprio em vez do job real como `job` | número da tentativa errado (Bull e BullMQ contam `attemptsMade` diferente) | passar o job do Bull/BullMQ, ou `attempt` explícito |
| engolir o erro depois do `fail` | Bull não faz retry; tentativa some como sucesso | relançar `err` |
| relançar/`fail` com erro que ecoa prompt | conteúdo no `error` do run (mesmo em `basic`) e no `failedReason` do job | sanear antes: mesmo erro sem conteúdo no `fail` e no `throw` |
| título de card com dado pessoal | título vai para o Redis em `basic` | título genérico ou `''` |
| conteúdo sensível em `recorder.note()` | nota não respeita o nível | só texto operacional |
| `detail` diferente no monitor e no worker | `detailMismatch`; conteúdo `full` já está no Redis | importar o mesmo `AI_AGENT` nos dois |
| `full` em fila com dado sensível | PII legível no painel e nos backups | `basic`; `full` só em teste ou com auth |
| `summarize` que devolve o valor (`String(output)`) | vaza conteúdo mesmo em `basic` | só contagens/chaves |
| `model` diferente da chave do pricing (`models/x` vs `x`) | custo "sem preço" | usar o mesmo nome nos dois |
| try/catch em volta do recorder, ou `await` de `job.log` próprio | código morto ou job falhando por Redis | confiar no "nunca lança"; usar `onError` |
| email/telefone como `conversationId` | dado pessoal em `basic`, no índice e no painel | id opaco (UUID, chave do banco) |
| esperar a conversa inteira de um chat antigo | mensagens fora do índice de runs recentes não aparecem | aumentar `ai.recentRuns` |
| fila não injetada no `BullMonitorService` | fila não aparece | injetar e passar o adapter |
| esperar métricas de agente no Prometheus | não existem | ver no painel (rota sem auth não exporta nomes de tool/modelo) |
