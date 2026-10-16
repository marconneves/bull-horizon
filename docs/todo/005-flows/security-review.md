# Security Review 005: Flows (T017) + marcador de skip de agente

**Revisor:** 🔒 Security Specialist
**Data:** 2026-10-16
**Escopo:** `packages/root/src/flow/` (`contract.ts`, `definition.ts`, `trace.ts`, `yaml.ts`), `shared/attempt.ts`, `metrics/histogram.ts`, `metrics/flow-metrics.ts`, `gql/type-defs/flows.ts`, `gql/data-sources/flows/`, marcador de skip em `packages/root/src/agent/` (`skip`, `markAgentRunSkipped`, `AGENT_RUN_SKIP_LOG_PREFIX`) e a renderização em `packages/ui/src/screens/flows` (`_trace`, YAML, returnvalue/stacktrace na timeline). Base: `spec.md`, `architecture.md` § 7 e § 7.1, `qa-report-backend.md`.
**Validação:** `npx jest packages/root` com 328 testes passando; `tsc --noEmit` do root sem erros.

## Veredito

**APROVADO COM RESSALVAS.** Nenhum achado Critical ou High. O `_trace` é tratado como entrada não confiável de ponta a ponta (parse por campo, só propriedades próprias, recortes, limite de hop), e a UI só renderiza texto. Há 1 Medium: amplificação de leitura do `flowTrace` (até 64 filas × 500 jobs por chamada, multiplicável por aliases, sem auth). Não bloqueia porque a rota sem auth já permite mutações destrutivas, mas recomendo tratar antes de anunciar a feature. Os demais achados são Low/Info.

## Achados

| ID | Sev. | Achado | Local |
|---|---|---|---|
| S1 | Medium | `flowTrace`: amplificação de leitura no Redis do app | `gql/data-sources/flows/index.ts` (`getTrace`, `_scanPending`, `_scanQueue`) |
| S2 | Low | `startedAt` do `_trace` (controlado pelo app) é o score do índice de traces: um valor futuro fixa traces e faz o despejo apagar os novos | `metrics/flow-metrics.ts:796` (`zadd ... trace.startedAt`), `:813-834` (`_evict`) |
| S3 | Low | Chave de negócio no índice vira oráculo de existência numa rota sem auth | `flow-metrics.ts` (`_keysOf`, `tracesByKey`) |
| S4 | Info | `zlexcount` do teto `jobsPerTrace` usa limite superior `~`: fila com nome iniciado por caractere acima de `~` (não ASCII) não conta para o teto | `flow-metrics.ts` (`_index`, faixa `(${id}${SEP}~`) |
| S5 | Info | Trace forjado ou id implícito colidente (`<fila>:<jobId>`) junta jobs em trace alheio | `flow/trace.ts`, `implicitTraceId` |
| S6 | Info | Regex de realce do `YamlLine` tem retrocesso em `\s*` + `.*?:`; entrada é YAML gerado da config do operador, linhas curtas | `packages/ui/src/screens/flows/ConfigTab.tsx:135` |

### S1 (Medium): amplificação do `flowTrace`

Contagem de leituras de uma chamada `flowTrace(flow, query)` no pior caso:
- até 64 `getJob` (`_findJob`, filas distintas do flow);
- índice: `hasTrace`, `zrangebylex` de chave, `traceMeta`, até 20 `readTrace` de candidatos e até 4 junções implícitas (baratas, só índice);
- `_buildTrace` → `_scanPending`: para **cada** fila distinta (≤ 64), até `pendingScanLimit` jobs (default 500, teto configurável 10000) em páginas de 100 por status. São **até 32.000 leituras de hash de job com `JSON.parse` do `data`** com o default, e 640.000 no teto configurável.

O passo 4 (G4) roda a varredura completa para **qualquer** valor que case `FLOW_TRACE_ID_PATTERN` (`[A-Za-z0-9_.:-]{1,64}`), inclusive um id que não existe (ex.: `"x"`). Toda resposta com trace também varre. Sem auth e sem limite de alias/custo no GraphQL, `{ a: flowTrace(...) b: flowTrace(...) ... }` multiplica isso por N. Cada flow (até 32) relê as filas que compartilha com os outros. A busca por dados existente (`textSearchScanCount`) lê 500 jobs de **uma** fila: o `flowTrace` é até 64 vezes maior por chamada, e atinge o Redis de produção do app (o mesmo dos workers).

**Correção (P1/P2):**
1. Orçamento por request no contexto GraphQL: no máximo 1 ou 2 `flowTrace` por operação (ou um orçamento total de jobs lidos por request), e memoização da varredura por (fila, traceId) dentro do request.
2. Passo 4 só quando o índice não tem nada **e** o valor tem cara de trace id gerado (`tr_` + 16 hex) ou veio no argumento `traceId`; senão `NONE` sem varrer.
3. Documentar em `docs/flows.md` que `pendingScanLimit` multiplica pelo número de filas do flow, e recomendar painel atrás de auth e rate limit.

### S2 (Low): `startedAt` como score de despejo

`_index` faz `ZADD NX <tracesKey> trace.startedAt id`, e `_evict` remove os menores scores. `parseTrace` só exige `startedAt` finito e ≥ 0. Um worker com relógio errado, um bug (ms × 1000) ou um `_trace` forjado com `startedAt` no futuro ocupa vagas que nunca são despejadas. Com `recentTraces` cheio desses, todo trace novo e legítimo é despejado logo após ser inserido e o índice para de funcionar. `startedAt = 0` faz o oposto (despejo imediato). O tempo ponta a ponta (`e2e`) também usa esse valor (distorção de métrica, sem risco). **Correção:** usar como score o tempo de ingestão (ou `min(startedAt, agora + tolerância)`), mantendo `startedAt` só como dado exibido. Recortar `e2e` a valores plausíveis.

### S3 (Low): chave de negócio como oráculo

A chave e os aliases (ex.: `videoId`) ficam no índice até o despejo, e `flowTrace` responde a uma busca exata por eles. Sem auth, quem alcança a rota consegue testar se um valor (ex.: um e-mail, se o app escolher mal a chave) passou pelo flow, e vê o trace. **Decisão sobre a opção de hash (pergunta do Architect): não exigir.** Hash de valor de baixa entropia (e-mail, telefone, CPF) é reversível por dicionário e daria falsa segurança. Exigência de doc: `docs/flows.md` e a skill devem dizer que `trace.key`/`aliases` devem ser ids internos opacos (`videoId`, UUID), nunca e-mail, telefone, documento ou nome, e que a chave é pesquisável por qualquer um que alcance o painel.

## Verificado OK

- **`_trace` como entrada não confiável:** `parseTrace` lê só propriedades próprias (`hasOwn`), valida `v`, `traceId` (`^[A-Za-z0-9_.:-]{1,64}$`), `flow` (`^[a-z0-9_.:-]{1,64}$`), `startedAt` e `hop` finitos, `hop ≤ 64`, recorta `key` (128) e `parent` (128 por campo), descarta o resto e devolve um objeto novo. `clipText` remove `\u0000`, o separador dos membros do índice, então chave e ids não atravessam o separador das faixas lexicográficas. `withTrace`/`continueTrace` param no hop 64. `continueTrace` aceita no máximo 512 chars base64url, com regex ancorada e `JSON.parse` em `try/catch`. Sem assinatura de propósito (observabilidade, não autorização; S5).
- **Chaves de protótipo:** `readPath` rejeita `__proto__`/`prototype`/`constructor`, limita a 8 segmentos e 128 chars e segue só propriedades próprias. `isValidTraceField` exige um identificador. `attach` usa `defineProperty`. Agregados com `Object.create(null)` e `hasOwn`; recortes nas chaves de rollup (`FLOW_EDGE_KEY_CHARS`).
- **Índice e despejo:** traces capados em `recentTraces`, jobs por trace em `jobsPerTrace` (marcador `~x` acima disso), chaves por trace em `FLOW_MAX_KEYS_PER_TRACE`. As chaves são espelhadas sob o prefixo do trace, então o despejo remove jobs, chaves, meta e o membro do zset no mesmo `MULTI`, sem órfãos (exceto S2 e S4).
- **YAML:** gerado no servidor a partir da config normalizada (`yamlScalar` usa `JSON.stringify` em tudo que não é plain seguro; quebras de linha e `: ` ficam escapadas). Na UI vai em `<pre>` com spans React, só texto. `PLAIN` e `RESERVED` são regex ancoradas e lineares.
- **Timeline (returnvalue/stacktrace):** lidos sob demanda por `Query.job` (a mesma query e a mesma exposição da tela Jobs) e renderizados em `JsonBlock` (`<pre>{text}</pre>`). Nada novo vaza: `failedReason` no índice e no job ao vivo fica só na primeira linha, recortada (120/160). Sem `dangerouslySetInnerHTML`, `href`, `src` nem markdown em `screens/flows`.
- **Checks de config:** mensagens recortadas a 500 chars, ecoam só a config do operador (já exposta como YAML), nunca dado de job. O `console.warn` só cita ids de flow.
- **Skip de agente:** a razão passa por `clipId` (120) na escrita, a linha tem teto de 4 KB na leitura e guarda de forma, e o prefixo `bull-horizon:agent-run-skip ` não colide com o da linha de run. `note()` descarta linhas com qualquer um dos dois prefixos. A razão só é contada (`skipped`), nunca servida pelo GraphQL (aparece crua só no modal de Logs, como qualquer linha). `skip()` e `markAgentRunSkipped` nunca lançam nem rejeitam (timeout, `try/catch`, `onError` protegido). Doc pedida: reforçar "rótulo curto tipo id, nunca conteúdo" (já está no JSDoc).
- **Helpers no worker:** `startTrace`/`withTrace`/`continueTrace`/`encodeTrace`/`readTrace` sem I/O, com `try/catch` total, devolvem o `data` original em caso de erro e reportam por `onError` protegido. `newTraceId` usa `crypto.randomBytes`, com fallback.
- **Superfície:** só `Query` (`flowSummary`, `flowTrace`), nenhuma mutation; `query` ≤ 256; fan-out ≤ 64 filas. `prometheus.ts` não mudou (D10 mantido). Nenhum `package.json` ou lockfile alterado.

## Recomendações por prioridade

1. P1/P2: S1 (orçamento por request + passo 4 restrito).
2. P2: S2 (score por tempo de ingestão), doc de S3.
3. P3: S4 (limite superior `\u0001` como nas outras faixas), registrar S5 e S6.

## Correções (Developer, 2026-10-16)

Só `packages/root`; schema GraphQL sem mudança (o sinal de orçamento estourado é o `partial` que a UI já mostra).

- **S1** `gql/data-sources/flows/index.ts`:
  - (a) O passo 4 da busca (varredura de pendentes quando o trace id não está no índice) só roda para o formato gerado por `startTrace` (`tr_` + 16 hex, `newTraceId` em `flow/trace.ts`) ou quando o argumento `traceId` é passado. Qualquer outro texto devolve `NONE` sem ler fila.
  - (b) Orçamento por request: o `FlowsDataSource` é criado por request (`createContext`). `flowTrace` é memoizado por (flow, query, traceId), e cada request faz no máximo `FLOW_SCANS_PER_REQUEST = 2` varreduras. Passado isso, o trace vem só do índice, com `partial: true`.
  - (c) Teto total de `FLOW_SCAN_TOTAL_MAX = 2000` jobs lidos por varredura, somando todas as filas: as filas rodam em paralelo e reservam a página antes de ler. O teto de `pendingScanLimit` por fila (500) continua.
  - Testes (Bull e BullMQ): 5 aliases + 2 repetidos num request fazem no máximo 2 varreduras, as repetidas saem iguais (memo) e as excedentes saem `partial`; textos que não são trace id gerado não chamam `getJobs`; 4 filas × 600 jobs leem no máximo 2000 e saem `partial`.
- **S2** `metrics/flow-metrics.ts`: o score do zset `traces` (ordem de despejo) passa a ser a hora de ingestão no relógio do monitor. `_trace.startedAt` fica só para exibição, no meta, recortado para "agora" quando passa de `FLOW_CLOCK_SKEW_MS` (5 min) no futuro. O fim a fim negativo já era descartado. Teste: um trace com `startedAt` um ano à frente é despejado antes dos novos, e o meta fica ≤ agora.
- **S4** `_index`: a contagem do teto `jobsPerTrace` usa a faixa inteira do trace (`[id\0`, `(id\u0001`) menos os marcadores de chave e de truncamento, então conta qualquer nome ou id de fila. Teste com fila `équeue`: o terceiro job vira marcador `~x`.
- S3, S5 e S6 ficam na doc (`docs/flows.md`, com outro dev) e no registro, como recomendado.

Validação: `npx jest packages/root` 13 suítes / 338 testes verdes; `tsc --noEmit` root ok; `eslint packages/root/src` ok; build do root ok.
