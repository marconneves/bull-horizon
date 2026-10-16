import type { NormalizedFlow } from './definition';

/*
 * Read-only YAML rendering of a normalized flow for the Config tab. Our own
 * tiny serializer (no YAML dependency in the root): only the shapes a flow
 * definition has (scalars, lists of scalars, maps, lists of maps).
 */

const PLAIN = /^[\p{L}\p{N}_./@$-][\p{L}\p{N}_./@$ :!=<>-]*$/u;
const RESERVED =
  /^(true|false|null|yes|no|on|off|~|[-+]?[0-9.]+(e[-+]?[0-9]+)?)$/i;

/** A scalar, quoted (JSON string syntax, valid YAML) unless plain is safe. */
export function yamlScalar(value: string): string {
  const plain =
    PLAIN.test(value) &&
    !value.endsWith(' ') &&
    !value.endsWith(':') &&
    !value.includes(': ') &&
    !value.includes(' #') &&
    !RESERVED.test(value);
  return plain ? value : JSON.stringify(value);
}

const list = (values: string[]) => `[${values.map(yamlScalar).join(', ')}]`;

export function renderFlowYaml(flow: NormalizedFlow): string {
  const lines: string[] = [];
  const push = (indent: number, text: string) =>
    lines.push(`${'  '.repeat(indent)}${text}`);
  push(0, `id: ${yamlScalar(flow.id)}`);
  if (flow.label !== flow.id) push(0, `label: ${yamlScalar(flow.label)}`);
  if (flow.group) push(0, `group: ${yamlScalar(flow.group)}`);
  push(0, `entry: ${list(flow.entry)}`);
  if (flow.onError) push(0, `onError: ${yamlScalar(flow.onError)}`);
  const complete = flow.complete.filter(
    (id) => flow.steps.get(id)?.kind !== 'end'
  );
  if (complete.length) push(0, `complete: ${list(complete)}`);
  const trace = flow.trace;
  push(0, 'trace:');
  push(1, `field: ${yamlScalar(trace.field)}`);
  if (trace.key) push(1, `key: ${yamlScalar(trace.key)}`);
  if (trace.keyLabel && trace.keyLabel !== trace.key?.split('.').pop()) {
    push(1, `keyLabel: ${yamlScalar(trace.keyLabel)}`);
  }
  if (trace.aliases.length) push(1, `aliases: ${list(trace.aliases)}`);
  push(0, 'steps:');
  for (const step of flow.steps.values()) {
    if (step.kind === 'end') continue;
    push(1, `${yamlScalar(step.id)}:`);
    const before = lines.length;
    if (step.queue && step.queue !== step.id) {
      push(2, `queue: ${yamlScalar(step.queue)}`);
    }
    if (step.jobs) push(2, `jobs: ${list(step.jobs)}`);
    if (step.label !== step.id) push(2, `label: ${yamlScalar(step.label)}`);
    if (step.description) {
      push(2, `description: ${yamlScalar(step.description)}`);
    }
    if (step.when) push(2, `when: ${yamlScalar(step.when)}`);
    const edges = flow.edges.filter((edge) => edge.from === step.id);
    if (edges.length) {
      push(2, 'next:');
      for (const edge of edges) {
        if (edge.kind === 'end') {
          const label = flow.steps.get(edge.to)?.label ?? 'end';
          push(3, `- end: ${yamlScalar(label)}`);
        } else {
          push(3, `- to: ${yamlScalar(edge.to)}`);
          if (edge.kind === 'fallback' || edge.kind === 'sidecar') {
            push(4, `kind: ${edge.kind}`);
          }
        }
        if (edge.when) push(4, `when: ${yamlScalar(edge.when)}`);
      }
    }
    if (lines.length === before) lines[lines.length - 1] += ' {}';
  }
  return lines.join('\n') + '\n';
}
