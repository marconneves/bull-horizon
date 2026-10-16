# Setup: NestJS (canônico) e outros frameworks

## Índice

1. NestJS com `@nestjs/bull` (padrão de referência)
2. NestJS com `@nestjs/bullmq`
3. Proteger a rota
4. Express puro
5. Fastify
6. Koa
7. Hapi
8. CLI standalone

## 1. NestJS com `@nestjs/bull`

Instalação (o adapter Express funciona no Nest com a plataforma Express, que é o default):

```sh
npm i @bull-horizon/express @bull-horizon/root
# runs de agente (beta): npm i @bull-horizon/express@6.5.0-beta.0 @bull-horizon/root@6.5.0-beta.0
```

Estrutura recomendada: uma pasta própria, ex. `src/bull-monitor/` com `bull-monitor.service.ts` e `bull-monitor.module.ts`. Cada fila tem um arquivo de constantes (`<fila>-queue.constants.ts`) com o nome da fila, importado por quem produz, por quem consome e pelo monitor.

### Service

O service **é** o monitor: estende `BullMonitorExpress` e recebe as filas por injeção.

```ts
// src/bull-monitor/bull-monitor.service.ts
import { BullMonitorExpress } from '@bull-horizon/express';
import { BullAdapter } from '@bull-horizon/root/dist/bull-adapter';
import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';

import { AI_AGENT, AI_QUEUE } from '../ai/ai-queue.constants';
import { MEDIA_QUEUE } from '../media/media-queue.constants';
import { PUSH_QUEUE } from '../push/push-queue.constants';
import { WALLET_QUEUE } from '../wallet/wallet-queue.constants';

/** Agrupamento cosmético das filas na sidebar do painel. */
const QUEUE_GROUPS: Record<string, string> = {
  [PUSH_QUEUE]: 'App',
  [WALLET_QUEUE]: 'App',
  [AI_QUEUE]: 'Assistentes IA',
  [MEDIA_QUEUE]: 'Mídia',
};

/**
 * Painel das filas em /bull.
 * ATENÇÃO: registrar a fila no módulo NÃO basta. O painel lista só as filas
 * injetadas AQUI. Fila nova: injetar, incluir no array e mapear o grupo.
 */
@Injectable()
export class BullMonitorService extends BullMonitorExpress {
  constructor(
    @InjectQueue(PUSH_QUEUE) push: Queue,
    @InjectQueue(WALLET_QUEUE) wallet: Queue,
    @InjectQueue(AI_QUEUE) ai: Queue,
    @InjectQueue(MEDIA_QUEUE) media: Queue,
  ) {
    const queues: Queue<unknown>[] = [push, wallet, ai, media];

    super({
      queues: queues.map(
        queue =>
          new BullAdapter(queue, {
            group: QUEUE_GROUPS[queue.name],
            // readonly: queue.name === WALLET_QUEUE, // bloqueia retry/remove/add nessa fila
            ai: queue.name === AI_QUEUE ? AI_AGENT : undefined, // só fila de agente
          }),
      ),

      // Opcional. Sem isso: sem throughput, sem Metrics history, sem abas Metrics/Runs de agente.
      metrics: {
        collectInterval: { minutes: 1 },
        retention: {
          raw: 4320, // 3 dias a 1 minuto
          rollups: [
            { everyMs: 3_600_000, keep: 720 }, // 30 dias por hora
            { everyMs: 43_200_000, keep: 180 }, // 90 dias, buckets de 12 h
            { everyMs: 86_400_000, keep: 365 }, // + 1 ano diário (opcional)
          ],
        },
      },

      // Só se houver fila de agente. USD por 1M tokens; chave = nome do modelo gravado no run.
      ai: {
        pricing: {
          'gemini-3.8-flash': { input: 0.75, output: 3.75 },
        },
      },
    });
  }
}
```

Se não houver fila de agente, remova `ai` do adapter e o bloco `ai` do monitor. `metrics: {}` liga a coleta com todos os defaults.

### Module

O módulo registra as filas (para o `@InjectQueue` resolver), provê o service, chama `init()` e monta o router como middleware.

```ts
// src/bull-monitor/bull-monitor.module.ts
import { BullModule } from '@nestjs/bull';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { BullMonitorService } from './bull-monitor.service';
import { AI_QUEUE } from '../ai/ai-queue.constants';
import { MEDIA_QUEUE } from '../media/media-queue.constants';
import { PUSH_QUEUE } from '../push/push-queue.constants';
import { WALLET_QUEUE } from '../wallet/wallet-queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: PUSH_QUEUE }),
    BullModule.registerQueue({ name: WALLET_QUEUE }),
    BullModule.registerQueue({ name: AI_QUEUE }),
    BullModule.registerQueue({ name: MEDIA_QUEUE }),
  ],
  providers: [BullMonitorService],
})
export class BullMonitorModule implements NestModule {
  constructor(private monitor: BullMonitorService) {}

  async configure(consumer: MiddlewareConsumer) {
    await this.monitor.init();
    consumer.apply(this.monitor.router).forRoutes('/bull');
  }
}
```

Importe `BullMonitorModule` no `AppModule`. O `BullModule.forRoot(...)` (conexão Redis) continua onde já está no app.

Notas:

- **Prefixo global** (`app.setGlobalPrefix('api')`): o middleware segue o prefixo do Nest conforme a versão; confira a URL final abrindo `/<prefixo>/bull` e `/bull`.
- **Body parser**: o Nest já faz parse de JSON. Se o GraphQL do painel reclamar de body consumido, use `await this.monitor.init({ disableBodyParser: true })`.
- **Checklist de fila nova**: (1) constante do nome, (2) `registerQueue` no módulo do monitor, (3) `@InjectQueue` no construtor, (4) entrar no array `queues`, (5) entrada em `QUEUE_GROUPS`.

## 2. NestJS com `@nestjs/bullmq`

Igual, trocando os imports:

```ts
import { BullMQAdapter } from '@bull-horizon/root/dist/bullmq-adapter';
import { InjectQueue, BullModule } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
// ...
queues: queues.map(queue => new BullMQAdapter(queue, { group: QUEUE_GROUPS[queue.name] })),
```

App com as duas libs: misture `BullAdapter` e `BullMQAdapter` no mesmo array.

## 3. Proteger a rota

O painel não tem autenticação. Quem alcança `/bull` lista, lê dados e logs de job, faz retry e remove, e consulta o GraphQL. Escolha uma camada **antes** do router:

1. **Borda** (preferido em produção): Cloudflare Access, VPN, ingress com OAuth2 proxy, IP allowlist. Nada muda no código. Comente no módulo que a proteção está na borda.
2. **Middleware no Nest**: guards do Nest **não** valem para rotas montadas por `consumer.apply()`; use middleware, encadeado antes do router.

```ts
// src/bull-monitor/basic-auth.middleware.ts
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function bullBasicAuth(req: Request, res: Response, next: NextFunction) {
  const user = process.env.BULL_PANEL_USER;
  const pass = process.env.BULL_PANEL_PASS;
  if (!user || !pass) return res.status(503).send('panel disabled'); // sem credencial = fechado
  const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
  const [u, p] = Buffer.from(encoded ?? '', 'base64').toString().split(':');
  if (scheme === 'Basic' && safeEqual(u ?? '', user) && safeEqual(p ?? '', pass)) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="bull"');
  return res.status(401).send('auth required');
}
```

```ts
consumer.apply(bullBasicAuth, this.monitor.router).forRoutes('/bull');
```

Alternativa pronta: `express-basic-auth`. Se o app já tem sessão/JWT, escreva um middleware que valide a sessão e o papel (ex. admin) e devolva 401/403 antes do router.

Credenciais via env, nunca no código. Se usar Prometheus, o endpoint fica sob o mesmo prefixo e passa pelo mesmo middleware: configure o scraper com a mesma credencial (ou exponha o scrape só na rede interna).

## 4. Express puro

```ts
import Express from 'express';
import Queue from 'bull';
import { BullMonitorExpress } from '@bull-horizon/express';
import { BullAdapter } from '@bull-horizon/root/dist/bull-adapter';

const app = Express();
const monitor = new BullMonitorExpress({
  queues: [
    new BullAdapter(new Queue('emails', REDIS_URL), { group: 'App' }),
    new BullAdapter(new Queue('billing', REDIS_URL), { group: 'App', readonly: true }),
  ],
  metrics: {},
});
await monitor.init(); // init({ httpServer }) habilita drain no shutdown
app.use('/bull', bullBasicAuth, monitor.router);
app.listen(3000);

monitor.setQueues([...]); // troca a lista de filas em runtime
```

## 5. Fastify

Fastify registra as rotas com caminho absoluto: informe `baseUrl`.

```ts
import Fastify from 'fastify';
import { BullMonitorFastify } from '@bull-horizon/fastify';

const app = Fastify();
const monitor = new BullMonitorFastify({ queues: [...], baseUrl: '/bull', metrics: {} });
await monitor.init({ app });
await app.register(async scope => {
  scope.addHook('onRequest', authHook); // proteção: hook no escopo encapsulado
  await scope.register(monitor.plugin);
});
await app.listen({ port: 3000 });
```

## 6. Koa

Peer dependency `koa-router`. `init` aceita um `middleware` que roda antes do router (lugar da auth).

```ts
import Koa from 'koa';
import { BullMonitorKoa } from '@bull-horizon/koa';

const app = new Koa();
const monitor = new BullMonitorKoa({ queues: [...], baseUrl: '/bull', metrics: {} });
await monitor.init({
  middleware: async (ctx, next) => {
    if (!isAllowed(ctx)) ctx.throw(401);
    await next();
  },
});
app.use(monitor.router.routes());
```

## 7. Hapi

Peer `@hapi/hapi` 20.x. O pacote segue em `apollo-server-hapi` v3 (a Apollo não suporta Hapi no v4); prefira outro framework em projeto novo.

```ts
import Hapi from '@hapi/hapi';
import { BullMonitorHapi } from '@bull-horizon/hapi';

const server = Hapi.server({ port: 3000 });
const monitor = new BullMonitorHapi({ queues: [...], baseUrl: '/bull', metrics: {} });
await monitor.init();
await server.register(monitor.plugin);
await server.start();
```

Proteção: estratégia de auth do Hapi ou `server.ext('onRequest')` filtrando o prefixo `/bull`.

## 8. CLI standalone

Sem integrar com app; útil para inspeção local ou um container interno.

```sh
npm i -g @bull-horizon/cli
bull-horizon --redis-uri redis://localhost:6379 -q emails billing            # Bull
bull-horizon --bullmq --prefix bull -q emails --metrics --prometheus -p 4000  # BullMQ + métricas
```

Flags: `--redis-uri`, `-q/--queue <nomes...>`, `--bullmq`, `-p/--port` (3000), `--host` (localhost), `--prefix`, `-m/--metrics`, `--max-metrics` (4320, só a camada bruta), `--metrics-interval` (segundos, 60), `--prometheus`, `--prometheus-path` (`/metrics`). O CLI não suporta grupos, readonly, `ai` nem rollups custom: para isso use a biblioteca.
