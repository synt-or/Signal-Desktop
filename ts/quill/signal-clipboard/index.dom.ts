// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type Quill from '@signalapp/quill-cjs';
import { Delta } from '@signalapp/quill-cjs';
import { deleteRange } from '@signalapp/quill-cjs/modules/keyboard.js';
import { createKeybindingsHandler } from 'tinykeys';

import {
  FormattingMenu,
  QuillFormattingStyle,
} from '../formatting/menu.dom.tsx';
import { insertEmojiOps } from '../util.dom.ts';
import { createEventHandler } from './util.dom.ts';
import { BodyRange } from '../../types/BodyRange.std.ts';
import { createLogger } from '../../logging/log.std.ts';
import * as Errors from '../../types/errors.std.ts';
import { parseMarkdown, type FormattingRange } from './markdown.std.ts';

const log = createLogger('signal-clipboard');

type ClipboardOptions = Readonly<{
  isDisabled: boolean;
}>;

export class SignalClipboard {
  quill: Quill;
  options: ClipboardOptions;

  readonly #pasteHandler: (event: ClipboardEvent) => void;
  readonly #cutHandler: (event: ClipboardEvent) => void;
  readonly #keydownHandler: (event: KeyboardEvent) => void;

  constructor(quill: Quill, options: ClipboardOptions) {
    this.quill = quill;
    this.options = options;

    this.#pasteHandler = e => this.onCapturePaste(e);
    this.#cutHandler = e => this.onCaptureCut(e);
    this.#keydownHandler = createKeybindingsHandler({
      '$mod+Alt+V': event => {
        const selection = this.quill.getSelection();
        if (selection == null) return;
        event.preventDefault();
        void this.#insertFromClipboard(selection);
      },
    });

    this.quill.root.addEventListener('paste', this.#pasteHandler);
    this.quill.root.addEventListener('cut', this.#cutHandler);
    this.quill.root.addEventListener('keydown', this.#keydownHandler);
  }

  updateOptions(options: Partial<ClipboardOptions>): void {
    this.options = { ...this.options, ...options };
  }

  destroy(): void {
    this.quill.root.removeEventListener('paste', this.#pasteHandler);
    this.quill.root.removeEventListener('cut', this.#cutHandler);
    this.quill.root.removeEventListener('keydown', this.#keydownHandler);
  }

  onCaptureCut(event: ClipboardEvent): void {
    const [range] = this.quill.selection.getRange();

    // This updates the clipboard with what we want
    const handler = createEventHandler({ deleteSelection: false });
    handler(event);

    // And this updates quill's internal state and the content-editable to reflect the cut
    if (range) {
      deleteRange({ range, quill: this.quill });
    }
  }

  onCapturePaste(event: ClipboardEvent): void {
    if (this.options.isDisabled) {
      return;
    }

    if (event.clipboardData == null) {
      event.preventDefault();
      event.stopPropagation();

      return;
    }

    const { clipboard } = this.quill;
    const selection = this.quill.getSelection();
    const text = event.clipboardData.getData('text/plain');
    const signal = event.clipboardData.getData('text/signal');

    const clipboardContainsFiles = event.clipboardData.files?.length > 0;

    if (clipboardContainsFiles) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (selection == null) {
      return;
    }

    if (!text && !signal) {
      return;
    }

    const { ops } = this.quill.getContents(selection.index, selection.length);

    // Check if we're selecting all content
    const totalLength = this.quill.getLength();
    const isSelectingAll = selection.length >= totalLength - 1;

    let formats: Record<string, unknown>;
    if (selection.length === 0) {
      formats = this.quill.getFormat(selection.index);
    } else if (isSelectingAll) {
      // No formatting for select-all
      formats = {};
    } else {
      formats = {
        [QuillFormattingStyle.bold]: FormattingMenu.isStyleEnabledForOps(
          ops,
          QuillFormattingStyle.bold
        ),
        [QuillFormattingStyle.italic]: FormattingMenu.isStyleEnabledForOps(
          ops,
          QuillFormattingStyle.italic
        ),
        [QuillFormattingStyle.monospace]: FormattingMenu.isStyleEnabledForOps(
          ops,
          QuillFormattingStyle.monospace
        ),
        [QuillFormattingStyle.spoiler]: FormattingMenu.isStyleEnabledForOps(
          ops,
          QuillFormattingStyle.spoiler
        ),
        [QuillFormattingStyle.strike]: FormattingMenu.isStyleEnabledForOps(
          ops,
          QuillFormattingStyle.strike
        ),
      };
    }
    const parsed = signal ? null : parseMarkdown(text);
    let clipboardDelta: Delta;
    if (signal) {
      clipboardDelta = clipboard.convert({ html: signal }, formats);
    } else if (parsed && parsed.ranges.length > 0) {
      clipboardDelta = buildDelta(parsed.text, parsed.ranges, formats);
    } else {
      clipboardDelta = new Delta(
        insertEmojiOps(clipboard.convert({ text }, formats).ops, {})
      );
    }

    this.quill.selection.update('silent');

    if (selection) {
      setTimeout(() => {
        const delta = new Delta()
          .retain(selection.index)
          .delete(selection.length)
          .concat(clipboardDelta);
        this.quill.updateContents(delta, 'user');
        this.quill.setSelection(delta.length() - selection.length, 0, 'silent');
        this.quill.scrollSelectionIntoView();

        this.quill.focus();
      }, 1);
    }
  }

  async #insertFromClipboard(selection: {
    readonly index: number;
    readonly length: number;
  }): Promise<void> {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch (error) {
      log.warn('clipboard.readText failed', Errors.toLogFormat(error));
      return;
    }
    setTimeout(() => {
      const delta = new Delta()
        .retain(selection.index)
        .delete(selection.length)
        .insert(text);
      this.quill.updateContents(delta, 'user');
      this.quill.setSelection(selection.index + text.length, 0, 'silent');
      this.quill.scrollSelectionIntoView();
      this.quill.focus();
    }, 1);
  }
}

const STYLE_TO_QUILL_KEY: Partial<Record<BodyRange.Style, string>> = {
  [BodyRange.Style.BOLD]: QuillFormattingStyle.bold,
  [BodyRange.Style.ITALIC]: QuillFormattingStyle.italic,
  [BodyRange.Style.MONOSPACE]: QuillFormattingStyle.monospace,
  [BodyRange.Style.STRIKETHROUGH]: QuillFormattingStyle.strike,
};

function attrsEqual(a: Record<string, true>, b: Record<string, true>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!(k in b)) return false;
  return true;
}

function buildDelta(
  text: string,
  ranges: ReadonlyArray<FormattingRange>,
  contextFormats: Record<string, unknown>
): Delta {
  const delta = new Delta();
  if (text.length === 0) return delta;

  const charAttrs: Array<Record<string, true>> = Array.from(
    { length: text.length },
    () => ({})
  );
  for (const r of ranges) {
    const key = STYLE_TO_QUILL_KEY[r.style];
    if (key == null) continue;
    const end = Math.min(r.start + r.length, text.length);
    for (let i = r.start; i < end; i += 1) {
      const a = charAttrs[i];
      if (a) a[key] = true;
    }
  }

  let i = 0;
  while (i < text.length) {
    let j = i + 1;
    while (
      j < text.length &&
      attrsEqual(charAttrs[i] ?? {}, charAttrs[j] ?? {})
    ) {
      j += 1;
    }
    const mdAttrs = charAttrs[i] ?? {};
    const merged: Record<string, unknown> = { ...contextFormats, ...mdAttrs };
    const hasAttrs = Object.keys(merged).length > 0;
    delta.insert(text.slice(i, j), hasAttrs ? merged : undefined);
    i = j;
  }
  return delta;
}
