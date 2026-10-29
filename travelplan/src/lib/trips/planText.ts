/**
 * Flattens a TipTap rich-text document (`contentJson`) to the plain text every surface uses as a
 * label or a preview when a plan item has no title.
 *
 * **Why it lives here rather than in `TripDayPlanItemContent.tsx`, where it was written.** That module
 * is `"use client"`, which makes every export from it a *client reference* rather than a function: an
 * import of it from server code compiles, and then throws at call time. Story 9.2's packet route runs
 * on the server and has to derive the same labels the printed sheet shows - so the function had to move
 * somewhere both runtimes can call it. `TripDayPlanItemContent.tsx` re-exports it verbatim, so its six
 * existing importers are unaffected and there is still exactly one definition.
 *
 * Moved unchanged, deliberately. The `catch` returning `""` is load-bearing: `contentJson` is a plain
 * `String` column with no shape guarantee, and every caller treats an empty string as "no text" and
 * falls back to a positional label. A throw here would take out the whole day view.
 */
export const parsePlanText = (value: string) => {
  try {
    const doc = JSON.parse(value);
    const parts: string[] = [];

    const walk = (node: { text?: string; content?: unknown[] }) => {
      if (!node) return;
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) {
        node.content.forEach((child) => walk(child as { text?: string; content?: unknown[] }));
      }
    };

    walk(doc as { text?: string; content?: unknown[] });
    return parts.join(" ").trim();
  } catch {
    return "";
  }
};

type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: TiptapNode[];
};

const linkHrefOf = (node: TiptapNode) => {
  const href = node.marks?.find((mark) => mark.type === "link")?.attrs?.href;
  return typeof href === "string" && href.length > 0 ? href : null;
};

/** A block's inline content as one string; consecutive text nodes under the same link are one run. */
const renderInline = (nodes: TiptapNode[]): string => {
  let result = "";
  let run = { text: "", href: null as string | null };
  const flush = () => {
    result += run.href && run.text !== run.href ? `${run.text} (${run.href})` : run.text;
    run = { text: "", href: null };
  };
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (typeof node.text === "string") {
      const href = linkHrefOf(node);
      if (href !== run.href) flush();
      run.href = href;
      run.text += node.text;
    } else {
      flush();
      if (node.type === "hardBreak") result += "\n";
      else result += renderInline(childrenOf(node));
    }
  }
  flush();
  return result;
};

const INLINE_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

/** A node's children; anything but an array (stored content is not schema-checked) is none. */
const childrenOf = (node: TiptapNode): TiptapNode[] => (Array.isArray(node.content) ? node.content : []);

const renderList = (node: TiptapNode, ordered: boolean): string[] => {
  const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
  return childrenOf(node).flatMap((item, index) => {
    const prefix = ordered ? `${start + index}. ` : "- ";
    // Split here, not later: a hard break inside the item is a continuation line and takes the indent too.
    const lines = renderBlocks(childrenOf(item)).flatMap((line) => line.split("\n"));
    if (lines.length === 0) return [prefix.trimEnd()];
    return lines.map((line, position) => (position === 0 ? prefix : " ".repeat(prefix.length)) + line);
  });
};

const renderBlock = (node: TiptapNode): string[] => {
  if (!node || typeof node !== "object") return [];
  if (typeof node.text === "string" || node.type === "hardBreak") return [renderInline([node])];
  if (node.type && INLINE_BLOCKS.has(node.type)) return [renderInline(childrenOf(node))];
  if (node.type === "bulletList") return renderList(node, false);
  if (node.type === "orderedList") return renderList(node, true);
  // `doc`, `blockquote`, `listItem` and any node this function does not know: its children.
  return renderBlocks(childrenOf(node));
};

const renderBlocks = (nodes: TiptapNode[]): string[] => nodes.flatMap(renderBlock);

/**
 * Story 15.2 (AC 7). The activity's text as the connector hands it to the model: one line per block
 * (paragraph, heading, blockquote, code block), list items prefixed `- ` or `1. `, a hard break as a
 * newline, a link as `text (url)` unless the text is the URL, empty lines collapsed to one, trimmed.
 *
 * Separate from `parsePlanText` on purpose: that one joins every text node with a space, which is what a
 * label wants and what the print sheet and the day email are built on; it stays as it is. Invalid JSON
 * gives `""`, for the reason given there.
 */
export const tiptapDocToPlainText = (contentJson: string): string => {
  let doc: unknown;
  try {
    doc = JSON.parse(contentJson);
  } catch {
    return "";
  }
  if (!doc || typeof doc !== "object") return "";
  const lines = renderBlocks([doc as TiptapNode])
    .join("\n")
    .split("\n")
    .map((line) => line.trimEnd());
  const collapsed = lines.filter((line, index) => line.length > 0 || index === 0 || lines[index - 1].length > 0);
  return collapsed.join("\n").trim();
};

/**
 * Story 12.4. The reverse direction for plain text: a TipTap document with one paragraph per non-empty
 * line, as the editor would store it. Used for the description of an applied AI suggestion, which arrives
 * as plain text on the server, where the client-side builders do not run. Text that is empty after
 * trimming gives one empty paragraph; callers pass non-empty text, which `contentJson`'s rule requires.
 */
export const plainTextToTiptapDoc = (text: string): string => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const content =
    lines.length > 0
      ? lines.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }))
      : [{ type: "paragraph" }];
  return JSON.stringify({ type: "doc", content });
};

type TiptapMark = { type: "bold" } | { type: "italic" } | { type: "link"; attrs: { href: string } };
type TiptapTextNode = { type: "text"; text: string; marks?: TiptapMark[] };

/** `http(s)://` only, the rule `linkSchema` stores and the card renders. Local to keep this file import-free. */
const isHttpUrl = (value: string) => {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/** Appends a text run, merging it into the previous one when the marks are the same. */
const pushText = (nodes: TiptapTextNode[], text: string, marks: TiptapMark[]) => {
  if (text.length === 0) return;
  const previous = nodes[nodes.length - 1];
  if (previous && JSON.stringify(previous.marks ?? []) === JSON.stringify(marks)) {
    previous.text += text;
    return;
  }
  nodes.push(marks.length > 0 ? { type: "text", text, marks } : { type: "text", text });
};

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);

/**
 * For every position, the nearest index at or after it that satisfies `test` (`-1` for none), built in one
 * right-to-left pass so each lookup is O(1).
 */
const nextIndexTable = (source: string, test: (index: number) => boolean) => {
  const table = new Int32Array(source.length + 1).fill(-1);
  for (let index = source.length - 1; index >= 0; index -= 1) {
    table[index] = test(index) ? index : table[index + 1];
  }
  return table;
};

/**
 * The href of `[text](href)` whose `(` is at `open`: no whitespace, at most one level of balanced
 * parentheses (`https://en.wikipedia.org/wiki/Foo_(bar)`). Returns the index after the closing `)`, or
 * `null` when the parentheses do not close.
 */
const scanLinkHref = (source: string, open: number): { href: string; end: number } | null => {
  let depth = 0;
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index];
    if (isSpace(char)) return null;
    if (char === "(") {
      if (depth === 1) return null;
      depth = 1;
    } else if (char === ")") {
      if (depth === 0) return index > open + 1 ? { href: source.slice(open + 1, index), end: index + 1 } : null;
      depth = 0;
    }
  }
  return null;
};

/**
 * The inline Markdown of one line: `**bold**`, `*italic*`, `[text](https://...)`; anything else is text.
 * Index-based: the closing delimiters come from tables built once per call and each link target is
 * scanned once, so a line full of unclosed `*` or `[` stays linear rather than rescanning the rest.
 */
const parseInline = (source: string, marks: TiptapMark[], nodes: TiptapTextNode[]) => {
  const inLink = marks.some((mark) => mark.type === "link");
  const inBold = marks.some((mark) => mark.type === "bold");
  const inItalic = marks.some((mark) => mark.type === "italic");
  // `**` that can close bold: its content's last character is not whitespace.
  const boldClose = nextIndexTable(
    source,
    (index) => source[index] === "*" && source[index + 1] === "*" && index > 0 && !isSpace(source[index - 1]),
  );
  const nextStar = nextIndexTable(source, (index) => source[index] === "*");
  const nextBracket = nextIndexTable(source, (index) => source[index] === "]" || source[index] === "\n");
  const hrefAt = new Map<number, { href: string; end: number } | null>();

  let literalStart = 0;
  let index = 0;
  const emit = (inner: string, mark: TiptapMark, end: number) => {
    pushText(nodes, source.slice(literalStart, index), marks);
    parseInline(inner, [...marks, mark], nodes);
    index = end;
    literalStart = end;
  };

  while (index < source.length) {
    const char = source[index];
    if (char === "[" && !inLink) {
      const close = nextBracket[index + 1];
      if (close > index + 1 && source[close] === "]" && source[close + 1] === "(") {
        if (!hrefAt.has(close)) hrefAt.set(close, scanLinkHref(source, close + 1));
        const target = hrefAt.get(close);
        if (target && isHttpUrl(target.href)) {
          emit(source.slice(index + 1, close), { type: "link", attrs: { href: target.href } }, target.end);
          continue;
        }
      }
    }
    if (char === "*") {
      if (!inBold && source[index + 1] === "*" && !isSpace(source[index + 2])) {
        const close = index + 3 <= source.length ? boldClose[index + 3] : -1;
        if (close >= 0) {
          emit(source.slice(index + 2, close), { type: "bold" }, close + 2);
          continue;
        }
      }
      const opensItalic = !inItalic && source[index + 1] !== "*" && !isSpace(source[index + 1]);
      if (opensItalic) {
        const close = nextStar[index + 1];
        if (close > index + 1 && !isSpace(source[close - 1])) {
          emit(source.slice(index + 1, close), { type: "italic" }, close + 1);
          continue;
        }
      }
    }
    index += 1;
  }
  pushText(nodes, source.slice(literalStart), marks);
};

const inlineContent = (line: string) => {
  const nodes: TiptapTextNode[] = [];
  parseInline(line, [], nodes);
  return nodes;
};

const paragraphOf = (line: string) => {
  const content = inlineContent(line);
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
};

const BULLET_ITEM = /^\s*[-*]\s+(.*)$/;
const ORDERED_ITEM = /^\s*(\d{1,9})[.)]\s+(.*)$/;
/** An ordered list starts only on `1.`: "2026. Ein Jahr" is a sentence, not the start of a list. */
const ORDERED_START = 1;

/**
 * Story 15.4. The connector's description text (plain text or simple Markdown) as the TipTap document the
 * editor stores, so an activity Claude writes opens in the dialog like one typed there. Node and mark
 * names are the editor's (StarterKit's `paragraph`, `bulletList`, `orderedList`, `listItem`, `bold`,
 * `italic`, and the `link` extension's mark with `href`).
 *
 * Supported: one paragraph per non-empty line (as `plainTextToTiptapDoc`), `-`/`*` bullet lists, ordered
 * lists (started by a line numbered `1.`, continued by the numbered lines that follow), `**bold**`, `*italic*` and `[text](https://...)`
 * links. Everything else, headings and links to other schemes included, stays literal text. Text that is
 * empty after trimming gives one empty paragraph, which `contentJsonSchema` refuses, as it should.
 */
export const markdownToTiptapDoc = (text: string): string => {
  const blocks: Record<string, unknown>[] = [];
  let list: { type: "bulletList" | "orderedList"; start: number; items: Record<string, unknown>[] } | null = null;
  const closeList = () => {
    if (!list) return;
    blocks.push(
      list.type === "orderedList"
        ? { type: "orderedList", attrs: { start: list.start }, content: list.items }
        : { type: "bulletList", content: list.items },
    );
    list = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      closeList();
      continue;
    }
    const bullet = BULLET_ITEM.exec(line);
    const numbered = bullet ? null : ORDERED_ITEM.exec(line);
    // A numbered line continues an open ordered list; otherwise only `1.` starts one.
    const continuesOrdered = (list as { type: string } | null)?.type === "orderedList";
    const ordered =
      numbered && (continuesOrdered || Number.parseInt(numbered[1], 10) === ORDERED_START) ? numbered : null;
    if (bullet || ordered) {
      const type = bullet ? "bulletList" : "orderedList";
      const itemText = (bullet ? bullet[1] : ordered![2]).trim();
      if (!list || list.type !== type) {
        closeList();
        list = { type, start: ORDERED_START, items: [] };
      }
      list.items.push({ type: "listItem", content: [paragraphOf(itemText)] });
      continue;
    }
    closeList();
    blocks.push(paragraphOf(line));
  }
  closeList();

  return JSON.stringify({ type: "doc", content: blocks.length > 0 ? blocks : [{ type: "paragraph" }] });
};
