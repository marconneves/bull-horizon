const VALID_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const JsonataPathService = {
  // Builds a jsonata path expression from `basePath` (e.g. "data") plus a
  // sequence of object-key/array-index segments (e.g. `data.hello.to`,
  // `data.items[0].id`). Keys that aren't valid jsonata identifiers get
  // backtick-escaped — same rule as `services/jsonata-filter.ts`, which has to
  // reproduce these paths when parsing an expression back into filter rows.
  buildPath(basePath: string, segments: Array<string | number>): string {
    return segments.reduce<string>((expr, segment) => {
      if (typeof segment === 'number') {
        return `${expr}[${segment}]`;
      }
      const key = VALID_IDENTIFIER.test(segment) ? segment : `\`${segment}\``;
      return `${expr}.${key}`;
    }, basePath);
  },
  // Formats a primitive as a jsonata literal for the right-hand side of a
  // comparison (e.g. `"some string"`, `42`, `true`).
  formatLiteral(value: string | number | boolean): string {
    if (typeof value === 'string') {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return String(value);
  },
};
