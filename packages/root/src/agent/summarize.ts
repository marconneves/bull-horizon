/**
 * Generic, content-free defaults. They describe the *shape* of a tool output
 * (counts, key names, primitive type) and never its value: at `basic` the
 * summary is the only thing about the output that reaches Redis.
 *
 * Key names are shown only when every shown key looks like a code identifier.
 * A dictionary keyed by data (`{ "maria@x.com": ... }`) has keys that ARE
 * values, so it falls back to counts (`object (N keys)`).
 */

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/;
const areIdentifiers = (keys: string[]) =>
  keys.every((key) => IDENTIFIER.test(key));

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const listsOf = (o: Record<string, unknown>) =>
  Object.entries(o).filter(([, v]) => Array.isArray(v)) as [
    string,
    unknown[]
  ][];

export function defaultSummarize(_tool: string, output: unknown): string {
  if (output === null || output === undefined) return 'no output';
  if (Array.isArray(output)) return plural(output.length, 'result', 'results');
  if (typeof output === 'string') return `string (${output.length} chars)`;
  if (typeof output !== 'object') return typeof output;
  const o = output as Record<string, unknown>;
  if (o.ok === false) return 'refused';
  const lists = listsOf(o);
  if (lists.length === 1) {
    return plural(lists[0][1].length, 'result', 'results');
  }
  if (lists.length > 1) {
    return areIdentifiers(lists.map(([k]) => k))
      ? lists.map(([k, v]) => `${k}: ${v.length}`).join(', ')
      : `${lists.length} lists: ${lists.map(([, v]) => v.length).join(', ')}`;
  }
  const keys = Object.keys(o);
  if (!keys.length) return 'empty object';
  const shown = keys.slice(0, 5);
  return areIdentifiers(shown)
    ? `object (${shown.join(', ')})`
    : `object (${plural(keys.length, 'key', 'keys')})`;
}

export function defaultIsEmpty(_tool: string, output: unknown): boolean {
  if (output === null || output === undefined) return true;
  if (Array.isArray(output)) return output.length === 0;
  if (typeof output !== 'object') return false;
  const o = output as Record<string, unknown>;
  if (Object.keys(o).length === 0) return true;
  const lists = listsOf(o);
  return lists.length > 0 && lists.every(([, v]) => v.length === 0);
}
