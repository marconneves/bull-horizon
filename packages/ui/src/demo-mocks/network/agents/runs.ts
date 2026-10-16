// Demo data for the agents screens: the `brand-app:ai` queue, its jobs with
// one recorded run per attempt, the runs index the collector keeps and the
// aggregated series. Pure generation with a seeded RNG — no import of the
// shared mock store, which imports this module.
import { AgentRunDetail, AgentRunSource, JobStatus } from '@/typings/gql';
import type { AgentRunFieldsFragment, GetAgentRunsQuery } from '@/typings/gql';
import {
  DESIGN_RUN,
  DESIGN_RUN_DATA,
  DESIGN_RUN_JOB_ID,
  demoCost,
} from './design-run';

type TRun = AgentRunFieldsFragment;
type TStep = TRun['steps'][0];
type TTool = TStep['tools'][0];
export type TRunIndexItem = NonNullable<
  GetAgentRunsQuery['agentRuns']
>['items'][0];

export const AGENT_QUEUE_ID = 'bull:brand-app:ai';
export const AGENT_QUEUE_NAME = 'brand-app:ai';
export const AGENT_QUEUE_CONFIG = {
  jobs: ['reply'],
  detail: AgentRunDetail.Full,
  label: 'brand-app:ai',
};
/** Mirrors `AGENT_RUN_LOG_PREFIX` from `@bull-horizon/root`. */
export const AGENT_RUN_LOG_PREFIX = 'bull-horizon:agent-run ';

const MINUTE_MS = 60_000;

/** Deterministic, so a reload shows the same demo. */
const seeded = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};
const hashOf = (text: string) => {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
};

const iso = (ms: number) => new Date(ms).toISOString();

/** Moves every timestamp of a run by `deltaMs`. */
const shiftRun = (run: TRun, deltaMs: number): TRun => {
  const move = (value: string | null | undefined) =>
    value ? iso(Date.parse(value) + deltaMs) : value ?? null;
  return {
    ...run,
    startedAt: move(run.startedAt) as string,
    finishedAt: move(run.finishedAt),
    steps: run.steps.map((step) => ({
      ...step,
      startedAt: move(step.startedAt) as string,
      tools: step.tools.map((tool) => ({
        ...tool,
        startedAt: move(tool.startedAt),
      })),
    })),
  };
};

// ---------------------------------------------------------------------------
// Synthetic runs, shaped like the design's runs list.
// ---------------------------------------------------------------------------

const TOOL_IO: Record<
  string,
  (empty: boolean) => { input: unknown; output: unknown; summary: string }
> = {
  listRecipes: (empty) => ({
    input: { meal: 'BREAKFAST' },
    output: empty
      ? { recipes: [] }
      : { recipes: [{ id: 'r_118', title: 'Omelete de espinafre' }] },
    summary: empty ? '0 resultados' : '1 resultado',
  }),
  proposeRecipe: () => ({
    input: { title: 'Panqueca de banana', meal: 'BREAKFAST', kcal: 260 },
    output: { ok: true, message: 'Sugestão pronta.' },
    summary: 'objeto (ok, message)',
  }),
  getUserProfile: () => ({
    input: {},
    output: { goals: { kcal: 1800 }, restrictions: ['lactose'] },
    summary: 'objeto (goals, restrictions)',
  }),
  searchFoods: (empty) => ({
    input: { query: 'tapioca' },
    output: empty
      ? { foods: [] }
      : {
          foods: [
            { name: 'Tapioca', kcal: 130 },
            { name: 'Goma', kcal: 70 },
          ],
        },
    summary: empty ? '0 resultados' : '2 resultados',
  }),
  logMeal: () => ({
    input: { meal: 'BREAKFAST', recipeId: 'r_118', date: 'amanhã' },
    output: { ok: true, mealId: 'm_5521' },
    summary: 'objeto (ok, mealId)',
  }),
};

const REPLIES = [
  'Pronto! Deixei a refeição no seu plano de amanhã às **7h**.',
  'Encontrei duas opções rápidas:\n- tapioca com queijo\n- omelete de espinafre\n\nQual prefere?',
  'Vi no seu perfil que a meta é *1.800 kcal* por dia, então mirei em algo entre 200 e 300 kcal.',
  'Oi! Você prefere algo doce ou salgado de manhã?',
];

type TRunSpec = {
  jobId: string;
  attempt: number;
  finishedAtMs: number;
  tools: string[];
  steps: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model?: string;
  error?: string | null;
  detail?: AgentRunDetail;
  /** Default: a conversation of its own, derived from the job id. */
  conversationId?: string;
  userText?: string;
  reply?: string;
  source?: AgentRunSource;
};

/** The design's conversation: messages 1 to 4 are the jobs below. */
export const DEMO_CONVERSATION_ID = 'c-7f21';
/** A run outside any demo conversation still has one, made of itself. */
export const ownConversationId = (jobId: string) =>
  `c-${hashOf(jobId).toString(16).padStart(8, '0').slice(0, 6)}`;

/** Cuts what `basic` does not keep, like the helper does before writing. */
const toBasic = (run: TRun): TRun => ({
  ...run,
  detail: AgentRunDetail.Basic,
  input: run.input ? { conversationId: run.input.conversationId } : null,
  final: run.final ? { cards: run.final.cards } : null,
  steps: run.steps.map((step) => ({
    ...step,
    text: null,
    tools: step.tools.map((tool) => ({
      ...tool,
      input: null,
      output: null,
      error: null,
    })),
  })),
});

export const makeRun = (spec: TRunSpec): TRun => {
  const rnd = seeded(hashOf(`${spec.jobId}:${spec.attempt}`));
  const model = spec.model ?? 'gemini-3.8-flash';
  const stepsCount = Math.max(spec.steps, 1);
  const failed = !!spec.error;
  const overheadStartMs = 40 + Math.round(rnd() * 30);
  const overheadEndMs = 10 + Math.round(rnd() * 15);
  const finishedAt = spec.finishedAtMs - overheadEndMs;
  const startedAt = finishedAt - spec.durationMs;

  // Tools go to every step but the last (which answers), in order.
  const toolSteps: string[][] = Array.from({ length: stepsCount }, () => []);
  const toolSlots = Math.max(stepsCount - (failed ? 0 : 1), 1);
  spec.tools.forEach((tool, i) => {
    toolSteps[
      Math.min(Math.floor((i * toolSlots) / spec.tools.length), toolSlots - 1)
    ].push(tool);
  });

  // Input tokens grow with the context; output is spread evenly.
  const weightSum = (stepsCount * (stepsCount + 1)) / 2;
  let cursor = startedAt + 50;
  const steps: TStep[] = [];
  for (let s = 0; s < stepsCount; s += 1) {
    const isLast = s === stepsCount - 1;
    const durationMs = Math.round(
      ((spec.durationMs - 60) / stepsCount) * (0.7 + rnd() * 0.6)
    );
    const stepEnd = cursor + durationMs;
    const inputTokens = Math.round((spec.inputTokens * (s + 1)) / weightSum);
    const outputTokens = Math.round(spec.outputTokens / stepsCount);
    const tools: TTool[] = toolSteps[s].map((name, t) => {
      const empty =
        (name === 'listRecipes' || name === 'searchFoods') && rnd() < 0.45;
      const io = (TOOL_IO[name] ?? TOOL_IO.logMeal)(empty);
      const toolDuration = Math.round(20 + rnd() * 220);
      const output = JSON.stringify(io.output);
      return {
        name,
        ok: true,
        durationMs: toolDuration,
        summary: io.summary,
        empty,
        startedAt: iso(stepEnd - toolDuration - 4 - t * 3),
        outputChars: output.length,
        input: JSON.stringify(io.input),
        output,
        error: null,
      };
    });
    const finishReason = isLast && !tools.length ? 'stop' : 'tool-calls';
    steps.push({
      step: s + 1,
      startedAt: iso(cursor),
      durationMs,
      finishReason,
      inputTokens,
      outputTokens,
      cost: demoCost(model, inputTokens, outputTokens),
      // A failed attempt never got to write its answer.
      text:
        finishReason === 'stop' && !failed
          ? spec.reply ?? REPLIES[Math.floor(rnd() * REPLIES.length)]
          : null,
      tools,
    });
    cursor = stepEnd + 3;
  }
  const last = steps[steps.length - 1];
  const hasRecipe = spec.tools.includes('proposeRecipe');
  const run: TRun = {
    v: 1,
    detail: AgentRunDetail.Full,
    detailMismatch: false,
    source: spec.source ?? AgentRunSource.Log,
    model,
    attempt: spec.attempt,
    startedAt: iso(startedAt),
    finishedAt: iso(finishedAt),
    durationMs: spec.durationMs,
    inputTokens: spec.inputTokens,
    outputTokens: spec.outputTokens,
    finishReason: last.finishReason,
    outcome: failed
      ? 'error'
      : last.finishReason === 'tool-calls'
      ? 'max-steps'
      : last.finishReason ?? 'unknown',
    cost: demoCost(model, spec.inputTokens, spec.outputTokens),
    overheadStartMs,
    overheadEndMs,
    truncated: false,
    error: spec.error ?? null,
    input: {
      conversationId: spec.conversationId ?? ownConversationId(spec.jobId),
      text: spec.userText ?? 'Pode sugerir algo para amanhã?',
    },
    final: failed
      ? null
      : {
          text: last.text ?? null,
          cards: hasRecipe
            ? [{ type: 'RECIPE', title: 'Panqueca de banana' }]
            : [],
        },
    steps,
  };
  return spec.detail === AgentRunDetail.Basic ? toBasic(run) : run;
};

/** The run as the helper writes it to `job.log` (contract v1). */
export const toLogLine = (run: TRun): string => {
  const parse = (value: string | null | undefined) =>
    value === null || value === undefined ? undefined : JSON.parse(value);
  const v1 = {
    v: 1,
    detail: run.detail,
    model: run.model,
    attempt: run.attempt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    input: run.input ?? undefined,
    steps: run.steps.map((step) => ({
      step: step.step,
      startedAt: step.startedAt,
      durationMs: step.durationMs,
      finishReason: step.finishReason,
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
      text: step.text ?? undefined,
      tools: step.tools.map((tool) => ({
        name: tool.name,
        ok: tool.ok,
        durationMs: tool.durationMs,
        summary: tool.summary,
        empty: tool.empty ?? undefined,
        startedAt: tool.startedAt ?? undefined,
        outputChars: tool.outputChars ?? undefined,
        input: parse(tool.input),
        output: parse(tool.output),
        error: tool.error ?? undefined,
      })),
    })),
    final: run.final
      ? { text: run.final.text ?? undefined, cards: run.final.cards }
      : null,
    error: run.error,
  };
  return AGENT_RUN_LOG_PREFIX + JSON.stringify(v1);
};

// ---------------------------------------------------------------------------
// The queue's jobs: the design's runs list, most recent first.
// ---------------------------------------------------------------------------

type TJobSpec = {
  id: string;
  minutesAgo: number;
  tools: string[];
  steps: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  failed?: boolean;
  detail?: AgentRunDetail;
  /** An earlier attempt that failed and was retried. */
  retried?: boolean;
  /**
   * Recorded by a worker that returns the AgentRunV1 instead of logging it
   * (compatibility path): no log line, `source: returnvalue`.
   */
  fromReturnValue?: boolean;
  /** A turn of the design's conversation `c-7f21`. */
  turn?: { userText: string; reply: string };
};

const JOB_SPECS: TJobSpec[] = [
  {
    id: 'd41e6b02',
    minutesAgo: 2,
    tools: ['logMeal'],
    steps: 2,
    inputTokens: 4980,
    outputTokens: 240,
    durationMs: 5120,
    turn: {
      userText: 'Coloca essa no meu plano de amanhã',
      reply:
        'Pronto, deixei a **crepioca recheada** no seu plano de amanhã às 7h.',
    },
  },
  {
    id: DESIGN_RUN_JOB_ID,
    minutesAgo: 4,
    tools: [],
    steps: 3,
    inputTokens: 9534,
    outputTokens: 1057,
    durationMs: 14814,
  },
  {
    id: '0c2b77a1',
    minutesAgo: 5,
    tools: ['getUserProfile', 'listRecipes'],
    steps: 3,
    inputTokens: 8120,
    outputTokens: 640,
    durationMs: 9210,
    retried: true,
    turn: {
      userText: 'Salgado. Tenho uns 10 minutos',
      reply:
        'Perfeito. Vi no seu perfil que a meta é *1.800 kcal* por dia, então vou mirar em algo entre 200 e 300 kcal.',
    },
  },
  {
    id: 'b91e04dd',
    minutesAgo: 7,
    tools: ['searchFoods', 'searchFoods', 'logMeal'],
    steps: 4,
    inputTokens: 14210,
    outputTokens: 980,
    durationMs: 18450,
  },
  {
    id: '5f3ac219',
    minutesAgo: 8,
    tools: [],
    steps: 1,
    inputTokens: 2410,
    outputTokens: 210,
    durationMs: 2980,
    detail: AgentRunDetail.Basic,
    turn: {
      userText: 'Oi! Quero melhorar meu café da manhã',
      reply:
        'Oi, Emanuelli! Você prefere algo doce ou salgado? E quanto tempo costuma ter de manhã?',
    },
  },
  {
    id: 'e7d40c66',
    minutesAgo: 11,
    tools: ['searchFoods', 'searchFoods', 'searchFoods', 'searchFoods'],
    steps: 6,
    inputTokens: 22480,
    outputTokens: 1520,
    durationMs: 41200,
    failed: true,
  },
  {
    id: '2a9f81b3',
    minutesAgo: 12,
    tools: ['listRecipes', 'proposeRecipe'],
    steps: 3,
    inputTokens: 9310,
    outputTokens: 1110,
    durationMs: 13980,
  },
  {
    id: '7714cde0',
    minutesAgo: 14,
    tools: ['getUserProfile'],
    steps: 2,
    inputTokens: 5020,
    outputTokens: 340,
    durationMs: 6120,
    fromReturnValue: true,
  },
  {
    id: 'c03e9a58',
    minutesAgo: 16,
    tools: ['listRecipes', 'listRecipes', 'proposeRecipe'],
    steps: 4,
    inputTokens: 12880,
    outputTokens: 1201,
    durationMs: 19870,
  },
  {
    id: '91aa20f4',
    minutesAgo: 19,
    tools: ['logMeal'],
    steps: 2,
    inputTokens: 4810,
    outputTokens: 260,
    durationMs: 5440,
  },
  {
    id: '4be610c7',
    minutesAgo: 20,
    tools: ['searchFoods', 'logMeal'],
    steps: 3,
    inputTokens: 9920,
    outputTokens: 580,
    durationMs: 11030,
  },
];

const STEP_LIMIT_ERROR =
  'AI_NoOutputGeneratedError: step limit (6) reached without a final answer';

export type TAgentMockJob = {
  id: string;
  status: JobStatus;
  timestamp: number;
  processedOn: number;
  finishedOn: number;
  attemptsMade: number;
  failedReason: string | null;
  data: string;
  runs: TRun[];
  logs: string[];
};

const buildJobs = (now: number): TAgentMockJob[] =>
  JOB_SPECS.map((spec) => {
    const finishedOn = now - spec.minutesAgo * MINUTE_MS;
    let last: TRun;
    if (spec.id === DESIGN_RUN_JOB_ID) {
      last = shiftRun(
        DESIGN_RUN,
        finishedOn -
          (DESIGN_RUN.overheadEndMs ?? 0) -
          Date.parse(DESIGN_RUN.finishedAt as string)
      );
    } else {
      last = makeRun({
        jobId: spec.id,
        attempt: spec.retried ? 2 : 1,
        finishedAtMs: finishedOn,
        tools: spec.tools,
        steps: spec.steps,
        inputTokens: spec.inputTokens,
        outputTokens: spec.outputTokens,
        durationMs: spec.durationMs,
        error: spec.failed ? STEP_LIMIT_ERROR : null,
        detail: spec.detail,
        conversationId: spec.turn ? DEMO_CONVERSATION_ID : undefined,
        userText: spec.turn?.userText,
        reply: spec.turn?.reply,
        source: spec.fromReturnValue ? AgentRunSource.Returnvalue : undefined,
      });
    }
    const runs: TRun[] = [last];
    if (spec.retried) {
      runs.unshift(
        makeRun({
          jobId: spec.id,
          attempt: 1,
          finishedAtMs: Date.parse(last.startedAt) - 2000,
          tools: ['getUserProfile'],
          steps: 2,
          inputTokens: 3100,
          outputTokens: 90,
          durationMs: 4300,
          error: 'GoogleGenerativeAIError: 503 Service Unavailable',
          conversationId: spec.turn ? DEMO_CONVERSATION_ID : undefined,
          userText: spec.turn?.userText,
        })
      );
    }
    const processedOn =
      Date.parse(last.startedAt) - (last.overheadStartMs ?? 0);
    const logs: string[] = [];
    runs.forEach((run) => {
      logs.push(`reply: attempt ${run.attempt} started`);
      // A returned run never reaches the job log.
      if (run.source === AgentRunSource.Log) logs.push(toLogLine(run));
    });
    return {
      id: spec.id,
      status: spec.failed ? JobStatus.Failed : JobStatus.Completed,
      timestamp: processedOn - 120,
      processedOn,
      finishedOn,
      attemptsMade: runs.length,
      failedReason: spec.failed ? STEP_LIMIT_ERROR : null,
      data: JSON.stringify(
        spec.id === DESIGN_RUN_JOB_ID
          ? DESIGN_RUN_DATA
          : { messageId: `${spec.id}-${hashOf(spec.id).toString(16)}` },
        null,
        2
      ),
      runs,
      logs,
    };
  });

// ---------------------------------------------------------------------------
// Runs index: the jobs above plus older entries, capped like `recentRuns`.
// ---------------------------------------------------------------------------

export const INDEX_CAP = 2000;
const CHAINS = [
  ['logMeal'],
  ['listRecipes', 'proposeRecipe'],
  ['getUserProfile', 'listRecipes'],
  ['searchFoods', 'searchFoods', 'logMeal'],
  [],
  ['listRecipes', 'listRecipes', 'proposeRecipe'],
  ['getUserProfile'],
  ['searchFoods', 'logMeal'],
];

const toIndexItem = (run: TRun, jobId: string): TRunIndexItem => ({
  queue: AGENT_QUEUE_ID,
  jobId,
  jobName: 'reply',
  attempt: run.attempt,
  finishedAt: Date.parse(run.finishedAt as string) + (run.overheadEndMs ?? 0),
  durationMs: run.durationMs ?? null,
  model: run.model,
  steps: run.steps.length,
  inputTokens: run.inputTokens,
  outputTokens: run.outputTokens,
  cost: run.cost ?? null,
  outcome: run.outcome,
  tools: run.steps.flatMap((step) =>
    step.tools.map((tool) => ({
      name: tool.name,
      ok: tool.ok,
      empty: !!tool.empty,
    }))
  ),
  error: run.error ? run.error.slice(0, 200) : null,
});

const buildIndex = (jobs: TAgentMockJob[], now: number): TRunIndexItem[] => {
  const items = jobs.flatMap((job) =>
    job.runs.map((run) => toIndexItem(run, job.id))
  );
  const rnd = seeded(42);
  let at = now - 22 * MINUTE_MS;
  while (items.length < INDEX_CAP) {
    at -= Math.round((1 + rnd() * 3) * MINUTE_MS);
    const chain = CHAINS[Math.floor(rnd() * CHAINS.length)];
    const steps = new Set(chain).size + 1 + (rnd() < 0.08 ? 2 : 0);
    const failed = rnd() < 0.012;
    const empty =
      chain.some((t) => t === 'listRecipes' || t === 'searchFoods') &&
      rnd() < 0.4;
    const roll = rnd();
    const model =
      roll < 0.9
        ? 'gemini-3.8-flash'
        : roll < 0.97
        ? 'gemini-3.8-pro'
        : 'gemma-local';
    const inputTokens = Math.round(steps * (2400 + rnd() * 1000));
    const outputTokens = Math.round(steps * (90 + rnd() * 260));
    const durationMs = Math.round(steps * (2600 + rnd() * 2600));
    const jobId = Math.floor(rnd() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
    items.push({
      queue: AGENT_QUEUE_ID,
      jobId,
      jobName: 'reply',
      attempt: 1,
      finishedAt: at,
      durationMs,
      model,
      steps,
      inputTokens,
      outputTokens,
      cost: demoCost(model, inputTokens, outputTokens),
      outcome: failed ? 'error' : 'stop',
      tools: chain.map((name, i) => ({
        name,
        ok: true,
        empty: empty && i === 0,
      })),
      error: failed ? STEP_LIMIT_ERROR : null,
    });
  }
  return items.sort((a, b) => b.finishedAt - a.finishedAt);
};

/** Rebuilds a full run from an index entry, for rows whose job is gone. */
export const runFromIndexItem = (item: TRunIndexItem): TRun => {
  const run = makeRun({
    jobId: item.jobId,
    attempt: item.attempt,
    finishedAtMs: item.finishedAt,
    tools: item.tools.map((tool) => tool.name),
    steps: item.steps,
    inputTokens: item.inputTokens,
    outputTokens: item.outputTokens,
    durationMs: item.durationMs ?? 5000,
    model: item.model,
    error: item.error,
    conversationId: conversationOf(item.jobId) ?? undefined,
  });
  // Keep the chain the list showed, empties included.
  let k = 0;
  return {
    ...run,
    steps: run.steps.map((step) => ({
      ...step,
      tools: step.tools.map((tool) => {
        const link = item.tools[k++];
        return link
          ? {
              ...tool,
              empty: link.empty,
              summary: link.empty ? '0 resultados' : tool.summary,
            }
          : tool;
      }),
    })),
  };
};

/**
 * `input.conversationId` per job id, standing in for the `c` the collector
 * keeps in each index entry. The jobs carry theirs in the run; the older,
 * synthetic entries come in short conversations of 1 to 4 messages.
 */
const buildConversations = (
  jobs: TAgentMockJob[],
  index: TRunIndexItem[]
): Map<string, string> => {
  const conversations = new Map<string, string>();
  for (const job of jobs) {
    const id = job.runs[job.runs.length - 1]?.input?.conversationId;
    if (id) conversations.set(job.id, id);
  }
  const rnd = seeded(7);
  let left = 0;
  let current = '';
  // Oldest first, so a conversation reads forward in time.
  for (const item of [...index].reverse()) {
    if (conversations.has(item.jobId)) continue;
    if (left === 0) {
      current = ownConversationId(item.jobId);
      left = 1 + Math.floor(rnd() * 4);
    }
    conversations.set(item.jobId, current);
    left -= 1;
  }
  return conversations;
};

let cache: {
  jobs: TAgentMockJob[];
  index: TRunIndexItem[];
  conversations: Map<string, string>;
} | null = null;

export const agentMock = () => {
  if (!cache) {
    const now = Date.now();
    const jobs = buildJobs(now);
    const index = buildIndex(jobs, now);
    cache = { jobs, index, conversations: buildConversations(jobs, index) };
  }
  return cache;
};

/** The conversation an index entry belongs to (the collector's `c`). */
export function conversationOf(jobId: string): string | null {
  return agentMock().conversations.get(jobId) ?? null;
}
