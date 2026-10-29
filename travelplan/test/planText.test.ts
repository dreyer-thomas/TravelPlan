import { describe, expect, it } from "vitest";
import { parsePlanText, tiptapDocToPlainText } from "@/lib/trips/planText";

const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", ...(content.length ? { content } : {}) });
const item = (...content: unknown[]) => ({ type: "listItem", content });

describe("tiptapDocToPlainText", () => {
  it("puts each paragraph on its own line", () => {
    expect(tiptapDocToPlainText(doc(paragraph(text("Morning")), paragraph(text("Afternoon"))))).toBe("Morning\nAfternoon");
  });

  it("keeps the text of one paragraph together", () => {
    expect(tiptapDocToPlainText(doc(paragraph(text("Bold "), text("and plain", [{ type: "bold" }]))))).toBe(
      "Bold and plain",
    );
  });

  it("prefixes bullet items with a dash and counts ordered items", () => {
    const value = doc(
      { type: "bulletList", content: [item(paragraph(text("Passport"))), item(paragraph(text("Charger")))] },
      { type: "orderedList", content: [item(paragraph(text("Park"))), item(paragraph(text("Walk")))] },
    );
    expect(tiptapDocToPlainText(value)).toBe("- Passport\n- Charger\n1. Park\n2. Walk");
  });

  it("starts an ordered list at its start attribute", () => {
    const value = doc({ type: "orderedList", attrs: { start: 3 }, content: [item(paragraph(text("Three")))] });
    expect(tiptapDocToPlainText(value)).toBe("3. Three");
  });

  it("turns a hard break into a newline", () => {
    expect(tiptapDocToPlainText(doc(paragraph(text("Line one"), { type: "hardBreak" }, text("Line two"))))).toBe(
      "Line one\nLine two",
    );
  });

  it("renders a link as text (url) unless the text is the url", () => {
    const link = (href: string) => [{ type: "link", attrs: { href } }];
    const value = doc(
      paragraph(text("Tickets", link("https://example.com/t")), text(" here")),
      paragraph(text("https://example.com/x", link("https://example.com/x"))),
    );
    expect(tiptapDocToPlainText(value)).toBe("Tickets (https://example.com/t) here\nhttps://example.com/x");
  });

  it("puts headings, blockquotes and code blocks on their own lines", () => {
    const value = doc(
      { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
      { type: "blockquote", content: [paragraph(text("Quoted"))] },
      { type: "codeBlock", content: [text("code")] },
    );
    expect(tiptapDocToPlainText(value)).toBe("Plan\nQuoted\ncode");
  });

  it("collapses consecutive empty lines and trims", () => {
    const value = doc(paragraph(), paragraph(text("One")), paragraph(), paragraph(), paragraph(text("Two")), paragraph());
    expect(tiptapDocToPlainText(value)).toBe("One\n\nTwo");
  });

  it("walks the children of unknown nodes", () => {
    expect(tiptapDocToPlainText(doc({ type: "callout", content: [paragraph(text("Inside"))] }))).toBe("Inside");
  });

  it("answers an empty string for an empty doc and for invalid JSON", () => {
    expect(tiptapDocToPlainText(doc(paragraph()))).toBe("");
    expect(tiptapDocToPlainText(JSON.stringify({ type: "doc" }))).toBe("");
    expect(tiptapDocToPlainText("{not json")).toBe("");
    expect(tiptapDocToPlainText("null")).toBe("");
  });

  it("indents the continuation line of a hard break inside a list item", () => {
    const value = doc({
      type: "orderedList",
      content: [item(paragraph(text("Museum"), { type: "hardBreak" }, text("closed Mondays")))],
    });
    expect(tiptapDocToPlainText(value)).toBe("1. Museum\n   closed Mondays");
  });

  it("skips malformed nodes instead of failing the whole text", () => {
    const value = JSON.stringify({
      type: "doc",
      content: [null, 7, paragraph(text("Kept"), null), { type: "paragraph", content: "not an array" }, { type: "bulletList", content: { x: 1 } }],
    });
    expect(tiptapDocToPlainText(value)).toBe("Kept");
  });

  it("leaves parsePlanText as it was", () => {
    expect(parsePlanText(doc(paragraph(text("Morning")), paragraph(text("Afternoon"))))).toBe("Morning Afternoon");
  });
});
