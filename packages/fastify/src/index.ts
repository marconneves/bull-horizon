import {
  BullMonitor,
  typeDefs,
  resolvers,
  PROMETHEUS_CONTENT_TYPE,
} from '@bull-horizon/root';
// Separate `import type` rather than an inline `type` modifier: the repo's
// eslint parser (typescript-eslint v4) cannot parse the inline form, which
// left this file silently unlinted.
import type { BullMonitorContext } from '@bull-horizon/root';
import { ApolloServer, HeaderMap } from '@apollo/server';
import type { HTTPGraphQLRequest } from '@apollo/server';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import fastifyCors from 'fastify-cors';
import { Readable } from 'stream';
import type {
  FastifyPluginCallback,
  RegisterOptions,
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import type { ApolloServerPlugin } from '@apollo/server';

/**
 * `@apollo/server` v4 dropped its constructor-level `dataSources` option and
 * every first-party framework integration except Express. The community
 * package that fills that gap for Fastify, `@as-integrations/fastify`, only
 * ever shipped versions requiring `fastify@^4.4.0` (and, from v3.0.0 on,
 * `fastify@^5.3.0`) — there is no published version compatible with
 * Fastify 3.x. Bumping the Fastify major here is explicitly out of scope
 * for this migration (see ADR-001 / "Decisão 2" in `memorys/architecture.md`
 * — Fastify/Express major bumps are a separate, not-yet-opened demand), so
 * pulling in that package would force a bump we're not allowed to make yet.
 *
 * Instead this adapter talks to `@apollo/server`'s framework-agnostic core
 * directly (`server.executeHTTPGraphQLRequest`), the same primitive every
 * official/community integration (including `@as-integrations/fastify`)
 * builds on top of. The request/response translation below is intentionally
 * modeled closely on how that package implements it, so behavior (landing
 * page on GET+Accept:text/html, CORS preflight, chunked/deferred responses)
 * stays equivalent — it's just wired directly against Fastify 3's API
 * instead of Fastify 4/5's.
 */
function fastifyRequestToGraphQLRequest(
  request: FastifyRequest
): HTTPGraphQLRequest {
  const headers = new HeaderMap();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
  }
  return {
    method: request.method.toUpperCase(),
    headers,
    search: new URL(request.url, `${request.protocol}://${request.hostname}/`)
      .search,
    body: request.body,
  };
}

function fastifyAppClosePlugin(app: FastifyInstance): ApolloServerPlugin {
  return {
    async serverWillStart() {
      return {
        async drainServer() {
          await app.close();
        },
      };
    },
  };
}

export type InitParams = {
  app: FastifyInstance;
};

export class BullMonitorFastify extends BullMonitor {
  public plugin: FastifyPluginCallback;
  private _server: ApolloServer<BullMonitorContext>;

  async init({ app }: InitParams) {
    this._server = new ApolloServer<BullMonitorContext>({
      persistedQueries: false,
      typeDefs,
      resolvers,
      introspection: this.config.gqlIntrospection,
      plugins: [
        fastifyAppClosePlugin(app),
        ApolloServerPluginDrainHttpServer({ httpServer: app.server }),
      ],
    });
    await this._server.start();

    this.plugin = (instance, _opts: RegisterOptions, done) => {
      // Scoped registration so CORS only applies to the GraphQL route,
      // mirroring `apollo-server-fastify`'s previous default (`cors`
      // enabled unless explicitly disabled) without touching the UI route
      // registered below on the parent `instance`.
      instance.register(async (gqlScope) => {
        gqlScope.register(fastifyCors);
        gqlScope.route({
          method: ['GET', 'POST', 'OPTIONS'],
          url: this.gqlEndpoint,
          handler: async (request: FastifyRequest, reply: FastifyReply) => {
            const httpGraphQLResponse =
              await this._server.executeHTTPGraphQLRequest({
                httpGraphQLRequest: fastifyRequestToGraphQLRequest(request),
                context: async () => this.createContext(),
              });
            for (const [key, value] of httpGraphQLResponse.headers) {
              reply.header(key, value);
            }
            reply.code(httpGraphQLResponse.status ?? 200);
            if (httpGraphQLResponse.body.kind === 'complete') {
              reply.send(httpGraphQLResponse.body.string);
              return;
            }
            reply.send(Readable.from(httpGraphQLResponse.body.asyncIterator));
          },
        });
      });
      instance.get(this.uiEndpoint, (_req, reply) => {
        reply.type('text/html').send(this.renderUi());
      });
      if (this.isPrometheusEnabled) {
        instance.get(this.prometheusEndpoint, async (_req, reply) => {
          reply
            .type(PROMETHEUS_CONTENT_TYPE)
            .send(await this.renderPrometheus());
        });
      }
      done();
    };
  }
}
