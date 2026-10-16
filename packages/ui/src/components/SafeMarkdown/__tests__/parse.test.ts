import { parseInline, parseSafeMarkdown } from '../parse';
import type { TMdBlock, TMdInline } from '../parse';

/** Flattens the tree back to the characters it shows, markers excluded. */
const textOf = (nodes: TMdInline[]): string =>
  nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.value;
      if (node.type === 'br') return '\n';
      return textOf(node.children);
    })
    .join('');

const blocksText = (blocks: TMdBlock[]) =>
  blocks
    .map((block) =>
      block.type === 'paragraph'
        ? textOf(block.children)
        : block.items.map(textOf).join('\n')
    )
    .join('\n');

describe('parseInline', () => {
  it('parses bold, italic and inline code', () => {
    expect(parseInline('a **b** *c* _d_ `e`')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'strong', children: [{ type: 'text', value: 'b' }] },
      { type: 'text', value: ' ' },
      { type: 'em', children: [{ type: 'text', value: 'c' }] },
      { type: 'text', value: ' ' },
      { type: 'em', children: [{ type: 'text', value: 'd' }] },
      { type: 'text', value: ' ' },
      { type: 'code', value: 'e' },
    ]);
  });

  it('nests italic inside bold and closes ***a*** innermost first', () => {
    expect(parseInline('**a *b* c**')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', value: 'a ' },
          { type: 'em', children: [{ type: 'text', value: 'b' }] },
          { type: 'text', value: ' c' },
        ],
      },
    ]);
    expect(parseInline('***a***')).toEqual([
      {
        type: 'strong',
        children: [{ type: 'em', children: [{ type: 'text', value: 'a' }] }],
      },
    ]);
  });

  it('turns newlines into line breaks', () => {
    expect(parseInline('a\nb')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'br' },
      { type: 'text', value: 'b' },
    ]);
  });

  it('keeps unclosed and spaced markers literal', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([
      { type: 'text', value: '2 * 3 * 4' },
    ]);
    expect(parseInline('**open and never closed')).toEqual([
      { type: 'text', value: '**open and never closed' },
    ]);
    expect(parseInline('a `b')).toEqual([{ type: 'text', value: 'a `b' }]);
    expect(parseInline('****')).toEqual([{ type: 'text', value: '****' }]);
  });

  it('does not treat snake_case as italic', () => {
    expect(parseInline('call get_user_profile now')).toEqual([
      { type: 'text', value: 'call get_user_profile now' },
    ]);
  });

  it('does not parse markdown inside code spans', () => {
    expect(parseInline('`**x**`')).toEqual([{ type: 'code', value: '**x**' }]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([
      { type: 'text', value: '*not italic*' },
    ]);
  });
});

describe('parseSafeMarkdown', () => {
  it('splits paragraphs on blank lines and keeps single breaks', () => {
    const blocks = parseSafeMarkdown('first\nsame paragraph\n\nsecond');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      children: [
        { type: 'text', value: 'first' },
        { type: 'br' },
        { type: 'text', value: 'same paragraph' },
      ],
    });
  });

  it('parses bullet and numbered lists', () => {
    const blocks = parseSafeMarkdown(
      'Intro\n- one\n- **two**\n\n3. three\n4. four'
    );
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list', 'list']);
    const bullets = blocks[1] as Extract<TMdBlock, { type: 'list' }>;
    expect(bullets.ordered).toBe(false);
    expect(bullets.items).toHaveLength(2);
    expect(bullets.items[1][0].type).toBe('strong');
    const numbered = blocks[2] as Extract<TMdBlock, { type: 'list' }>;
    expect(numbered.ordered).toBe(true);
    expect(numbered.start).toBe(3);
  });

  it('keeps raw HTML as literal text', () => {
    const input = '<script>alert(1)</script> <img src=x onerror=alert(1)>';
    const blocks = parseSafeMarkdown(input);
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: input }] },
    ]);
  });

  it('keeps links and images as literal text', () => {
    const input = '[x](javascript:alert(1)) ![img](http://evil/x.png)';
    expect(parseSafeMarkdown(input)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: input }] },
    ]);
  });

  it('never loses characters other than the markers it consumed', () => {
    const input = 'a [b](c) <i>d</i> e';
    expect(blocksText(parseSafeMarkdown(input))).toBe(input);
  });

  describe('pathological input stays linear', () => {
    const cases: Array<[string, string]> = [
      ['4000 asterisks', '*'.repeat(4000)],
      ['4000 nested openers', '**a *b '.repeat(4000)],
      ['alternating markers', '*_'.repeat(4000)],
      ['unclosed backticks', '`a '.repeat(4000)],
      ['deep list-ish lines', '- *a\n'.repeat(4000)],
      ['200k characters', '**a** _b_ `c` *d '.repeat(12000)],
    ];
    it.each(cases)('%s', (_label, input) => {
      const startedAt = Date.now();
      const blocks = parseSafeMarkdown(input);
      expect(Date.now() - startedAt).toBeLessThan(500);
      expect(blocks.length).toBeGreaterThan(0);
    });

    it('4000 asterisks come back as the same literal text', () => {
      const input = '*'.repeat(4000);
      expect(blocksText(parseSafeMarkdown(input))).toBe(input);
    });
  });
});
