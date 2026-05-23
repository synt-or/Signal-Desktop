// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { BodyRange } from '../../../types/BodyRange.std.ts';
import { parseMarkdown } from '../../../quill/signal-clipboard/markdown.std.ts';

describe('parseMarkdown', () => {
  it('returns empty text and no ranges for empty input', () => {
    assert.deepEqual(parseMarkdown(''), { text: '', ranges: [] });
  });

  it('returns input unchanged for plain text without markers', () => {
    assert.deepEqual(parseMarkdown('hello world'), {
      text: 'hello world',
      ranges: [],
    });
  });

  it('parses **bold** marker', () => {
    assert.deepEqual(parseMarkdown('hi **foo** bye'), {
      text: 'hi foo bye',
      ranges: [{ start: 3, length: 3, style: BodyRange.Style.BOLD }],
    });
  });

  it('parses *italic* marker', () => {
    assert.deepEqual(parseMarkdown('hi *foo* bye'), {
      text: 'hi foo bye',
      ranges: [{ start: 3, length: 3, style: BodyRange.Style.ITALIC }],
    });
  });

  it('parses ~~strikethrough~~ marker', () => {
    assert.deepEqual(parseMarkdown('~~gone~~'), {
      text: 'gone',
      ranges: [{ start: 0, length: 4, style: BodyRange.Style.STRIKETHROUGH }],
    });
  });

  it('parses `monospace` inline code', () => {
    assert.deepEqual(parseMarkdown('run `pnpm test`'), {
      text: 'run pnpm test',
      ranges: [{ start: 4, length: 9, style: BodyRange.Style.MONOSPACE }],
    });
  });

  it('does not recurse into monospace content', () => {
    assert.deepEqual(parseMarkdown('`**not bold**`'), {
      text: '**not bold**',
      ranges: [{ start: 0, length: 12, style: BodyRange.Style.MONOSPACE }],
    });
  });

  it('parses nested bold containing italic', () => {
    assert.deepEqual(parseMarkdown('**foo *bar* baz**'), {
      text: 'foo bar baz',
      ranges: [
        { start: 0, length: 11, style: BodyRange.Style.BOLD },
        { start: 4, length: 3, style: BodyRange.Style.ITALIC },
      ],
    });
  });

  it('parses fenced code block without language hint', () => {
    const input = 'before\n```\nlet x = 1;\nlet y = 2;\n```\nafter';
    const result = parseMarkdown(input);
    assert.equal(result.text, 'before\nlet x = 1;\nlet y = 2;\nafter');
    assert.deepEqual(result.ranges, [
      { start: 7, length: 21, style: BodyRange.Style.MONOSPACE },
    ]);
  });

  it('parses fenced code block and strips language hint', () => {
    const input = '```python\nprint("hi")\n```';
    const result = parseMarkdown(input);
    assert.equal(result.text, 'print("hi")');
    assert.deepEqual(result.ranges, [
      { start: 0, length: 11, style: BodyRange.Style.MONOSPACE },
    ]);
  });

  it('renders H1 as uppercase with ═ underline (no range)', () => {
    assert.deepEqual(parseMarkdown('# Hello'), {
      text: 'HELLO\n═════',
      ranges: [],
    });
  });

  it('renders H2 as bold with ─ underline', () => {
    assert.deepEqual(parseMarkdown('## Section'), {
      text: 'Section\n───────',
      ranges: [{ start: 0, length: 7, style: BodyRange.Style.BOLD }],
    });
  });

  it('renders H3 as bold only', () => {
    assert.deepEqual(parseMarkdown('### Sub'), {
      text: 'Sub',
      ranges: [{ start: 0, length: 3, style: BodyRange.Style.BOLD }],
    });
  });

  it('renders H4 as italic', () => {
    assert.deepEqual(parseMarkdown('#### Detail'), {
      text: 'Detail',
      ranges: [{ start: 0, length: 6, style: BodyRange.Style.ITALIC }],
    });
  });

  it('treats unclosed bold delimiter as literal', () => {
    assert.deepEqual(parseMarkdown('hello **world'), {
      text: 'hello **world',
      ranges: [],
    });
  });

  it('treats unclosed fence as literal (falls through to inline)', () => {
    assert.deepEqual(parseMarkdown('```\nno close'), {
      text: '```\nno close',
      ranges: [],
    });
  });

  it('treats empty delimiter content as literal', () => {
    assert.deepEqual(parseMarkdown('**'), {
      text: '**',
      ranges: [],
    });
  });
});
