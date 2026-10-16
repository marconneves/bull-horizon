# Métricas, histórico e Prometheus

## O que existe com e sem `metrics`

**A coleta é desligada por padrão.** Basta passar `metrics: {}` para ligar com os defaults.

| | Sem `metrics` | Com `metrics` |
|---|---|---|
| Contagens de jobs na sidebar e no **Overview** | sim (lidas ao vivo do Redis) | sim |
| Gráfico de throughput acima da lista de jobs | não | sim |
| Tela **Metrics history** | oculta | sim |
| Abas **Metrics**, **Runs** e conversa na tela Agents | ocultas (`NO_COLLECTOR`) | sim |
| Endpoint Prometheus (se ligado) | só gauges (profundidade, paused) | + contadores de throughput e tempo de processamento |

## Como é contado

O collector escuta os eventos globais `completed`/`failed` de cada fila (Bull: `global:*`; BullMQ: `QueueEvents`) e, a cada `collectInterval`, grava um ponto com `completed`, `failed`, `windowMs`, contagens por status e tempo de processamento (avg/min/max). Por isso:

- funciona igual em Bull e BullMQ e **não** depende de `removeOnComplete` deixar o job para trás;
- **só conta enquanto o processo do monitor está no ar**. Sem backfill; restart = buraco na série. É observabilidade, não contabilidade.

## Config

```ts
metrics: {
  collectInterval: { minutes: 1 }, // qualquer SimpleIntervalSchedule do toad-scheduler (seconds, minutes, hours...)
  retention: {
    raw: 4320,                             // pontos na resolução de coleta: 3 dias a 1 min
    rollups: [
      { everyMs: 3_600_000, keep: 720 },   // 30 dias por hora
      { everyMs: 43_200_000, keep: 180 },  // 90 dias em buckets de 12 h
      { everyMs: 86_400_000, keep: 365 },  // opcional: + 1 ano diário
    ],
  },
  blacklist: ['fila-ruidosa'],             // filas sem coleta (e sem agregados de agente)
  redisPrefix: 'bull_monitor::metrics::',  // default; não mude sem motivo (perde o histórico)
}
```

| Campo | Default | Nota |
|---|---|---|
| `collectInterval` | `{ minutes: 1 }` | Intervalos longos só desenham degraus |
| `retention.raw` | `4320` | 3 dias a 1 min |
| `retention.rollups` | hora × 720, 12 h × 180 | Ordem: mais fino primeiro. `[]` = só a camada bruta |
| `maxMetrics` | | Deprecated: alias de `retention.raw` (`retention.raw` vence) |
| `blacklist` | `[]` | Nomes de fila |
| `redisPrefix` | `bull_monitor::metrics::` | Mantido do bull-monitor para não quebrar histórico |

Custo de Redis: com os defaults, 90 dias custam ~5.2k pontos ≈ **1.5 MB por fila**. Os mesmos 90 dias brutos a 1 min seriam ~130k pontos ≈ 36 MB por fila. Aumente profundidade adicionando camadas, não `raw`.

Os pontos são dobrados em todas as camadas na escrita. A leitura escolhe a camada mais fina que cobre a janela pedida, e o seletor de período da UI só oferece janelas que a retenção configurada consegue responder. Os gráficos plotam **taxa por minuto** (comparável entre camadas); os totais no topo são contagem real da janela.

Limpar métricas pelo painel (`clear`) apaga todas as camadas da fila.

## O que cada tela mostra

- **Overview**: contagens ao vivo de todas as filas; com collector, throughput agregado de todas as filas (somado no servidor).
- **Lista de jobs da fila**: com collector, gráfico de throughput (completed/failed por minuto) acima da lista.
- **Metrics history**: série histórica por fila (contagens por status, throughput, tempo de processamento), com seletor de período limitado pela retenção.
- **Agents** (só com fila `ai`): Metrics/Runs/conversa dependem do collector. Ver `agent-runs.md`.

## Prometheus / Grafana

Desligado por padrão: a rota não tem auth e publica nomes de fila como labels.

```ts
new BullMonitorExpress({
  queues: [...],
  metrics: { collectInterval: { minutes: 1 } }, // necessário para os contadores
  prometheus: true,                             // ou { enabled: true, path: '/metrics' }
});
```

CLI: `bull-horizon -q minha-fila --metrics --prometheus`.

O endpoint é montado relativo ao painel: no Express/Nest montado em `/bull`, fica em `/bull/metrics`. Em Fastify/Koa/Hapi, relativo ao `baseUrl`.

| Métrica | Tipo | Labels | Significado |
|---|---|---|---|
| `bull_horizon_queue_jobs` | gauge | `queue`, `provider`, `status` | Jobs na fila por status |
| `bull_horizon_queue_paused` | gauge | `queue`, `provider` | 1 pausada, 0 rodando |
| `bull_horizon_jobs_completed_total` | counter | `queue`, `provider` | Completados desde o start do monitor (precisa de `metrics`) |
| `bull_horizon_jobs_failed_total` | counter | `queue`, `provider` | Falhos desde o start do monitor (precisa de `metrics`) |
| `bull_horizon_job_processing_time_ms` | gauge | `queue`, `provider`, `stat` | avg/min/max da última janela (precisa de `metrics`) |

Status que o provider não reporta (ex. `prioritized` no Bull) são omitidos, não zerados. Os `_total` zeram no restart do monitor; `rate()`/`increase()` lidam com isso. **Métricas de agente não são exportadas** (nomes de tool/modelo virariam labels numa rota sem auth).

Scrape (Prometheus):

```yaml
scrape_configs:
  - job_name: bull-horizon
    metrics_path: /bull/metrics
    static_configs:
      - targets: ['my-app:3000']
    # se a rota estiver atrás de basic auth:
    # basic_auth: { username: bull, password_file: /etc/secrets/bull-pass }
```

Grafana Alloy:

```alloy
prometheus.scrape "bull_horizon" {
  targets      = [{ __address__ = "my-app:3000" }]
  metrics_path = "/bull/metrics"
  forward_to   = [prometheus.remote_write.default.receiver]
}
```

Dashboard importável: `examples/grafana/dashboard.json` no repositório (profundidade, throughput, taxa de falha).

Queries úteis:

```promql
sum by (queue) (rate(bull_horizon_jobs_failed_total[5m]))           # falhas/s por fila
sum by (queue) (bull_horizon_queue_jobs{status="waiting"})            # backlog
```
