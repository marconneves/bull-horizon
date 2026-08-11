# 🗺️ Roadmap — Bull Horizon

**Baseline:** `v6.3.0` · 7 pacotes · Apollo Server v4 (hapi congelado em v3) · Changesets · sem CI
**Data:** 2026-08-11
**Status:** waves 0–3 implementadas na task `docs/todo/003-overview-throughput-prometheus/` (2026-08-11).
Restam: **E6/P3** (teto de scan da busca), **E6/P4** (code-splitting da UI), **E7** (bump bull/bullmq + majors de tooling) e **E8** (auth nativa).

---

## 0. Onde estamos

| Dimensão | Estado |
|---|---|
| Dívida nº 1 herdada (Apollo EOL) | ✅ resolvida na v6.0.0 (`root`/`express`/`fastify`/`koa`) |
| `packages/hapi` | ⚠️ deliberadamente em `apollo-server-hapi` v3 (EOL) + `graphql ^15` — ADR-001 |
| Versionamento | ✅ Changesets (ADR-002), release manual via `make version` / `make publish` |
| CI/CD | ✅ `.github/workflows/ci.yml` — lint + jest + bootstrap + build em PR e na main |
| Métricas | ✅ throughput por eventos, 1 min de resolução, **90 dias** de retenção via rollup (3d @1min → 30d @1h → 90d @12h), configurável |
| Auth/authz | ❌ inexistente — GraphQL montado sem controle de acesso (issues upstream #57/#58) |
| UI | React 17 + MUI v5 + Vite 2, bundle **único** servido do jsDelivr |
| Deps de fila | drift: `root` = `bull ^3.27` / `bullmq ^1.57`; `cli` = `bull ^4.0` / `bullmq ^1.76` |

---

## 1. Épicos

### E1 — Throughput real no core (fundação)
**Prioridade:** P1 · **Esforço:** M · **Risco:** médio · **Bloqueia:** E2, E3

**Problema.** O `MetricsCollector` persiste um *snapshot* de `queue.getJobCounts()` por tick. Isso **não é throughput**: `counts.completed` é o tamanho do set `completed` no Redis, que encolhe com `removeOnComplete` e some quando a fila é limpa. Além disso o default é `collectInterval: { hours: 1 }` com `maxMetrics: 100` — ou seja, ~4 dias de resolução horária, nada perto dos "trabalhos/min" das telas do bull-board.

**Por que não copiar o bull-board.** O bull-board lê `queue.getMetrics()` **nativo do BullMQ**. Essa API não existe no `bullmq@1.76` que está instalado (verificado nos typings) e **não existe em nenhuma versão do Bull v3/v4**. Copiar a abordagem obrigaria a subir BullMQ para v5 *e* abandonaria os usuários de Bull — contra a regra de negócio de suporte dual.

**Solução proposta.** Estender o collector que já existe. Ele **já** intercepta `onGlobalJobCompletion` para calcular tempo de processamento — basta contar os eventos por janela:
- Adicionar `onGlobalJobFailure` ao `Queue` abstrato + implementação nos dois adapters (`global:failed` no Bull; `QueueEvents` `failed` no BullMQ).
- Acumular `completed` / `failed` por intervalo → série `completedRate` / `failedRate` própria, idêntica para Bull e BullMQ.
- Rever defaults: `collectInterval` para a casa do minuto, `maxMetrics` proporcional à retenção desejada (buckets 1m / 1h / 1d com rollup, para não estourar a list do Redis).

**Riscos / decisões pendentes (Architect):**
- Mudar `collectInterval` quebra a continuidade da série já gravada sob `bull_monitor::metrics::` — precisa de versionamento de chave (ex.: `::v2::`) ou migração.
- O contador só vale enquanto o processo do monitor está vivo e conectado. Reinício = buraco na série. Documentar explicitamente (é a diferença honesta entre "métrica de observabilidade" e "contabilidade").

---

### E2 — Gráfico de throughput no topo da fila
**Prioridade:** P2 · **Esforço:** S · **Risco:** baixo · **Depende de:** E1
*(referência: screenshot 1 — "Taxa de transferência (trabalhos / min)")*

Card colapsável acima da lista de jobs, na tela da fila: totais de concluídos/falhos + série temporal com seletor `60m / 7d / 30d / 90d`. Reaproveita `recharts` (já instalado) e o padrão de `screens/metrics/charts`. Estado colapsado persistido junto com as outras preferências em `stores/`.

---

### E3 — Tela "Histórico de métricas" (global)
**Prioridade:** P2 · **Esforço:** M · **Risco:** baixo · **Depende de:** E1
*(referência: screenshot 2)*

Visão agregada de **todas** as filas + tabela "Por fila" (barra de execuções, concluídos, falhos, % de falha).

**Ponto de atenção arquitetural:** agregar isso no client significa baixar N séries completas a cada polling. Precisa de uma query nova que agregue **no servidor** (`metricsSummary(range)`), não de N chamadas ao `Query.metrics` atual.

---

### E4 — Tela "Overview" de filas
**Prioridade:** P1 · **Esforço:** S · **Risco:** baixo · **Depende de:** nada
*(referência: screenshot 3)*

Grid de cards, um por fila, com barra empilhada de status + total de tarefas, filtrável pela aba de status. **Não depende do E1** — os dados já vêm de `GetQueues.jobsCounts`. É o entregável de maior impacto visual com o menor risco: recomendado como **primeira feature**.

**Sub-feature "Sem workers":** exige `Queue.workersCount` no schema. Bull v3/v4 tem `queue.getWorkers()`; o `bullmq@1.76` instalado **não** expõe isso — ou entra atrás do bump de BullMQ (E7), ou nasce só para Bull com fallback nulo.

**Pré-requisito de performance:** essa tela multiplica a leitura de contagens. Fazer **junto** com E6/P1 ou logo depois.

---

### E5 — Exportador Prometheus (`/metrics`)
**Prioridade:** P2 · **Esforço:** M · **Risco:** médio (superfície nova) · **Depende de:** E1 (para os counters)

**Decisão: Prometheus. Um só formato resolve os três.**
Grafana Alloy e Grafana Cloud não são "destinos" alternativos — ambos **raspam** um endpoint no formato Prometheus/OpenMetrics. Expor `GET /metrics` cobre Prometheus self-hosted, Alloy (`prometheus.scrape`) e Grafana Cloud sem trabalho extra. Push via OTLP fica para depois, **se** aparecer demanda de ambiente serverless (onde scrape não funciona) — não implementar agora.

**Desenho proposto:**
- `@bull-horizon/root` exporta `renderPrometheusMetrics()`; cada adapter monta `GET <baseUrl>/metrics`; o CLI expõe por flag.
- Métricas: `bull_horizon_queue_jobs{queue,status}` (gauge), `bull_horizon_jobs_completed_total{queue}` / `_failed_total` (counter), `bull_horizon_job_duration_seconds` (histogram), `bull_horizon_queue_paused{queue}` (gauge).
- **Decisão pendente (Architect):** `prom-client` (padrão de facto, +1 dependência no core) vs. renderizar o texto à mão (~80 linhas, zero dep). Inclinação: à mão, para não engordar o pacote publicado.
- Entregar `examples/grafana/dashboard.json` junto — exportador sem dashboard de exemplo não é adotado.

🔒 **Security obrigatório:** `/metrics` é rota nova sem auth, no mesmo modelo de ameaças do GraphQL. Nomes de fila viram labels públicas. Precisa de config explícita (`metrics.prometheus: { enabled, path }`) e da decisão sobre default ligado/desligado.

---

### E6 — Performance
**Prioridade:** P1 (itens marcados) · **Esforço:** variável

Achados concretos, com localização:

| # | Achado | Onde | Impacto |
|---|---|---|---|
| **P1** | **N+1 de round-trips no Redis.** Cada field do `Queue` resolver (`isPaused`, `jobsCounts`, `count`, `*Count`) é uma ida ao Redis, sem batching nem cache por request. A `GetQueues` da UI pede `isPaused` + `jobsCounts` de **todas** as filas, com polling de **5 s** → 50 filas = 100 round-trips a cada 5 s. | `gql/resolvers/queue.ts` | **Alto** — piora linearmente com E3/E4 |
| **P2** | `Query.metrics` faz `lrange key 0 -1`: devolve a série inteira sempre, sem janela nem downsampling. Com a resolução do E1 isso explode. | `metrics-collector.ts:extract` | Alto (pós-E1) |
| **P3** | `PowerSearch` é O(n) na fila inteira, com `hgetall` de todo job em chunks de 500. Busca em fila de 1M jobs varre tudo, sem teto de tempo. | `data-search.ts` | Médio |
| **P4** | **Bundle único da UI**: `manualChunks: {}`, `cssCodeSplit: false`, `entryFileNames: main.js` — MUI + recharts + codemirror + jsonata num arquivo só, servido do jsDelivr. | `packages/ui/vite.config.ts` | Médio (TTI) |
| **P5** | `react-query` com `refetchInterval: 5000` sem `staleTime` / `keepPreviousData` → re-render e flash de loading a cada ciclo. | `providers/queues-query`, `screens/*` | Baixo, **correção barata** |
| **P6** | O polling de `GetQueues` roda mesmo com o drawer fechado / aba em background. | `providers/queues-query` | Baixo |

**Armadilha do P4:** `packages/root/src/ui.ts` monta uma URL única de bundle no jsDelivr (`@bull-horizon/ui@<versão>/build/main.js`). Habilitar code-splitting exige acertar o `base` do Vite para que os chunks também resolvam nessa origem — senão o dashboard quebra em produção.

---

### E7 — Atualizações e dívida técnica (Ops)
**Prioridade:** mista

- **P1 · `@graphql-codegen/cli@^1` → `^5`** — incompatível com `graphql ^16`; hoje obriga `--legacy-peer-deps` no bootstrap. É devDependency, não entra no bundle. *(mapeado em `architecture.md`, task nunca aberta)*
- **P1 · CI mínimo (GitHub Actions)** — lint + build + test em PR; `changeset version/publish` na main. O `guidelines.md` diz literalmente "não assuma que vai passar no CI porque não há CI". Enquanto não existir, toda validação depende de disciplina manual.
- **P2 · Drift `bull`/`bullmq`** — o ADR-001 §2 já registrou que isso vem **antes** de majors de tooling. E é o que destrava `getMetrics`/`getWorkers` nativos (relevante para E1/E4).
- **P3 · Majors de tooling** — TypeScript 4→5, Jest 26→29, ESLint 7→9, **Vite 2→6** (Vite 2 é de 2021 e segura o build da UI), React 17→18.
- **P3 · `packages/hapi`** — decisão a reabrir: manter congelado em Apollo v3 (EOL), escrever integração custom, ou descontinuar o pacote.

---

### E8 — Segurança / Auth nativa
**Prioridade:** P2, sobe para P1 se E5 entrar

Sem auth, qualquer um que alcance a rota tem leitura **e escrita** total sobre as filas. Issues upstream `#57` (auth) e `#58` (Redis ACL) nunca foram implementadas. Referência de mitigação: o fork da issue `#82` (Basic Auth via `--user`/`--password` no Express).

Cada tela nova (E3, E4) e cada rota nova (E5) aumenta essa superfície. Não é bloqueio formal hoje, mas a conta cresce.

---

## 2. Sequência recomendada

| Wave | Conteúdo | Por quê |
|---|---|---|
| ✅ **0 — Destravar** | E7: codegen `^5` + CI mínimo · E6/P5 | Barato, remove atrito de todo o resto e para de depender de validação manual |
| ✅ **1 — Valor visual rápido** | **E4** (overview de filas) + **E6/P1** (batching do Redis) | Maior impacto visível, zero dependência de E1; o P1 tem que vir junto porque a tela amplifica o N+1 |
| ✅ **2 — Fundação de métricas** | **E1** (throughput no core) → **E2** (gráfico por fila) → **E3** (histórico global) · E6/P2 dentro do E1 | E2 e E3 são casca; sem o E1 os números não existem |
| 🟡 **3 — Observabilidade externa** (P4 adiado) | **E5** (Prometheus) + `examples/grafana` · E6/P4 (code-splitting) | Reaproveita os counters do E1 |
| ⬜ **4 — Base** | E7 (bull/bullmq → tooling majors) · **E8** (auth) | Depois que as features pararem de mexer nas mesmas superfícies |

---

## 3. Perguntas em aberto (gate de completude do PO)

1. **E1 — retenção e resolução:** quanto de histórico o produto promete? (o seletor `90d` da screenshot 1 implica rollup, não uma list crua no Redis)
2. **E4 — "Sem workers":** aceita nascer só para Bull (nulo em BullMQ) ou espera o bump do BullMQ?
3. **E5 — `prom-client` ou render à mão?** E `/metrics` nasce ligado ou desligado por default?
4. **E5 — labels:** nome de fila em label é aceitável? (vaza topologia interna num endpoint sem auth)
5. **E7 — hapi:** manter, migrar ou descontinuar?
