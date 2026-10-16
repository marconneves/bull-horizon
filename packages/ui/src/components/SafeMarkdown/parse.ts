/**
 * A deliberately tiny markdown subset for text written by an LLM (agent step
 * text, final answer, user input). It produces a plain tree that the
 * component turns into React elements, so nothing here can become HTML:
 *
 * - **bold**, *italic* / _italic_, `inline code`, line breaks;
 * - `-` / `*` / `+` bullet lists and `1.` / `1)` numbered lists.
 *
 * Everything else — links, images, headings, raw HTML — stays literal text.
 *
 * The parser is a single left-to-right scan with no regular expressions over
 * the input, so its cost is linear in the length of the text whatever the
 * text contains (no catastrophic backtracking on `****…` or unclosed
 * markers). The emphasis stack holds at most one open frame per marker kind,
 * so it never grows past three.
 */

export type TMdInline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: TMdInline[] }
  | { type: 'em'; children: TMdInline[] }
  | { type: 'br' };

export type TMdBlock =
  | { type: 'paragraph'; children: TMdInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: TMdInline[][] };

type TMarker = '**' | '*' | '_';
type TFrame = { marker: TMarker; children: TMdInline[] };

const isSpace = (c: string | undefined) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r';

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

const ESCAPABLE = '\\`*_';

const pushText = (list: TMdInline[], value: string) => {
  if (!value) return;
  const last = list[list.length - 1];
  if (last && last.type === 'text') {
    last.value += value;
  } else {
    list.push({ type: 'text', value });
  }
};

const append = (target: TMdInline[], nodes: TMdInline[]) => {
  for (const node of nodes) {
    if (node.type === 'text') pushText(target, node.value);
    else target.push(node);
  }
};

export const parseInline = (text: string): TMdInline[] => {
  const root: TMdInline[] = [];
  const stack: TFrame[] = [];
  let buf = '';

  const current = () =>
    stack.length ? stack[stack.length - 1].children : root;
  const flush = () => {
    if (buf) {
      pushText(current(), buf);
      buf = '';
    }
  };
  const isOpen = (marker: TMarker) => stack.some((f) => f.marker === marker);
  /** An unclosed frame goes back to being what it was: literal text. */
  const unwind = (frame: TFrame) => {
    const parent = current();
    pushText(parent, frame.marker);
    append(parent, frame.children);
  };
  const open = (marker: TMarker) => {
    flush();
    stack.push({ marker, children: [] });
  };
  const close = (marker: TMarker) => {
    flush();
    let frame = stack.pop() as TFrame;
    while (frame.marker !== marker) {
      unwind(frame);
      frame = stack.pop() as TFrame;
    }
    const parent = current();
    if (!frame.children.length) {
      // `****` or `__`: nothing to emphasise, keep the characters.
      pushText(parent, marker + marker);
      return;
    }
    parent.push({
      type: marker === '**' ? 'strong' : 'em',
      children: frame.children,
    });
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    if (c === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    if (c === '\n') {
      flush();
      current().push({ type: 'br' });
      i += 1;
      continue;
    }

    if (c === '`') {
      // Scans only up to the next backtick, and each backtick is the start of
      // at most one scan, so all the scans together cover the text once.
      let j = i + 1;
      while (j < text.length && text[j] !== '`' && text[j] !== '\n') j += 1;
      if (j < text.length && text[j] === '`' && j > i + 1) {
        flush();
        current().push({ type: 'code', value: text.slice(i + 1, j) });
        i = j + 1;
      } else {
        buf += c;
        i += 1;
      }
      continue;
    }

    if (c === '*' || c === '_') {
      let end = i;
      while (end < text.length && text[end] === c) end += 1;
      const run = end - i;
      const prev = text[i - 1];
      const next = text[end];
      let canOpen = next !== undefined && !isSpace(next);
      let canClose = prev !== undefined && !isSpace(prev);
      if (c === '_') {
        // `snake_case_name` is not emphasis.
        canOpen = canOpen && !isWordChar(prev);
        canClose = canClose && !isWordChar(next);
        if (run === 1 && canClose && isOpen('_')) close('_');
        else if (run === 1 && canOpen && !isOpen('_')) open('_');
        else buf += text.slice(i, end);
        i = end;
        continue;
      }

      let rest = run;
      while (rest > 0) {
        if (canClose) {
          // The innermost open star frame closes first: `***a***`.
          let target: TMarker | null = null;
          for (let k = stack.length - 1; k >= 0; k -= 1) {
            const marker = stack[k].marker;
            if (marker === '_') continue;
            if (marker.length <= rest) target = marker;
            break;
          }
          if (!target && isOpen('*')) target = '*';
          if (target) {
            close(target);
            rest -= target.length;
            continue;
          }
        }
        if (canOpen && rest >= 2 && !isOpen('**')) {
          open('**');
          rest -= 2;
          continue;
        }
        if (canOpen && !isOpen('*')) {
          open('*');
          rest -= 1;
          continue;
        }
        buf += '*'.repeat(rest);
        rest = 0;
      }
      i = end;
      continue;
    }

    buf += c;
    i += 1;
  }

  flush();
  while (stack.length) unwind(stack.pop() as TFrame);
  return root;
};

type TListMarker = { ordered: boolean; start: number; content: string };

/** `- item`, `* item`, `+ item`, `1. item`, `1) item`; null otherwise. */
const readListMarker = (line: string): TListMarker | null => {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1;
  const c = line[i];
  if ((c === '-' || c === '*' || c === '+') && isSpace(line[i + 1])) {
    return { ordered: false, start: 1, content: line.slice(i + 2).trim() };
  }
  let j = i;
  while (j < line.length && j - i < 9 && line[j] >= '0' && line[j] <= '9') {
    j += 1;
  }
  if (j > i && (line[j] === '.' || line[j] === ')') && isSpace(line[j + 1])) {
    return {
      ordered: true,
      start: Number(line.slice(i, j)),
      content: line.slice(j + 2).trim(),
    };
  }
  return null;
};

export const parseSafeMarkdown = (text: string): TMdBlock[] => {
  const blocks: TMdBlock[] = [];
  const lines = text.split('\n');
  let paragraph: string[] = [];
  let list: Extract<TMdBlock, { type: 'list' }> | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({
        type: 'paragraph',
        children: parseInline(paragraph.join('\n')),
      });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const marker = readListMarker(line);
    if (marker) {
      flushParagraph();
      if (!list || list.ordered !== marker.ordered) {
        flushList();
        list = {
          type: 'list',
          ordered: marker.ordered,
          start: marker.start,
          items: [],
        };
      }
      list.items.push(parseInline(marker.content));
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
};
