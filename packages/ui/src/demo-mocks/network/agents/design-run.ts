// Run `fa1809e7` from `docs/todo/004-agentes-ia/design/06 Agentes IA.dc.html`,
// recorded at `full` detail so the demo shows every block. Relative,
// type-only imports keep it usable from the root jest setup.
import type { AgentRunFieldsFragment } from '../../../typings/gql';
import { AgentRunDetail } from '../../../typings/gql';

/** USD per 1M tokens. Mirrors `config.ai.pricing`; the demo has no server. */
export const DEMO_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.8-pro': { input: 1.25, output: 10 },
};

/** Same formula as the server; null (never 0) when the model has no price. */
export const demoCost = (
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null => {
  const price = DEMO_PRICING[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
};

const MODEL = 'gemini-3.8-flash';
const FINAL_TEXT =
  'Emanuelli, separei uma opção deliciosa e prática de **crepioca recheada** para dar bastante energia à sua manhã.\n\nDê uma olhada no card para conferir os ingredientes e o modo de preparo!';

const RECIPE_INPUT = {
  title: 'Crepioca recheada',
  meal: 'BREAKFAST',
  kcal: 220,
  prepMinutes: 10,
  servings: 1,
  ingredients: [
    '1 ovo inteiro',
    '2 colheres de sopa de goma de tapioca',
    '1 fatia de queijo branco ou muçarela',
    '2 rodelas finas de tomate',
    '1 pitada de sal e orégano a gosto',
  ],
  steps: [
    'Em uma tigela pequena, bata bem o ovo com a tapioca e o sal até misturar tudo.',
    'Aqueça uma frigideira antiaderente em fogo baixo.',
    'Despeje a massa e espere firmar por cerca de 2 minutos.',
    'Coloque o queijo, o tomate e o orégano em uma das metades e dobre a massa.',
    'Deixe dourar dos dois lados até o queijo derreter e sirva.',
  ],
  tags: ['café da manhã', 'prático', 'energia'],
};
const RECIPE_OUTPUT = {
  ok: true,
  message: 'Sugestão pronta. Apresente em 1 ou 2 frases, sem repetir o card.',
};

export const DESIGN_RUN_JOB_ID = 'fa1809e7';
export const DESIGN_RUN_DATA = {
  messageId: 'fa1809e7-3e84-47e1-be15-6543d7efa460',
};

export const DESIGN_RUN: AgentRunFieldsFragment = {
  v: 1,
  detail: AgentRunDetail.Full,
  detailMismatch: false,
  model: MODEL,
  attempt: 1,
  startedAt: '2026-10-14T19:05:28.514Z',
  finishedAt: '2026-10-14T19:05:43.328Z',
  durationMs: 14814,
  inputTokens: 9534,
  outputTokens: 1057,
  finishReason: 'stop',
  outcome: 'stop',
  cost: demoCost(MODEL, 9534, 1057),
  overheadStartMs: 53,
  overheadEndMs: 18,
  truncated: false,
  error: null,
  input: {
    conversationId: 'c-7f21',
    text: 'Pode sugerir uma receita?',
  },
  final: {
    text: FINAL_TEXT,
    cards: [{ type: 'RECIPE', title: 'Crepioca recheada' }],
  },
  steps: [
    {
      step: 1,
      startedAt: '2026-10-14T19:05:28.567Z',
      durationMs: 4086,
      finishReason: 'tool-calls',
      inputTokens: 2788,
      outputTokens: 154,
      cost: demoCost(MODEL, 2788, 154),
      text: null,
      tools: [
        {
          name: 'listRecipes',
          ok: true,
          durationMs: 55,
          summary: '0 resultados',
          empty: true,
          startedAt: '2026-10-14T19:05:32.594Z',
          outputChars: 14,
          input: JSON.stringify({ meal: 'BREAKFAST' }),
          output: JSON.stringify({ recipes: [] }),
          error: null,
        },
      ],
    },
    {
      step: 2,
      startedAt: '2026-10-14T19:05:32.657Z',
      durationMs: 7219,
      finishReason: 'tool-calls',
      inputTokens: 2962,
      outputTokens: 774,
      cost: demoCost(MODEL, 2962, 774),
      text: null,
      tools: [
        {
          name: 'proposeRecipe',
          ok: true,
          durationMs: 0,
          summary: 'objeto (ok, message)',
          empty: false,
          startedAt: '2026-10-14T19:05:39.876Z',
          outputChars: 79,
          input: JSON.stringify(RECIPE_INPUT),
          output: JSON.stringify(RECIPE_OUTPUT),
          error: null,
        },
      ],
    },
    {
      step: 3,
      startedAt: '2026-10-14T19:05:39.879Z',
      durationMs: 3431,
      finishReason: 'stop',
      inputTokens: 3784,
      outputTokens: 129,
      cost: demoCost(MODEL, 3784, 129),
      text: FINAL_TEXT,
      tools: [],
    },
  ],
};
