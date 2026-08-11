// NOTA (ADR-001, memorys/architecture.md): este pacote é débito técnico
// consciente. A Apollo descontinuou suporte first-party a Hapi no
// `@apollo/server` v4, então este adapter permanece em `apollo-server-hapi`
// v3 (`graphql ^15`) enquanto express/fastify/koa/root migram para
// `@apollo/server` v4 (`graphql ^16`). O ajuste abaixo (construir o
// `ApolloServer` localmente via `createContext()`) é só para acompanhar a
// remoção de `createServer()`/`server` da classe base `BullMonitor` em
// `@bull-horizon/root` — não é o início de uma migração para v4.
import {
  BullMonitor,
  typeDefs,
  resolvers,
  PROMETHEUS_CONTENT_TYPE,
} from '@bull-horizon/root';
import {
  ApolloServer,
  ApolloServerPluginStopHapiServer,
} from 'apollo-server-hapi';
import type { Plugin, Server as HapiServer } from '@hapi/hapi';

export type InitParams = {
  auth?: string;
  hapiServer?: HapiServer;
};
export class BullMonitorHapi extends BullMonitor {
  plugin: Plugin<any>;
  private server: ApolloServer;
  async init({ auth, hapiServer }: InitParams = {}) {
    this.server = new ApolloServer({
      persistedQueries: false,
      typeDefs,
      resolvers,
      introspection: this.config.gqlIntrospection,
      plugins: hapiServer && [ApolloServerPluginStopHapiServer({ hapiServer })],
      context: async () => this.createContext(),
    });
    await this.server.start();
    this.plugin = {
      name: 'bull-horizon',
      register: async (app) => {
        app.route({
          method: 'GET',
          options: {
            auth,
          },
          path: this.uiEndpoint,
          handler: (_req, h) => {
            h.response().type('text/html');
            return this.renderUi();
          },
        });
        if (this.isPrometheusEnabled) {
          app.route({
            method: 'GET',
            options: {
              auth,
            },
            path: this.prometheusEndpoint,
            handler: async (_req, h) => {
              return h
                .response(await this.renderPrometheus())
                .type(PROMETHEUS_CONTENT_TYPE);
            },
          });
        }
        await this.server.applyMiddleware({
          app,
          path: this.gqlEndpoint,
          route: {
            auth,
          },
        });
      },
    };
  }
}
