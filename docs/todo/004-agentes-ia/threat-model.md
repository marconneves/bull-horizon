# Threat Model 004: Agentes IA

**Status:** 🏛️ Levantado pelo Architect, aguardando validação do 🔒 Security
**Data:** 2026-10-15
**Base:** `architecture.md` desta task + Modelo de Ameaças em `memorys/architecture.md`

## Contexto

O painel não tem auth nativa: quem alcança a rota lê e escreve tudo nas filas. Esta feature **não muda** isso, mas aumenta o que fica legível ali: o raciocínio do agente (passos, tools, textos) passa a morar no Redis, dentro dos logs do job. O piloto (brand-api) lida com dado de saúde de cliente final. Hoje esse conteúdo fica fora do Redis de propósito.

## Ativos

| Ativo | Onde fica | Nível |
|---|---|---|
| Input/output de tool (ex.: resumo de saúde, perfil) | `job.log` | só `full` |
| Texto dos passos e resposta final | `job.log` | só `full` |
| Fala do usuário (`input.text`) | `job.log` | só `full` |
| Resumos de tool, títulos de card, mensagem de erro | `job.log` + índice de runs | `basic` e `full` |
| Nome de modelo, nomes de tool, tokens, tempos | `job.log` + rollups | `basic` e `full` |
| Tabela de preço | memória do processo (config) | n/a |

## Pontos que o Security deve validar

### 1. Corte de detalhe acontece antes do Redis (crítico)
- O helper aplica `applyAgentRunDetail` **antes** do `job.log`. Verificar que nenhum caminho grava o `recorder.run` sem corte (ele é o run completo, para o app).
- Teste obrigatório: em `basic`, varrer recursivamente o objeto gravado e garantir ausência de `input`/`output`/`error` em tools, `text` em passos, `final.text`, `input.text`. Inclui o caminho de degradação de 64 KB e o caminho `fail()`.
- Default do nível é `basic`. `ai: true` também é `basic`. Confirmar que nenhum default cai em `full`.
- O servidor corta de novo ao servir conforme o `detail` declarado na fila (`detailMismatch`). Isso **não** remove o dado do Redis. Avaliar se o mismatch deve também gerar `console.warn` no monitor.

### 2. `full` = PII no Redis, legível por qualquer um no painel
- Em `full`, o conteúdo fica em `<job>:logs`, visível no modal de Logs **mesmo fora da tela Agents** e via GraphQL `Job.logs`. A única barreira é a do app (auth na rota do painel).
- Exigir na doc do contrato e na skill: `full` só em fila de teste/investigação, ou com o painel atrás de auth. Recomendar explicitamente `basic` para filas com dado sensível.
- Retenção: o conteúdo vive enquanto o job vive (`removeOnComplete: N`). Documentar que reduzir N reduz exposição.
- Backups/RDB/AOF do Redis passam a carregar esse conteúdo em `full`.

### 3. Campos livres que passam no `basic`
- `summary`: texto do app. O default da lib é sem conteúdo (contagens, nomes de chave, tipo do primitivo). Validar o default e documentar que `summarize` customizado é responsabilidade de quem integra. O default do brand (`clip(String(output), 80)` para primitivo) vaza valor e **não** foi copiado.
- Nomes de chave em `"object (k1, k2)"`: vazam schema, não valor. Aceito?
- `final.cards[].title`: incluído no `basic` por decisão da spec. Título pode ser sensível ("Plano para diabetes"). Confirmar aceite ou pedir opção de omitir.
- `input.conversationId`: id opaco, no `basic`. Aceito.

### 4. Mensagem de erro no `basic`
- `error` do run fica no `basic` (500 chars) e no índice (200). Equivale ao `failedReason` que o Bull já grava. Mas erro de SDK de LLM pode ecoar trecho de prompt/resposta. Decidir: manter, ou no `basic` reduzir a uma classe (`error.name`) + primeiros N chars.
- `tools[].error` **fica fora** do `basic` (só `ok: false`). Validar.

### 5. Tamanho e DoS
- Escrita: tetos por campo (2048 output/input, 4000 texto, 500 erro, 120 summary), 50 passos, 50 tools/passo, 20 cards, linha de 64 KB com degradação.
- Leitura: parser ignora linha > 512 KB, `getJobLogs` limitado à cauda (200 linhas), JSON validado por forma; linha malformada é ignorada sem derrubar a query.
- Rollups: no máximo 50 tools e 20 modelos por ponto (`(other)` absorve o resto). Um job malicioso na fila não explode a cardinalidade.
- Índice de runs: capado em `recentRuns` (default 2000) por fila, trim no mesmo `MULTI`.
- Pior caso de memória por fila de agente: ~9 MB raw + ~2 MB camadas + ~0.6 MB índice. Validar como aceitável.

### 6. Spoofing de linha de run
- Qualquer código com acesso à fila pode escrever uma linha com o prefixo. Só é lida em fila/job declarados como agente, validada por forma, e no máximo distorce métricas. Severidade baixa; registrar.

### 7. XSS na UI
- `text`, `final.text`, `input.text`, `summary`, títulos de card, nomes de tool e modelo vêm do LLM ou do app. Nunca viram HTML. Por decisão do usuário (2026-10-15), textos de passo e resposta final passam pelo `SafeMarkdown` próprio (negrito, itálico, código inline, quebras e listas, montados como elementos React). Validar: ausência de `dangerouslySetInnerHTML` e de lib de markdown; link, imagem e HTML cru aparecem literais; entrada patológica (asteriscos aninhados, texto de 4000 chars) não trava o parser (sem regex com backtracking catastrófico).
- `JsonTreeView` para input/output: confirmar que não interpreta HTML.

### 8. Exposição sem auth (herdado)
- Queries novas são só leitura. Nenhuma mutation nova.
- `agentRuns` permite listar runs de todas as filas de agente numa chamada: mesma superfície do `jobs`, sem agravante além do conteúdo dos itens 2 a 4.
- Métricas de agente **não** vão para o `/metrics` Prometheus neste ciclo (nomes de tool e modelo virariam label em rota sem auth).

### 9. Helper dentro do processo do app
- Nunca lança nem rejeita (`try/catch` em toda superfície, `onError` opcional). Uma falha de Redis não pode virar falha de job nem retry extra (o que dispararia nova chamada paga ao LLM).
- Sem dependências novas no `@bull-horizon/root` (nada de `ai`, nada de sketch/t-digest): superfície de supply chain inalterada.

## Fora do escopo desta revisão
- Auth nativa do painel (débito conhecido, `business.md` § 3).
- Aba Conversa (vai agrupar por `conversationId` e mostrar `input.text`: reabrir este modelo quando entrar).
