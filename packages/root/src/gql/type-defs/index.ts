import { jobTypeDef } from './job';
import { mutationsTypeDef } from './mutations';
import { queueTypeDef } from './queue';
import { redisInfoTypeDef } from './redis-info';
import { rootQueryTypeDef } from './root-query';
import { metricsTypeDef } from './metrics';
import { agentsTypeDef } from './agents';
import { flowsTypeDef } from './flows';

export const typeDefs = [
  redisInfoTypeDef,
  jobTypeDef,
  queueTypeDef,
  metricsTypeDef,
  mutationsTypeDef,
  rootQueryTypeDef,
  // Extends Queue, Job and Query, so it comes after them.
  agentsTypeDef,
  flowsTypeDef,
];
