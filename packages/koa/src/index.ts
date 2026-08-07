import {
  BullMonitor,
  BullMonitorContext,
  typeDefs,
  resolvers,
} from '@bull-horizon/root';
import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { koaMiddleware } from '@as-integrations/koa';
import cors from '@koa/cors';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import type { Middleware } from 'koa';
import type { Server as HttpServer } from 'http';

export type InitParams = {
  middleware?: Middleware;
  httpServer?: HttpServer;
};

export class BullMonitorKoa extends BullMonitor {
  public router: Router;
  public async init({ middleware, httpServer }: InitParams = {}) {
    const router = new Router({
      prefix: this.baseUrl,
    });

    const server = new ApolloServer<BullMonitorContext>({
      persistedQueries: false,
      typeDefs,
      resolvers,
      introspection: this.config.gqlIntrospection,
      plugins: httpServer
        ? [ApolloServerPluginDrainHttpServer({ httpServer })]
        : [],
    });
    await server.start();

    // `apollo-server-koa` v2/v3 mounted a permissive CORS handler
    // (`@koa/cors` with `origin: '*'`) and its own `koa-bodyparser` instance
    // by default via `getMiddleware()`. `koaMiddleware` (from
    // `@as-integrations/koa`, the v4 replacement) does neither — it expects
    // `ctx.request.body` to already be parsed and doesn't touch CORS at all
    // — so both are wired explicitly here, in the same order, to preserve
    // the previous defaults.
    const apolloMiddleware = koaMiddleware(server, {
      context: async () => this.createContext(),
    });
    const gqlMiddleware: Router.IMiddleware[] = [
      // Explicit literal `origin: '*'` (not the `@koa/cors` default of
      // reflecting the request's `Origin` header) to reproduce the exact
      // old default. A literal `'*'` can't legally be combined with
      // credentialed requests per the CORS spec, whereas reflected-origin
      // can — matching the literal value avoids silently becoming *more*
      // permissive than the pre-migration behaviour.
      cors({ origin: '*' }),
      bodyParser(),
      apolloMiddleware,
    ];

    if (middleware) {
      router.use(middleware);
    }
    router.get(this.gqlBasePath, ...gqlMiddleware);
    router.post(this.gqlBasePath, ...gqlMiddleware);
    router.get('/', async (ctx, next) => {
      ctx.type = 'text/html';
      ctx.body = this.renderUi();
      await next();
    });
    this.router = router;
  }
}
