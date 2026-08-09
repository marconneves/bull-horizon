import jsonata from 'jsonata';

// Bridges the text search (jsonata) and the row-based filter builder.
//
// The jsonata expression stays the single source of truth: the structured mode
// is only a projection of it. `parse` returns `null` when an expression doesn't
// fit the row grammar — the UI then keeps text mode instead of trying to
// "fix" the user's query.
//
// Fits in a row: a comparison between a path (`*` and `**` included) and a
// literal, or `$contains(path, "text")`, combined with `and`/`or` (parentheses
// become nested groups).
// Doesn't fit: array predicates (`data.items[0].id`), any other function, and
// anything that isn't a comparison/combination.

export const COMPARISON_OPERATORS = ['=', '!=', '>', '>=', '<', '<='] as const;
export type TComparisonOperator = typeof COMPARISON_OPERATORS[number];
export type TFilterOperator = TComparisonOperator | 'contains';
export type TConnector = 'and' | 'or';
export type TValueKind = 'string' | 'number' | 'boolean';

export type TFilterCondition = {
  kind: 'condition';
  id: string;
  path: string;
  operator: TFilterOperator;
  value: string;
  valueKind: TValueKind;
};

export type TFilterGroup = {
  kind: 'group';
  id: string;
  connector: TConnector;
  children: TFilterNode[];
};

export type TFilterNode = TFilterCondition | TFilterGroup;

export const OPERATOR_LABELS: Record<TFilterOperator, string> = {
  '=': '=',
  '!=': '≠',
  '>': '>',
  '>=': '≥',
  '<': '<',
  '<=': '≤',
  contains: 'contains',
};

// Ids are only used as React keys, for the lifetime of the component.
let idSeq = 0;
const nextId = () => `f${(idSeq += 1)}`;

// Same rule as JsonataPathService: a key that isn't a valid identifier needs
// backticks (covers keys with `*`, `-`, spaces, and so on).
const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isComparison = (value: unknown): value is TComparisonOperator =>
  COMPARISON_OPERATORS.includes(value as TComparisonOperator);

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- AST -> path source -----------------------------------------------------

const stepToSource = (step: any): string | null => {
  // An array predicate (`items[0]`) has no row representation.
  if (step?.stages) return null;
  if (step?.type === 'wildcard') return '*';
  if (step?.type === 'descendant') return '**';
  if (step?.type !== 'name') return null;
  const value = String(step.value);
  return VALID_IDENTIFIER.test(value) ? value : `\`${value}\``;
};

const pathToSource = (node: any): string | null => {
  if (node?.type !== 'path' || !Array.isArray(node.steps) || !node.steps.length) {
    return null;
  }
  const parts: string[] = [];
  for (const step of node.steps) {
    const source = stepToSource(step);
    if (source === null) return null;
    parts.push(source);
  }
  return parts.join('.');
};

const literalToValue = (
  node: any
): { value: string; valueKind: TValueKind } | null => {
  if (node?.type === 'string') {
    return { value: String(node.value), valueKind: 'string' };
  }
  if (node?.type === 'number') {
    return { value: String(node.value), valueKind: 'number' };
  }
  // Booleans arrive as `{ type: 'value', value: true }`. `null` uses the same
  // type and doesn't become a row.
  if (node?.type === 'value' && typeof node.value === 'boolean') {
    return { value: String(node.value), valueKind: 'boolean' };
  }
  return null;
};

// --- AST -> filter tree -----------------------------------------------------

const parseNode = (ast: any): TFilterNode | null => {
  if (!ast) return null;

  // Parentheses become a `block`; only the single-expression block is accepted,
  // which is what the builder itself emits.
  if (ast.type === 'block') {
    if (!Array.isArray(ast.expressions) || ast.expressions.length !== 1) {
      return null;
    }
    return parseNode(ast.expressions[0]);
  }

  if (ast.type === 'binary' && (ast.value === 'and' || ast.value === 'or')) {
    const connector = ast.value as TConnector;
    const children = flattenChain(ast, connector);
    if (!children) return null;
    return { kind: 'group', id: nextId(), connector, children };
  }

  if (ast.type === 'binary' && isComparison(ast.value)) {
    const path = pathToSource(ast.lhs);
    const literal = literalToValue(ast.rhs);
    if (path === null || literal === null) return null;
    return {
      kind: 'condition',
      id: nextId(),
      path,
      operator: ast.value,
      ...literal,
    };
  }

  if (
    ast.type === 'function' &&
    ast.procedure?.value === 'contains' &&
    Array.isArray(ast.arguments) &&
    ast.arguments.length === 2
  ) {
    const path = pathToSource(ast.arguments[0]);
    const needle = ast.arguments[1];
    if (path === null || needle?.type !== 'string') return null;
    return {
      kind: 'condition',
      id: nextId(),
      path,
      operator: 'contains',
      value: String(needle.value),
      valueKind: 'string',
    };
  }

  return null;
};

// Flattens `a and b and c` into a single list. A child with a different
// connector (or inside parentheses) comes back as a nested group, via parseNode.
const flattenChain = (ast: any, connector: TConnector): TFilterNode[] | null => {
  const out: TFilterNode[] = [];
  const visit = (node: any): boolean => {
    if (node?.type === 'binary' && node.value === connector) {
      return visit(node.lhs) && visit(node.rhs);
    }
    const parsed = parseNode(node);
    if (!parsed) return false;
    out.push(parsed);
    return true;
  };
  return visit(ast) ? out : null;
};

// --- filter tree -> source --------------------------------------------------

export const inferValueKind = (raw: string): TValueKind => {
  const trimmed = raw.trim();
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return 'number';
  return 'string';
};

const formatValue = (value: string, valueKind: TValueKind): string => {
  if (valueKind === 'boolean') return value.trim() === 'true' ? 'true' : 'false';
  // A value flagged as a number but typed as text falls back to a string, so we
  // never emit invalid jsonata.
  if (valueKind === 'number' && !Number.isNaN(Number(value.trim()))) {
    return value.trim();
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

const isUsable = (node: TFilterNode): boolean =>
  node.kind === 'condition'
    ? Boolean(node.path.trim())
    : node.children.some(isUsable);

const serializeNode = (
  node: TFilterNode,
  parentConnector?: TConnector
): string => {
  if (node.kind === 'condition') {
    const value = formatValue(node.value, node.valueKind);
    return node.operator === 'contains'
      ? `$contains(${node.path.trim()}, ${value})`
      : `${node.path.trim()} ${node.operator} ${value}`;
  }
  const parts = node.children
    .filter(isUsable)
    .map((child) => serializeNode(child, node.connector))
    .filter(Boolean);
  if (!parts.length) return '';
  const inner = parts.join(` ${node.connector} `);
  // A nested group with more than one child is always parenthesised: `or` binds
  // looser than `and`, so flattening would change the search result.
  return parentConnector !== undefined && parts.length > 1 ? `(${inner})` : inner;
};

// --- public API -------------------------------------------------------------

export const JsonataFilterService = {
  createCondition(path = '', operator: TFilterOperator = '='): TFilterCondition {
    return {
      kind: 'condition',
      id: nextId(),
      path,
      operator,
      value: '',
      valueKind: 'string',
    };
  },

  createGroup(connector: TConnector = 'and'): TFilterGroup {
    return {
      kind: 'group',
      id: nextId(),
      connector,
      children: [JsonataFilterService.createCondition()],
    };
  },

  // `null` = a valid expression that falls outside the row grammar (or an
  // invalid one). The UI uses it to disable the toggle instead of rewriting.
  parse(expression: string): TFilterGroup | null {
    const trimmed = expression.trim();
    if (!trimmed) {
      return { kind: 'group', id: nextId(), connector: 'and', children: [] };
    }
    let ast: any;
    try {
      ast = (jsonata(trimmed) as any).ast();
    } catch (_e) {
      return null;
    }
    const parsed = parseNode(ast);
    if (!parsed) return null;
    return parsed.kind === 'group'
      ? parsed
      : { kind: 'group', id: nextId(), connector: 'and', children: [parsed] };
  },

  serialize(root: TFilterGroup): string {
    return serializeNode(root);
  },
};
