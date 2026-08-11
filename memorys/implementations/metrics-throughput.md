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

## Retenção em camadas (rollup na escrita)

O detalhe decai com a idade em vez do histórico ser truncado. A cada tick o
ponto fresco é dobrado em **todas** as camadas:

| Janela | Resolução | Default |
|---|---|---|
| últimos 3 dias | `collectInterval` (1 min) | 4320 pontos |
| últimos 30 dias | 1 hora | 720 buckets |
| últimos 90 dias | 12 horas | 180 buckets |

**Por que rollup e não só aumentar `maxMetrics`:** 90 dias a 1 minuto são ~130k
pontos = **~36MB de Redis por fila** (medido: 291 bytes/ponto). Com as camadas,
os mesmos 90 dias custam ~5.2k pontos ≈ **1.5MB/fila**. O limite nunca foi a
estatística, foi memória.

Camadas são configuráveis em resolução **e** profundidade (`retention.rollups`),
não hardcoded. `maxMetrics` segue funcionando como alias de `retention.raw`.

- **Chaves**: a série bruta mantém exatamente a chave que sempre teve
  (`bull_monitor::metrics::<queueId>`) — deployments existentes não perdem nada.
  Camadas ficam em `...::r<everyMs>`.
- **Merge do bucket aberto** é read-modify-write no tail (`LINDEX -1` + `LSET`),
  não acumulação em memória: um restart não pode perder bucket pela metade.
- **Regras de merge**: contadores somam; `counts` são gauges (o mais novo vence);
  `processingTime` é média **ponderada pelo número de jobs** de cada lado — média
  de médias deixaria uma janela de 2 jobs pesar igual a uma de 2000; min/max são
  min-dos-mins e max-dos-maxes.
- **`clear`/`clearAll` apagam todas as camadas** — senão "limpar métricas"
  deixaria meses de rollup para trás.
- **Leitura escolhe a camada mais fina que cobre a janela** (`_tierFor`). Janela
  além de todas as camadas → a mais grossa, para responder com o que existe em
  vez de série vazia.

## Contadores só fazem sentido normalizados

`ThroughputPoint.windowMs` e `TMetrics.windowMs` são **obrigatórios** para o
consumidor: um ponto da camada de 12h e um da bruta são ambos "um ponto", e
comparar as contagens cruas não significa nada. Por isso o gráfico da UI plota
**taxa por minuto** (`completed / (windowMs/60000)`), não contagem — senão o eixo
Y muda de significado conforme a janela selecionada e a parte antiga da série
domina a recente. Os totais grandes no topo do card seguem sendo contagem real da
janela.

## Defaults de coleta (mudados na 003)

| Config | Antes | Depois | Motivo |
|---|---|---|---|
| `collectInterval` | `{ hours: 1 }` | `{ minutes: 1 }` | 1h só desenha degraus de tamanho de fila |
| `maxMetrics` | `100` | `4320` (raw) | 3 dias na nova resolução |
| retenção total | ~4 dias | **90 dias** | via rollup, a ~1.5MB/fila |

A chave do Redis da série bruta **não** foi versionada de propósito: pontos
antigos apenas não têm `completed`/`failed`, e a UI os trata como nulos.
Versionar descartaria o histórico de quem já coletava.

## A UI não hardcoda janelas

`Query.metricsInfo` devolve `collectIntervalMs` + `retentionMs` (o span da camada
mais larga). O seletor de tempo (`screens/shared/time-range.ts`) monta a lista de
janelas a partir disso — oferecer `90d` sobre uma retenção de 3 dias seria um
gráfico vazio com rótulo confiante. Ao mudar `retention`, a UI acompanha sozinha.

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
