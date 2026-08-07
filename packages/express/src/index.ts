import {
  BullMonitor,
  BullMonitorContext,
  typeDefs,
  resolvers,
} from '@bull-monitor/root';
import { ApolloServer } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { expressMiddleware } from '@as-integrations/express4';
import cors from 'cors';
import Express from 'express';
import type { Server as HttpServer } from 'http';

const expressVersion = require('express/package.json').version;
const defaultInitParams = {
  disableBodyParser: expressVersion.startsWith('5') ? true : undefined,
};

export type InitParams = {
  disableBodyParser?: boolean;
  httpServer?: HttpServer;
};

export class BullMonitorExpress extends BullMonitor {
  public router: Express.Router;
  async init({
    disableBodyParser,
    httpServer,
  }: InitParams = defaultInitParams) {
    const router = Express.Router();
    router.get('/', (_req, res) => {
      res.type('html');
      res.send(this.renderUi());
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

    // `apollo-server-express` v2/v3 mounted a permissive CORS handler and its
    // own body parser by default via `applyMiddleware()`. `expressMiddleware`
    // (from `@as-integrations/express4`, the v4 replacement) does neither, so
    // both are wired explicitly here to preserve the previous defaults.
    // `disableBodyParser` keeps its original meaning: skip our JSON parser
    // when the consumer's app (or, historically, Express 5's native body
    // parsing) already handles it, to avoid double-parsing the request body.
    const gqlMiddleware: Express.RequestHandler[] = [cors()];
    if (!disableBodyParser) {
      gqlMiddleware.push(Express.json());
    }
    gqlMiddleware.push(
      expressMiddleware(server, {
        context: async () => this.createContext(),
      })
    );
    router.use(this.gqlBasePath, ...gqlMiddleware);

    this.router = router;
  }
}
