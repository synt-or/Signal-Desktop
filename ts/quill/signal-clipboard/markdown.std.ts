// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { BodyRange } from '../../types/BodyRange.std.ts';
import { createLogger } from '../../logging/log.std.ts';

const log = createLogger('markdown');
const MAX_NESTING_DEPTH = 5;

export type FormattingRange = BodyRange<BodyRange.Formatting>;

export type ParsedMarkdown = Readonly<{
  text: string;
  ranges: ReadonlyArray<FormattingRange>;
}>;

type InlineRule = Readonly<{
  delim: string;
  style: BodyRange.Style;
  recursive: boolean;
}>;

const INLINE_RULES: ReadonlyArray<InlineRule> = [
  { delim: '`', style: BodyRange.Style.MONOSPACE, recursive: false },
  { delim: '~~', style: BodyRange.Style.STRIKETHROUGH, recursive: true },
  { delim: '**', style: BodyRange.Style.BOLD, recursive: true },
  { delim: '__', style: BodyRange.Style.BOLD, recursive: true },
  { delim: '*', style: BodyRange.Style.ITALIC, recursive: true },
  { delim: '_', style: BodyRange.Style.ITALIC, recursive: true },
];

export function parseMarkdown(input: string): ParsedMarkdown {
  if (input.length === 0) {
    return { text: '', ranges: [] };
  }

  const lines = input.split('\n');
  const out: Array<string> = [];
  const ranges: Array<FormattingRange> = [];
  let pos = 0;

  const push = (s: string): void => {
    out.push(s);
    pos += s.length + 1;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (line.startsWith('```')) {
      const close = findFenceClose(lines, i + 1);
      if (close >= 0) {
        const body = lines.slice(i + 1, close).join('\n');
        ranges.push({
          start: pos,
          length: body.length,
          style: BodyRange.Style.MONOSPACE,
        });
        push(body);
        i = close;
        continue;
      }
    }

    const hm = line.match(/^(#{1,6}) (.+)$/);
    if (hm) {
      const level = (hm[1] ?? '').length;
      const content = hm[2] ?? '';
      if (level === 1) {
        const upper = content.toUpperCase();
        push(upper);
        push('═'.repeat(upper.length));
      } else if (level === 2) {
        ranges.push({
          start: pos,
          length: content.length,
          style: BodyRange.Style.BOLD,
        });
        push(content);
        push('─'.repeat(content.length));
      } else if (level === 3) {
        ranges.push({
          start: pos,
          length: content.length,
          style: BodyRange.Style.BOLD,
        });
        push(content);
      } else {
        ranges.push({
          start: pos,
          length: content.length,
          style: BodyRange.Style.ITALIC,
        });
        push(content);
      }
      continue;
    }

    const sub = parseInline(line, pos, 0);
    for (const r of sub.ranges) ranges.push(r);
    push(sub.text);
  }

  return { text: out.join('\n'), ranges };
}

function findFenceClose(lines: ReadonlyArray<string>, from: number): number {
  for (let i = from; i < lines.length; i += 1) {
    if ((lines[i] ?? '').startsWith('```')) return i;
  }
  return -1;
}

function parseInline(
  text: string,
  baseOffset: number,
  depth: number
): { text: string; ranges: ReadonlyArray<FormattingRange> } {
  if (depth > MAX_NESTING_DEPTH) {
    log.warn(`markdown: max nesting depth ${MAX_NESTING_DEPTH} reached`);
    return { text, ranges: [] };
  }
  let result = '';
  const ranges: Array<FormattingRange> = [];
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const rule of INLINE_RULES) {
      if (!text.startsWith(rule.delim, i)) continue;
      if (rule.delim.length === 1 && text[i + 1] === rule.delim) continue;
      const close = text.indexOf(rule.delim, i + rule.delim.length);
      if (close < 0 || close === i + rule.delim.length) continue;
      const inner = text.slice(i + rule.delim.length, close);
      const start = baseOffset + result.length;
      if (rule.recursive) {
        const sub = parseInline(inner, start, depth + 1);
        ranges.push({ start, length: sub.text.length, style: rule.style });
        for (const r of sub.ranges) ranges.push(r);
        result += sub.text;
      } else {
        ranges.push({ start, length: inner.length, style: rule.style });
        result += inner;
      }
      i = close + rule.delim.length;
      matched = true;
      break;
    }
    if (!matched) {
      result += text[i] ?? '';
      i += 1;
    }
  }
  return { text: result, ranges };
}
