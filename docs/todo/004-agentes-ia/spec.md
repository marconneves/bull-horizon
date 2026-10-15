# Spec 004 — Agentes IA

**Status:** 📋 Spec fechada pelo PO, aguardando Architect
**Data:** 2026-10-15
**Design de referência:** `design/06 Agentes IA.dc.html` (cópia do projeto claude.ai/design `7beca21b-…`, módulo 06)
**Consumidor piloto:** app-brand, `apps/brand-api` (NestJS), fila `brand-app:ai`, job `reply`

## Por quê

Filas que rodam agentes de IA são hoje caixas-pretas no painel. O brand-api já registra o raciocínio do agente (passos, tools, tokens). Mas no Bull isso chega só como linhas de texto em `job.log`; o JSON estruturado vive no banco do app (`ai_messages.trace`). O objetivo é que, ao declarar a fila no setup, o painel entenda o job como um *run de agente* e mostre o passo a passo, a latência, os tokens e o custo, sem tela feita sob medida para cada app.

## User Stories

- **US001** — Como quem integra, declaro no setup que uma fila (ou parte dos jobs dela) é de agente e qual o nível de detalhe, sem escrever UI.
- **US002** — Como quem integra, uso um helper da lib para gravar o run do agente no formato que o painel entende.
- **US003** — Como operador, abro um job de agente e vejo o run como grafo de passos (request, steps LLM, tools, response) com o painel do nó selecionado (input/output em árvore, métricas).
- **US004** — Como operador, vejo o mesmo run como waterfall no tempo, com tokens por passo e linhas expansíveis.
- **US005** — Como operador, vejo métricas agregadas dos agentes na janela escolhida: latência p50/p95 por hora, passos por run, tools (chamadas, média, erro, sem resultado), tokens e custo por modelo, como os runs terminaram.
- **US006** — Como operador, listo os runs com a cadeia de tools, filtro (falhou, tool vazia, mais de 15s) e ordeno (recentes, mais lentos, mais caros). Clicar abre o run.
- **US007** — Como quem integra, tenho o contrato documentado e uma skill que ensina a instrumentar e a construir jobs para essa visão.

## Regras de Negócio

1. **Ativação**: a visão só liga em filas declaradas como de agente no setup. Um job da fila é tratado como run quando o trace segue o contrato versionado (`v: 1`). Fora disso, o job aparece como job comum.
2. **Nível de detalhe por fila, escolhido por quem integra**:
   - `full`: input/output das tools e texto dos passos e da resposta final vão para o Redis.
   - `basic`: só modelo, tentativa, tempos, tokens, `finishReason`, nome/ok/duração/`summary` das tools e os cards (tipo + título). Sem input/output de tool nem texto.
   - O corte acontece **no processo do app, antes de gravar**. O painel nunca recebe o que o nível não permite.
3. **Contrato** parte do payload real do brand-api (`AiTrace` v1, ver `rules/trace.ts` no app-brand). Reserva `input.conversationId` e `input.text` (fala do usuário, só no nível `full`) para a aba Conversa (entrou no mesmo ciclo, ver a extensão no fim).
4. **Runs que falham também são runs**: o trace de uma tentativa que falhou (`error` preenchido) precisa chegar ao painel, ainda que o job relance o erro para o Bull tentar de novo.
5. **Agregados vêm do metrics collector**, registrados quando o run termina, em rollups com a retenção já configurada. Com o collector desligado, a aba Métricas não aparece.
6. **Custo é estimativa**: tabela por modelo (USD por 1M tokens in/out) no setup. Modelo sem preço → mostra tokens e "sem preço", nunca `$0`.
7. **Sidebar** ganha a entrada **Agents**, visível só se houver ao menos uma fila de agente.
8. Textos da UI seguem o padrão do painel atual. Visual segue o tema existente; o design é a referência de layout.

## Fora do escopo

- ~~Aba **Conversa**~~: entrou no mesmo ciclo a pedido do usuário (ver "Extensão: aba Conversa").
- Módulo 05 **Flows e traces**.
- Arquivo `bullhorizon.agents.yaml` citado no design: o preço vai na config do setup, em código.

## Critérios de Aceite (DoD)

- [ ] Contrato `v1` do trace documentado (campos, tipos, o que cada nível de detalhe mantém, exemplo real), versionado e exportado como tipo TS.
- [ ] Config de agente aceita no adapter (Bull e BullMQ), ao lado de `group`, com nível de detalhe e tabela de preço.
- [ ] Helper exportado grava o run (sucesso e falha) respeitando o nível de detalhe, sem nunca derrubar o job.
- [ ] Aba Run com grafo + painel e waterfall, alternáveis, alimentadas por um job real.
- [ ] Aba Métricas com agregados e lista de runs, alimentada pelo collector, com seletor de janela derivado da retenção.
- [ ] Modo demo (`VITE_ENABLE_MOCKS`) com dados de agente mockados.
- [ ] Skill de instrumentação escrita a partir do contrato final.
- [ ] brand-api migrado: `TraceRecorder` usa o helper, `BullMonitorService` declara `brand-app:ai` como fila de agente.
- [ ] Revisão de segurança aprovada (dado de saúde/PII no nível `full` fica restrito ao que quem integra escolheu).

## Extensão: aba Conversa (pedido do usuário em 2026-10-15)

Saiu do "fora do escopo" a pedido do usuário. Mesmo ciclo, tasks T015–T018.

- **US008** — Como operador, a partir de um run abro a conversa inteira daquele `input.conversationId`: todas as mensagens (cada uma é um job/run da fila), em ordem.
- **Opções do design:** A (conversa inteira, cada mensagem com o seu run: fala do usuário, cadeia de tools, meta de passos/tokens/tempo/custo, resposta e card, botão abrir run) e B (lista de mensagens à esquerda, passos da mensagem escolhida à direita). As duas entram, alternáveis como Graph/Waterfall (o usuário escolheu as duas opções nas outras abas).
- **Painel da conversa:** KPIs (mensagens, duração da conversa, tempo de IA, tokens in/out, custo estimado, passos e tool calls), "Mensagens no tempo" (barras = tempo do run; espaço = tempo do usuário responder) e "Tools usadas" (contagem).
- **Regras:**
  1. Agrupa por `input.conversationId` dentro da mesma fila. Run sem `conversationId` não tem conversa (o link não aparece).
  2. Fala do usuário (`input.text`) e resposta (`final.text`) só aparecem em `full`. Em `basic` a mensagem mostra "not recorded at basic detail", com meta, cadeia de tools e cards normais.
  3. Fonte: o índice de runs recentes (o mesmo da aba Runs, com o teto `recentRuns`). Conversa mais antiga que o índice fica incompleta, e a tela diz isso. Sem collector a aba não existe.
  4. Uma mensagem = a última tentativa do job (as anteriores ficam acessíveis no run).
  5. Teto de 100 mensagens por conversa na tela.
- **Entrada:** botão "View whole conversation" no painel "This run" da tela de run.
