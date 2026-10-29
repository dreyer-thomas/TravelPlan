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
