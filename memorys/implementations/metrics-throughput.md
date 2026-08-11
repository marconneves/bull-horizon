# Métricas e Throughput (implementação)

> Fragmento de `memorys/architecture.md`. Cobre o `MetricsCollector`, o schema de
> métricas e o exportador Prometheus. Introduzido na task 003 (2026-08-11).

## Por que não usamos a API nativa de métricas do BullMQ

O bull-board desenha seus gráficos com `queue.getMetrics()` do BullMQ. **Não dá
para copiar**:

- `bullmq@1.76` (o instalado; `packages/root` declara `^1.57`) **não expõe**
  `getMetrics` nem `getWorkers` — verificado nos typings.
- Bull v3/v4 não tem equivalente em versão nenhuma.
- Usar a API nativa exigiria subir BullMQ para v5 **e** deixar os usuários de
  Bull sem o recurso, contra a regra de suporte dual (`business.md` § 2).

Portanto a série de throughput é **nossa**, contada a partir de eventos de fila.
Não "corrigir" isso trocando pela API nativa sem reabrir a decisão.

## Como o throughput é contado

O collector já interceptava `onGlobalJobCompletion` (para tempo de
processamento). A task 003 adicionou o hook simétrico `onGlobalJobFailure` no
`Queue` abstrato + implementação nos dois adapters (`global:failed` no Bull,
`QueueEvents` `failed` no BullMQ).

Por janela de coleta o collector emite:
- `completed` / `failed` — contadores do período, zerados a cada tick.
- `windowMs` — duração real da janela. **Obrigatório para derivar taxa/min**: a
  primeira janela após um restart é mais curta que o `collectInterval`, e pontos
  downsampled agregam várias janelas.

Além disso mantém `_totalCompleted`/`_totalFailed` acumulados desde o start do
processo — é o que o exportador Prometheus publica como `_total` (counter).

**Limitação a comunicar, não esconder:** só conta com o processo do monitor
vivo e conectado. Restart = buraco na série. É métrica de observabilidade, não
contabilidade.

## Defaults de coleta (mudados na 003)

| Config | Antes | Depois | Motivo |
|---|---|---|---|
| `collectInterval` | `{ hours: 1 }` | `{ minutes: 1 }` | 1h só desenha degraus de tamanho de fila |
| `maxMetrics` | `100` | `4320` | 3 dias na nova resolução, ~1MB de Redis por fila |

A chave do Redis (`bull_monitor::metrics::`) **não** foi versionada de propósito:
pontos antigos apenas não têm `completed`/`failed`, e a UI os trata como nulos.
Versionar descartaria o histórico de quem já coletava.

## Leitura: `extract` vs `extractSince`

- `extract(queue, start, end)` — índices de lista, comportamento original.
- `extractSince(queue, since, maxPoints)` — janela temporal. **É o caminho
  preferido.** Redis não fatia lista por valor, então a janela vira um slice de
  cauda (`lrange key -N -1`) estimado pelo `collectInterval`.

**Armadilha resolvida (achada por teste):** a estimativa assume que os pontos
estão espaçados pelo intervalo *atual*. Se o intervalo foi **aumentado** depois
da série ter sido escrita, a lista está mais densa do que a conta supõe e o
slice truncava a janela em silêncio. A implementação alarga a leitura
exponencialmente (`tail *= 4`) até alcançar `since` ou esgotar a lista. Não
simplificar isso de volta para uma leitura única.

`maxPoints` faz downsampling **no servidor**: gauges (`counts`) vêm do último
ponto do bucket, contadores (`completed`/`failed`/`windowMs`) são somados.
Média de `counts` inventaria valores que nunca existiram em instante nenhum.

## Agregação cross-queue

`getSummary(since, maxPoints)` roda no servidor. A alternativa — a UI baixar uma
série por fila e somar no browser — multiplica o payload pelo número de filas a
cada poll de 5s. Pontos de filas diferentes coletados no mesmo tick compartilham
`timestamp` (o `_collect` usa um só), então o merge é por timestamp exato.

## Exportador Prometheus

- `packages/root/src/prometheus.ts`, renderizado à mão (~140 linhas). **Não
  adicionar `prom-client`**: é um pacote que entra na árvore de dependências de
  terceiros para fazer concatenação de string.
- **Pull, não push.** Alloy (`prometheus.scrape`) e Grafana Cloud raspam o mesmo
  formato — não são destinos distintos. OTLP só faria sentido em serverless.
- **Default desligado** (`prometheus: false`). Rota sem auth que publica nome de
  fila como label. Exige opt-in explícito.
- Status que o provider não reporta (ex.: `prioritized` no Bull) são **omitidos**,
  não zerados — 0 seria indistinguível de "suportado e vazio".
- Docs e dashboard importável em `examples/grafana/`.

## Espelhamento nos mocks do demo

`packages/ui/src/demo-mocks/network/queries/downsample.ts` replica o
downsampling do servidor. Sem isso o build de demo renderiza cada minuto cru e o
gráfico vira ruído — o endpoint real nunca devolve isso. Manter os dois em
sincronia quando a regra de bucket mudar.
