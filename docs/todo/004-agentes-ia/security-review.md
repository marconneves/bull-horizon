# Security Review 004: Agentes IA (visão de runs de agente)

**Revisor:** 🔒 Security Specialist
**Data:** 2026-10-15
**Escopo:** change set não commitado da task 004 (`git diff` + arquivos novos): `packages/root/src/agent/`, `metrics/`, `gql/type-defs/agents.ts`, `gql/data-sources/agents/`, resolvers, adapters, `packages/ui/src/screens/agents/`, `components/SafeMarkdown/`, `services/agent-run-log.ts`, `screens/jobs/LogsModal`, demo mocks, `docs/agent-runs.md`, `skills/bull-horizon-agent-jobs/` e `docs/todo/004-agentes-ia/design/`.
**Base:** `threat-model.md` (pontos 1 a 9), OWASP Top 10 / CWE Top 25.

## Veredito

**APROVADO COM RESSALVAS.** Nenhum achado Critical ou High. O controle central (corte de detalhe antes do Redis, default `basic`) está correto e coberto por teste em todos os caminhos de escrita. Há 1 achado Medium (chaves herdadas de `Object.prototype` nos rollups derrubam o `agentsSummary`) que recomendo corrigir antes do release, mas não bloqueia: exige nome de tool/modelo/finishReason incomum ou escrita direta na fila. Os demais são Low/Info.

Teste que reproduz os achados F1 e F3: `packages/root/src/__tests__/security-004.test.ts` (fixa o comportamento atual; inverter as expectativas marcadas quando a correção entrar).

## Achados

| ID | Severidade | Título | Local |
|---|---|---|---|
| F1 | Medium | Nome de tool/modelo/outcome igual a membro de `Object.prototype` corrompe rollups e quebra `agentsSummary` | `packages/root/src/metrics/agent-metrics.ts:152`, `:183` |
| F2 | Low | Identificadores sem teto de tamanho (modelo, nome de tool, tipo de card, `conversationId`) viram chave de rollup e entrada do índice | `packages/root/src/agent/recorder.ts:283`, `:298`, `:354`, `:403`; `agent-metrics.ts:258`, `:288`, `:298` |
| F3 | Low | `defaultSummarize` publica nomes de chave do topo; em saída tipo dicionário a chave é dado | `packages/root/src/agent/summarize.ts:28`, `:32` |
| F4 | Low | `queues: [ID!]` sem dedupe nem teto: amplificação de leitura no Redis | `packages/root/src/gql/data-sources/agents/index.ts:416` |
| F5 | Low | `detailMismatch` é silencioso no monitor (decisão a) | `packages/root/src/gql/data-sources/agents/index.ts:277` |
| F6 | Low | `recorder.note()` ignora o nível e não tem teto de tamanho | `packages/root/src/agent/recorder.ts:421`; `docs/agent-runs.md:263` |
| F7 | Info | Colisão de chave Redis entre a série de throughput da fila `X::ai` e a série de agente da fila `X` | `packages/root/src/metrics/agent-metrics.ts:358`; `tiered-series.ts:46` |
| F8 | Info | `error` do run no `basic` pode ecoar prompt (decisão c) | `packages/root/src/agent/recorder.ts:416` |
| F9 | Info | `final.cards[].title` no `basic` (decisão b) | `packages/root/src/agent/detail.ts` (`card`) |

### F1 (Medium): chaves herdadas de `Object.prototype` nos rollups

`addCapped` decide se soma ou cria com `key in record`. Para `constructor`, `toString`, `valueOf`, `hasOwnProperty` etc. o `in` enxerga o membro herdado, e a soma vira `add(Function, delta)`: `{ c: NaN, ... }` para tools/modelos, e string (`"function Object() {...}1"`) para outcomes. O ponto é persistido (NaN vira `null`), e no read `getSummary` refaz o merge sobre um objeto vazio, produzindo NaN de novo. `AgentToolStats.calls: Int!` e `avgDurationMs: Float!` rejeitam NaN no serializer do GraphQL, e o erro sobe até `agentsSummary` (nullable): a aba Metrics fica vazia **pelo tempo de retenção do tier** (até 1 ano no tier diário). `__proto__` troca só o protótipo do record local (sem poluição global, verificado no teste), mas perde a estatística.

- Vetor: nome de tool definido pelo app, `model`, `finishReason` do SDK, ou linha forjada (ponto 6). O ponto 6 assumia "no máximo distorce métricas"; aqui derruba a query.
- CWE-1321 (variante sem poluição global) / CWE-20.
- **Correção:** em `addCapped` e `mergeRecord`, usar `Object.prototype.hasOwnProperty.call(record, key)` e criar records com `Object.create(null)` (inclusive no `emptyAgentPoint` e ao reidratar do JSON), ou trocar por `Map` internamente. Opcionalmente tratar `__proto__` como `(other)`. Inverter as expectativas de `security-004.test.ts` após a correção.

### F2 (Low): identificadores sem teto

`model`, `tools[].name`, `cards[].type` e `input.conversationId` não passam por `clip`. A linha tem teto de 64 KB, mas o último fallback de `formatAgentRunLine` (esqueleto sem tools) não revalida o tamanho, e o parser aceita até 512 KB. Esses valores viram chave de rollup (até 50 tools e 20 modelos por ponto, em cada tier) e campos `m`/`tc` do índice (até 2000 entradas). Uma linha forjada ou um bug do app (ex.: `model` com o prompt) multiplica o tamanho por tier e por entrada. Não há ganho para um atacante que já escreve no Redis, por isso Low.

- **Correção:** `clip` a 200 chars em `model`, `name`, `type` e `conversationId` no recorder; no ingest (`accumulateAgentRun`, `agentRunIndexEntry`) recortar de novo as chaves (defesa em profundidade, o leitor não confia no escritor).

### F3 (Low): nomes de chave no summary default

`object (k1, k2)` e `k: n` expõem só o schema quando a saída é um objeto de forma fixa. Quando a saída é um dicionário indexado por dado (`{ "maria@x.com": {...} }`, `{ "Diabetes tipo 2": [...] }`), a chave **é** o valor e vai para o `basic`. Reproduzido no teste.

- **Correção:** só listar chaves que parecem identificador (`/^[A-Za-z_$][\w$]{0,39}$/`); se alguma chave não casar, devolver `object (N keys)`. Mesma regra para o ramo de listas (`k: n`). Documentar a limitação em `docs/agent-runs.md` § Tool summaries.

### F4 (Low): `queues` sem dedupe nem teto

`_agentQueues` mapeia cada id recebido sem deduplicar. `agentRuns(queues: ["q","q",... x10000])` dispara 10000 `ZREVRANGEBYSCORE` + `HMGET` (até 2000 entradas cada) e devolve tudo duplicado; `agentsSummary` idem com `extractSince`. Sem auth no painel, é amplificação barata de carga no Redis do app.

- **Correção:** `new Set(ids)` antes do map (o resultado já é limitado ao número de filas configuradas). Não exige teto adicional.

### F5 (Low): `detailMismatch` silencioso (decisão a)

O servidor corta ao servir, mas o conteúdo `full` continua no Redis e legível pelo modal de Logs (botão "Raw") e por `Job.logs`. Só quem abre o run vê o flag. Ver decisão (a).

### F6 (Low): `note()` fora do nível

`note(line)` grava texto livre em `job.log` sem corte de nível e sem teto. É legítimo (linha humana), mas um integrador pode achar que `basic` cobre tudo o que o helper escreve.

- **Correção:** aplicar `clip(line, textChars)` e documentar na tabela da API e na skill (§ 2.3 item 7): "`note` não passa pelo corte de nível; nunca escreva conteúdo sensível".

### F7 (Info): colisão de chave `::ai`

A série de agente usa `redisPrefix + queueId + '::ai'`. Uma fila chamada `X::ai` teria a série de throughput na mesma chave da série de agente de `X`. Nomes de fila vêm da config do operador, não de entrada externa. Registrar; se mexer nas chaves no futuro, usar separador que não possa aparecer em nome de fila.

### F8 (Info): `error` no `basic`

Ver decisão (c).

### F9 (Info): títulos de card no `basic`

Ver decisão (b).

## Decisões das questões abertas do Architect

**(a) `detailMismatch` deve gerar `console.warn` no monitor? SIM.** Um aviso por fila por processo (dedupe com `Set` de queue id), no momento em que o mismatch é detectado (leitura do run ou ingest do collector), com texto sem conteúdo: `[bull-horizon] queue "<nome>" declares detail "basic" but job <id> carries a "full" run: the content is stored in Redis. Use the same AgentQueueConfig in the worker.` Motivo: o corte ao servir dá falsa sensação de segurança; o operador precisa saber que há PII no Redis e no backup. Não bloqueia o release (P2).

**(b) `final.cards[].title` no `basic`: ACEITO, sem opção nova neste ciclo.** O título é escrito pelo app (não pelo LLM livremente) e é o que torna o run legível no `basic`. O app já controla o que passa em `finish(text, cards)`. Exigência: a doc (`docs/agent-runs.md` § Which level to use e a skill § 2.4) deve dizer explicitamente que título de card é armazenado no `basic` e como omitir (`cards.map(({ type }) => ({ type, title: '' }))` ou título genérico). Para o piloto com dado de saúde, recomendo título genérico. Opção `cardTitles: false` fica como melhoria P3 se surgir segundo consumidor sensível.

**(c) `error` do run no `basic` (500 chars): MANTER.** Reduzir a `error.name` + N chars não protege nada: a skill exige relançar o erro depois do `fail()`, e o Bull grava a mesma mensagem, sem teto, em `failedReason` e `stacktrace` do job, legíveis no painel. A proteção real é o app sanear o erro **antes** do `fail()` **e** do relançamento. Ajuste de doc pedido: em `docs/agent-runs.md:363` e na skill, trocar "consider wrapping errors before `fail()`" por "se o erro pode ecoar prompt/resposta (ex.: `TypeValidationError`, `InvalidToolInputError` do AI SDK carregam o valor na mensagem), lance um erro saneado e passe o mesmo a `fail()`; o `failedReason` do job tem a mesma mensagem".

**(d) Nomes de chave em `"object (k1, k2)"` no `basic`: ACEITO COM AJUSTE (F3).** Schema é aceitável; chave que é dado não é. Filtrar por padrão de identificador e cair em `object (N keys)` caso contrário.

**(e) `failed: <ErrorClass>` no `basic`: ACEITO.** Vem de `err.constructor.name`, que é nome de classe no código, validado por regex linear (`/^[A-Za-z_$][\w$]{0,59}$/`) e sem `err.name` custom nem mensagem. Não carrega conteúdo de runtime.

## Validação do threat model (pontos 1 a 9)

| # | Ponto | Resultado |
|---|---|---|
| 1 | Corte antes do Redis | OK. Só dois caminhos escrevem a linha: `formatAgentRunLine` (aplica `applyAgentRunDetail` por whitelist antes de serializar) e `skeletonAgentRunLine` (basic, só primitivos). `recorder.run` nunca é serializado. Default `basic`; `ai: true`, `{}`, `'FULL'` e qualquer valor fora de `'full'` caem em `basic` (`normalizeAgentRunDetail`). Testes de varredura recursiva cobrem default, `fail()` e degradação de 64 KB (`agent.test.ts:267-300`). Linha forjada que diz `basic` mas carrega `text` é cortada também (whitelist no read). |
| 2 | `full` = PII no Redis | OK na doc e na skill: `basic` para dado sensível, `full` só em teste ou com auth, retenção via `removeOnComplete: N`, backups RDB/AOF, modal de Logs e `Job.logs`. Residual aceito (auth nativa fora do escopo). |
| 3 | Campos livres no `basic` | `summary` default sem valor (exceto F3). `summarize` custom documentado como responsabilidade do integrador; o default do brand (`clip(String(output), 80)`) não foi copiado. `conversationId` aceito. Títulos: decisão (b). |
| 4 | Erro no `basic` | `tools[].error` fora do `basic` confirmado (só `ok: false` + `failed: <Classe>`). Run `error`: decisão (c). Índice recorta a 200. |
| 5 | Tamanho e DoS | OK. Tetos de escrita aplicados; `parseAgentRunLine` ignora linha > 512 KB antes do `JSON.parse`, em `try/catch`, com guarda de forma; `getJobLogs` limitado à cauda de 200; tools/modelos/outcomes capados por ponto (50/20/20); índice capado em `recentRuns` com trim no mesmo `MULTI`. Ressalvas F1 e F2. Pior caso de memória por fila aceito. UI: `readAgentRunLogLine` também respeita 512 KB e `JSON.parse` em `try/catch`. |
| 6 | Spoofing de linha | Severidade baixa confirmada, com a correção F1 (hoje uma linha forjada derruba o `agentsSummary`, não só distorce). `note()` descarta linhas com o prefixo. |
| 7 | XSS na UI | OK. Zero `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `href`/`src` dinâmicos nos arquivos novos. `SafeMarkdown` monta só `p`, `ul/ol/li`, `strong`, `em`, `code`, `br` a partir de texto; `start` de `ol` é número de até 9 dígitos. Links, imagens e HTML cru ficam literais (testes `parse.test.ts:120-135`). Nenhum atributo `href`, `src` ou `style` é derivado de conteúdo: todos os `style` usam cores do tema (`outcomeColor` mapeia por `switch` para tokens) ou números de layout. `title={card.title}` é atributo escapado pelo React. Sem lib de markdown (nenhuma dependência nova). `JsonTreeView` usa `JSON.parse` em `try/catch` e renderiza nós como texto React; fallback é `<pre>{children}</pre>`. Logs modal "Raw" renderiza em `<pre>` como texto. |
| 7b | ReDoS / parser linear | OK. `parse.ts` é varredura única sem regex sobre a entrada (só `/[\p{L}\p{N}]/u` em um caractere). Pilha de ênfase limitada a 3 frames, cada nó movido no máximo 3 vezes. Medido: 400 K a 4 M chars de entradas patológicas (`*`, `*a `, `**a *b _c `, `_a`, crases abertas, listas) escalam de forma linear (dezenas a poucas centenas de ms; texto real é capado em 4000). Regex do servidor (`failedSummary`) é ancorada e linear. |
| 8 | Exposição sem auth | OK. Só `Query` nova (`agentRun`, `agentsSummary`, `agentRuns`) e campos `Queue.agent`, `Job.agentRuns`; nenhuma `Mutation`. `limit` capado em 500 (silencioso), `offset`/`limit` negativos rejeitados, `since`/`until` só filtram dados já capados, `maxPoints` só reduz. Ressalva F4 (dedupe). `prometheus.ts` não foi alterado: métricas de agente não saem no `/metrics`. Estado persistido da UI (`stores/agents.ts`) guarda só `view`, `runLayout`, `range`, nada de conteúdo do run. |
| 9 | Helper no processo do app | OK. `createAgentRun` cai em recorder no-op se o construtor lançar; todo método em `_guard`; `_write` resolve em timeout (5 s, `unref`) e nunca rejeita; getters que lançam viram fallback; `onEvent`/`onError`/`summarize`/`isEmpty` protegidos. Nenhuma dependência nova: nenhum `package.json` nem lockfile alterado; `contract.ts`/`recorder.ts` sem imports de terceiros. |

## Varredura de segredos

Escopo: `git diff` + todos os arquivos não rastreados (~4 MB, incluindo `demo-mocks`, `docs/todo/004-agentes-ia/design/06 Agentes IA.dc.html` e `.changeset/`). Padrões: AWS (`AKIA`), GitHub (`ghp_`/`gho_`...), Slack (`xox*`), OpenAI/Anthropic (`sk-`, `sk-ant-`), Google (`AIza`), chaves PEM, JWT, `user:pass@host`, atribuições `apiKey/secret/password/token = <valor>`, e-mails e IPs.

Resultado: **nenhum segredo**. Sem e-mails ou IPs reais. URLs encontradas: docs do Bull, Google Fonts (só no HTML de design, que não é servido) e `http://evil/x.png` (fixture de teste do SafeMarkdown). Demo mocks são sintéticos (receitas, `conversationId: 'c-7f21'`, ids `r_118`/`m_5521`); "brand" é placeholder, sem nome de cliente real nem dado de saúde identificável. O HTML de design referencia `./support.js` local inexistente e fonts externas; fica em `docs/`, fora do bundle.

## Dependências (supply chain)

Nenhum `package.json` ou lockfile alterado no change set. Sem lib de markdown, sem `ai`, sem sketch/t-digest. Superfície inalterada.

## Próximos passos recomendados

1. P1 antes do release: F1 (records sem protótipo + inverter `security-004.test.ts`).
2. P2: F3, F4, decisão (a) (F5), ajustes de doc das decisões (b) e (c), F6.
3. P3: F2 (clip de identificadores), F7 (registrar).

## Correções

**Por:** 💻 Developer, 2026-10-15. Todas as expectativas marcadas em `security-004.test.ts` foram invertidas; o arquivo agora cobre F1 a F6 (42 testes).

| ID | Correção | Teste |
|---|---|---|
| F1 | `metrics/agent-metrics.ts`: records de `outcomes`/`tools`/`models` criados com `Object.create(null)` (`emptyAgentPoint` e `mergeRecord`); `addCapped` usa `Object.prototype.hasOwnProperty.call` em vez de `in`; `mergeRecord` reidrata qualquer objeto vindo do `JSON.parse` num record sem protótipo, só por `Object.entries` (chaves próprias). `__proto__` vira chave comum. Data source e resolvers só leem esses records por `Object.entries`, nenhuma outra leitura indexada por conteúdo. | `constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `__proto__`, `__defineGetter__` como tool, modelo e finishReason, antes e depois do merge de leitura; sem poluição global; cap `(other)` intacto |
| F2 | `agent/limits.ts`: `AGENT_RUN_ID_CHARS = 120` (fixo, exportado) e `clipId` idempotente (corta em 119 + `…`). Escrita: recorder aplica em `model`, nome de tool, `finishReason`, tipo de card, `conversationId`. Leitura: `applyAgentRunDetail` (whitelist de toda escrita e leitura) recorta de novo esses campos e summary/título a 240; `addCapped` recorta toda chave de rollup (inclusive de ponto persistido); `agentRunIndexEntry` e `_toListItem` recortam job name, modelo, outcome e nomes da cadeia. Com isso o fallback esqueleto do `formatAgentRunLine` também fica limitado. | escrita pelo helper, linha forjada, ponto persistido, entrada do índice lida do Redis |
| F3 + (d) | `defaultSummarize` só lista chaves quando todas as exibidas casam `/^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/`; senão `object (N keys)`. Ramo de várias listas: `K lists: n, m`. Limitação (chave tipo identificador que é dado, ex. username) documentada em `docs/agent-runs.md` § Tool summaries e na skill § 2.4. | chaves e-mail, chave com espaço, chave > 41 chars, schema normal preservado |
| F4 | `_agentQueues` percorre as filas configuradas e filtra por `Set(ids)`: ids repetidos ou desconhecidos não geram leitura; resultado no máximo uma entrada por fila de agente. | 10000 × mesmo id + fila sem agente + id inexistente = 1 leitura em `agentRuns` e `agentsSummary` |
| F5 + (a) | `checkAgentDetailMismatch` em `metrics/agent-metrics.ts`, usado no read (`_toView`) e no ingest do collector: `console.warn` uma vez por fila por processo, só com nome da fila e os dois níveis (sem job id nem conteúdo). Documentado em § Detail levels. | read e ingest, dedupe, mensagem sem conteúdo, silêncio quando os níveis batem |
| F6 | `note()` recorta a `textChars`. Decisão: **não** gatear por nível (nota é linha humana do app); documentado na tabela da API, em § Which level to use, em § Limits e na skill (§ 2.3 item 7 e Erros comuns). | nota longa recortada, nota com prefixo descartada |
| F7 | Registrado em `docs/agent-runs.md` § Limitations (fila chamada `X::ai`). Sem mudança de chave. | n/a |
| F8 / (c) | Doc trocada: sanear o erro **antes** do `fail()` e do relançamento, citando `TypeValidationError`/`InvalidToolInputError` e o `failedReason` do Bull; exemplo em `docs/agent-runs.md` § Which level to use, skill § 2.3 item 4 e `references/templates.md` § Service. | n/a |
| F9 / (b) | Doc: título de card é gravado em `basic`; como omitir (`cards.map(({ type }) => ({ type, title: '' }))`) ou usar título genérico (recomendado para saúde), em `docs/agent-runs.md` e skill § 2.3 item 3 e Erros comuns. | n/a |

Validação: `npx jest` 9 suítes, 181 testes passando; `tsc --noEmit` do root; eslint + prettier nos `.ts` alterados; build local do root e `tsc --noEmit` de express, fastify, koa, hapi e cli contra ele.

## Revalidação

**Por:** 🔒 Security Specialist, 2026-10-15. Escopo: `packages/root` e a orientação em `docs/agent-runs.md` e `skills/bull-horizon-agent-jobs/` (a `packages/ui` está fora, ainda em edição).

**Veredito final: APROVADO.** F1 a F9 e as decisões (a) a (d) foram corrigidos ou documentados conforme recomendado. Não há Critical, High nem Medium em aberto.

Verificado:
- **F1:** records de `outcomes`/`tools`/`models` sem protótipo (`Object.create(null)`), `hasOwnProperty.call` no lugar de `in`, `mergeRecord` reidrata qualquer objeto vindo do `JSON.parse` só pelas chaves próprias (`Object.entries`). `__proto__` lido do Redis vira chave própria comum (`JSON.parse` cria propriedade de dado, e atribuir em objeto sem protótipo não aciona o setter). O round trip está coberto (`security-004.test.ts:85-132`).
- **F2:** `clipId` (120) na escrita (recorder: model, tool, finishReason, tipo de card, conversationId, noop) e de novo na leitura: `applyAgentRunDetail` (whitelist de todos os caminhos), `addCapped` (toda chave de rollup, inclusive de ponto persistido), `agentRunIndexEntry` e `_toListItem`. `clipId` nunca lança (`String()` em `try/catch`) e é idempotente.
- **F3/(d):** regex `^[A-Za-z_$][A-Za-z0-9_$]{0,40}$` ancorada, sem alternância nem quantificador aninhado: linear. A limitação (chave tipo identificador que é dado) está documentada.
- **F4:** filtro por `Set` sobre as filas configuradas, então o fan-out fica limitado ao número de filas de agente.
- **F5/(a):** um aviso por fila por processo, sem job id nem conteúdo, no read e no ingest.
- **F6:** `note()` recortado a `textChars`. A decisão de não gatear por nível é aceita, com aviso explícito na doc e na skill.
- **F7, F8/(c), F9/(b):** doc e skill atualizadas (`docs/agent-runs.md:265,303,377,380,695`; skill § 2.3 e § 2.4).
- `npx jest packages/root`: 7 suítes, 153 testes passando. `tsc --noEmit` do root sem erros.

Residual (Info, não bloqueia): `_toListItem` repassa `entry.e` sem recorte de leitura e desestrutura `entry.tc` assumindo tuplas. Uma entrada de índice forjada direto no Redis (`::runs::data`) pode derrubar `agentRuns`. Isso exige escrita no Redis do monitor, que já dá controle total. Se mexer de novo, validar a forma da entrada (`Array.isArray(t)`) e aplicar `clip(entry.e, 200)`.

## Conversa e brand

**Por:** 🔒 Security Specialist, 2026-10-15. Escopo: extensão Conversa (T015 a T018: campo `c` do índice, `Query.agentConversation`, `getConversation`, `_olderMessageLikelyEvicted`, tela de conversa, `docs/agent-runs.md` § Conversation view, skill § 2.6) e o commit `c094bb6` do consumidor piloto (`app-brand/wt/brand-api-agent-run`, branch `feature/bull-agent-run`, só leitura).

**Veredito: APROVADO.** Nada Critical, High ou Medium. `npx jest packages/root`: 184 testes passando. `tsc --noEmit` do root sem erros.

### Verificado OK (Conversa)
- **`basic` não vaza texto:** cada mensagem carrega `run` vindo de `getJobRuns` → `_toView` → `applyAgentRunDetail` com o nível declarado na fila. `input.text` e `final.text` só aparecem em `full`, e uma linha `full` em fila `basic` é cortada e sinalizada (`agent-conversation.test.ts:228-251`). O índice guarda só `c` (conversationId recortado), nunca texto.
- **conversationId como chave:** `byJob` e `_toolCounts` usam `Map`; o match é uma comparação de string após `clipId` dos dois lados; `hasOwnProperty.call(entry, 'c')`. `__proto__`/`constructor` não têm efeito.
- **Limites por chamada:** uma leitura do índice inteiro (ZRANGE + HMGET, até `recentRuns`, default 2000) e no máximo 100 jobs (`AGENT_CONVERSATION_MAX_MESSAGES`), em lotes de 10, com cauda de 200 linhas cada. `queue` é um único `ID!`, sem lista para multiplicar. Só leitura, sem mutation.
- **UI:** texto do usuário e resposta passam por `SafeMarkdown` (`conversation/index.tsx:591`); sem `dangerouslySetInnerHTML`, `href` ou `src` dinâmicos.
- **Orientação:** doc (`agent-runs.md:665`) e skill (§ 2.6, Erros comuns) exigem id opaco e proíbem e-mail, telefone ou nome.

### Achados (Conversa)
| ID | Sev. | Achado | Recomendação |
|---|---|---|---|
| C1 | Low | Aliases GraphQL multiplicam a query mais cara: `{ a: agentConversation(...) b: agentConversation(...) ... }` = N × (índice inteiro + 100 leituras de log). O servidor não tem limite de custo, profundidade ou alias (débito herdado, mesma classe de `jobs`). | P3: contador por request no contexto (ex.: no máximo 2 `agentConversation` por operação) ou memoizar `getAllRecentRuns` por request/fila. |
| C2 | Low | A orientação cita "a hash" como id opaco. Hash sem salt de e-mail, telefone ou CPF é reversível por dicionário. | Doc e skill: "hash só de id interno; nunca hash de e-mail, telefone ou documento". |
| C3 | Info | `_toMessage` desestrutura `entry.tc` assumindo tuplas (mesmo residual da Revalidação). Exige escrita direta no Redis. | Validar `Array.isArray(t)` quando mexer de novo. |

### Brand `c094bb6` (verificado OK)
- `AI_AGENT` (`detail: 'basic'`, `jobs: ['reply']`) é o mesmo objeto no monitor e no worker, então não há `detailMismatch`.
- `summarizeOutput` não tem conteúdo: valor solto vira o tipo, recusa e erro ficam sem motivo, chave que não casa com identificador vira contagem. A regex é ancorada e linear.
- `safeReplyError` é aplicado **antes** de `trace.fail()` e do `throw`. `failedReason`, `stacktrace` (de um erro novo), `error` do run e a linha `[erro]` só carregam `falha da IA: <Classe>` ou mensagem própria `AiReplyError`. A mensagem real fica só no log da API e em `ai_messages`.
- O `returnvalue` do job agora é `applyAgentRunDetail(trace, 'basic')`. A whitelist descarta `images`, inputs/outputs e textos; antes o rastro completo com dado de saúde ia para o Redis. Correção relevante.
- `input.text` (mensagem da cliente) só é gravado em `full`. `conversationId` é a UUID da conversa (`gen_random_uuid()`), opaca.
- As linhas pt-BR por evento (`traceEventLine`) só incluem input de tool e mensagem de erro de tool quando `FULL`. Em `basic`: nome, summary, tokens e tempos. `note('[contexto] ...')` só traz contagens. `job.data` = `{ messageId }`.

### Achados (brand)
| ID | Sev. | Achado | Recomendação |
|---|---|---|---|
| B1 | Low | `job.progress({ label })` recebe `toolThinkingLabel(toolName, toolCall.input)`, que interpola argumentos que o LLM gerou a partir da conversa (`Buscando exercícios: ${query.slice(0, 40)}`, `bodyTerm`, dias). Isso vai para o hash do job no Redis em `basic`, fora do corte de nível. É anterior ao commit e transitório (o último passo sobrescreve com `WRITING`), mas persiste se a tentativa falhar no meio de uma tool. | No `sink.progress`, usar rótulo fixo por tool (sem argumentos) e manter o rótulo detalhado só no `thinking` do banco. |
| B2 | Info | Títulos de card vão para o Redis em `basic` duas vezes: na linha do run e na linha `[fim] ... (WORKOUT: Glúteo em casa)`. A decisão (b) aceitou isso. Hoje são nomes de treino e receita, sem diagnóstico. | Se algum tipo de card puder levar condição de saúde no título, usar título genérico (recomendação da decisão b). |
