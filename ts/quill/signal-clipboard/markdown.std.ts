// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { BodyRange } from '../../types/BodyRange.std.ts';
import { createLogger } from '../../logging/log.std.ts';

const log = createLogger('markdown');
const MAX_NESTING_DEPTH = 5;

export type FormattingRange = BodyRange<BodyRange.Formatting>;

const INLINE_RULES = [
  { delim: '`', style: BodyRange.Style.MONOSPACE, recursive: false },
  { delim: '~~', style: BodyRange.Style.STRIKETHROUGH, recursive: true },
  { delim: '**', style: BodyRange.Style.BOLD, recursive: true },
  { delim: '__', style: BodyRange.Style.BOLD, recursive: true },
  { delim: '*', style: BodyRange.Style.ITALIC, recursive: true },
  { delim: '_', style: BodyRange.Style.ITALIC, recursive: true },
] as const;

export function parseMarkdown(input: string): {
  text: string;
  ranges: ReadonlyArray<FormattingRange>;
} {
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
      const content = level === 1 ? (hm[2] ?? '').toUpperCase() : (hm[2] ?? '');
      const headerStart = pos;
      if (level >= 2) {
        ranges.push({
          start: pos,
          length: content.length,
          style: level <= 3 ? BodyRange.Style.BOLD : BodyRange.Style.ITALIC,
        });
      }
      push(content);
      if (level === 1) push('═'.repeat(content.length));
      else if (level === 2) push('─'.repeat(content.length));
      if (level <= 2) {
        ranges.push({
          start: headerStart,
          length: content.length * 2 + 1,
          style: BodyRange.Style.MONOSPACE,
        });
      }
      continue;
    }

    if (line.trimStart().startsWith('|') && isTableSeparator(lines[i + 1])) {
      const end = findTableEnd(lines, i);
      const table = renderTable(lines.slice(i, end), pos);
      ranges.push(...table.ranges);
      for (const l of table.lines) push(l);
      i = end - 1;
      continue;
    }

    if (/^ *\d+\.\s+\S/.test(line)) {
      const end = findNumberedListEnd(lines, i);
      const list = renderNumberedList(lines.slice(i, end), pos);
      ranges.push(...list.ranges);
      for (const l of list.lines) push(l);
      i = end - 1;
      continue;
    }

    const bm = line.match(/^( *)[-*]\s+(.+)$/);
    if (bm) {
      const indent = bm[1] ?? '';
      const marker = indent.length === 0 ? '•' : '◦';
      const prefix = `${indent}${marker} `;
      const inner = parseInline(bm[2] ?? '', pos + prefix.length, 0);
      ranges.push(...inner.ranges);
      push(prefix + inner.text);
      continue;
    }

    const sub = parseInline(line, pos, 0);
    ranges.push(...sub.ranges);
    push(sub.text);
  }

  return { text: out.join('\n'), ranges };
}

function isTableSeparator(line: string | undefined): boolean {
  return line !== undefined && /^\s*\|[\s\-:|]+\|\s*$/.test(line);
}

function findTableEnd(lines: ReadonlyArray<string>, start: number): number {
  let end = start + 2;
  while (end < lines.length && (lines[end] ?? '').trimStart().startsWith('|')) {
    end += 1;
  }
  return end;
}

function parseTableRow(line: string): ReadonlyArray<string> {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

function renderTable(
  rows: ReadonlyArray<string>,
  baseOffset: number
): {
  lines: ReadonlyArray<string>;
  ranges: ReadonlyArray<FormattingRange>;
} {
  const cells: Array<ReadonlyArray<string>> = rows.map((r, i) =>
    i === 1 ? [] : parseTableRow(r)
  );
  const dataRows = cells.filter((_row, i) => i !== 1);
  const numCols = Math.max(...dataRows.map(c => c.length));
  const widths = Array.from({ length: numCols }, (_unused, j) =>
    Math.max(...dataRows.map(c => (c[j] ?? '').length))
  );

  const outLines: Array<string> = [];
  const ranges: Array<FormattingRange> = [];
  let pos = baseOffset;

  for (let i = 0; i < cells.length; i += 1) {
    if (i === 1) {
      const sep = `|${widths.map(w => '-'.repeat(w + 2)).join('|')}|`;
      outLines.push(sep);
      pos += sep.length + 1;
      continue;
    }
    const row = cells[i] ?? [];
    let lineText = '|';
    let cellStart = pos + 2;
    for (let j = 0; j < numCols; j += 1) {
      const cell = row[j] ?? '';
      lineText += ` ${cell.padEnd(widths[j] ?? 0)} |`;
      if (i === 0 && cell.length > 0) {
        ranges.push({
          start: cellStart,
          length: cell.length,
          style: BodyRange.Style.BOLD,
        });
      }
      cellStart += (widths[j] ?? 0) + 3;
    }
    outLines.push(lineText);
    pos += lineText.length + 1;
  }

  ranges.push({
    start: baseOffset,
    length: outLines.join('\n').length,
    style: BodyRange.Style.MONOSPACE,
  });

  return { lines: outLines, ranges };
}

function findNumberedListEnd(
  lines: ReadonlyArray<string>,
  start: number
): number {
  let end = start;
  while (end < lines.length && /^ *\d+\.\s+\S/.test(lines[end] ?? '')) {
    end += 1;
  }
  return end;
}

function renderNumberedList(
  lines: ReadonlyArray<string>,
  baseOffset: number
): {
  lines: ReadonlyArray<string>;
  ranges: ReadonlyArray<FormattingRange>;
} {
  const parsed = lines.map(l => l.match(/^( *)(\d+)\.\s+(.+)$/));
  const maxDigits = Math.max(...parsed.map(m => (m?.[2] ?? '').length));

  const outLines: Array<string> = [];
  const ranges: Array<FormattingRange> = [];
  let pos = baseOffset;

  for (const m of parsed) {
    if (!m) continue;
    const indent = m[1] ?? '';
    const num = m[2] ?? '';
    const content = m[3] ?? '';
    const paddedNum = `${num.padStart(maxDigits, ' ')}.`;
    const prefix = `${indent}${paddedNum} `;
    ranges.push({
      start: pos + indent.length + (maxDigits - num.length),
      length: num.length + 1,
      style: BodyRange.Style.BOLD,
    });
    const inner = parseInline(content, pos + prefix.length, 0);
    ranges.push(...inner.ranges);
    const lineText = prefix + inner.text;
    outLines.push(lineText);
    pos += lineText.length + 1;
  }

  return { lines: outLines, ranges };
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
        ranges.push(...sub.ranges);
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
