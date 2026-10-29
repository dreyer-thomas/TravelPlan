import { describe, expect, it } from "vitest";
import { markdownToTiptapDoc, parsePlanText, tiptapDocToPlainText } from "@/lib/trips/planText";
import { contentJsonSchema } from "@/lib/validation/dayPlanItemSchemas";

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

describe("markdownToTiptapDoc (Story 15.4)", () => {
  const parsed = (value: string) => JSON.parse(markdownToTiptapDoc(value));

  it("makes one paragraph per non-empty line, as plainTextToTiptapDoc", () => {
    expect(parsed("Morning\n\n  Afternoon  ")).toEqual(
      JSON.parse(doc(paragraph(text("Morning")), paragraph(text("Afternoon")))),
    );
  });

  it("converts bold, italic and http(s) links with the editor's mark names", () => {
    expect(parsed("Book **early** and *relax* at [the museum](https://museum.example/a)")).toEqual(
      JSON.parse(
        doc(
          paragraph(
            text("Book "),
            text("early", [{ type: "bold" }]),
            text(" and "),
            text("relax", [{ type: "italic" }]),
            text(" at "),
            text("the museum", [{ type: "link", attrs: { href: "https://museum.example/a" } }]),
          ),
        ),
      ),
    );
    expect(parsed("**see [map](https://map.example)**")).toEqual(
      JSON.parse(
        doc(
          paragraph(
            text("see ", [{ type: "bold" }]),
            text("map", [{ type: "bold" }, { type: "link", attrs: { href: "https://map.example" } }]),
          ),
        ),
      ),
    );
  });

  it("builds bullet and ordered lists, the ordered one started by 1. and continued by any number", () => {
    expect(parsed("Pack:\n- passport\n* tickets\n1. first\n3. second")).toEqual(
      JSON.parse(
        doc(
          paragraph(text("Pack:")),
          { type: "bulletList", content: [item(paragraph(text("passport"))), item(paragraph(text("tickets")))] },
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [item(paragraph(text("first"))), item(paragraph(text("second")))],
          },
        ),
      ),
    );
  });

  it("keeps everything else literal: headings, unclosed marks, links to other schemes", () => {
    expect(parsed("# Title")).toEqual(JSON.parse(doc(paragraph(text("# Title")))));
    expect(parsed("2 * 3 = 6 and **open")).toEqual(JSON.parse(doc(paragraph(text("2 * 3 = 6 and **open")))));
    expect(parsed("[x](javascript:alert(1))")).toEqual(JSON.parse(doc(paragraph(text("[x](javascript:alert(1))")))));
  });

  it("does not start an ordered list on a number other than 1", () => {
    expect(parsed("2026. Ein Jahr\n3. Mal")).toEqual(
      JSON.parse(doc(paragraph(text("2026. Ein Jahr")), paragraph(text("3. Mal")))),
    );
  });

  it("allows one level of balanced parentheses in a link target", () => {
    expect(parsed("[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) and more")).toEqual(
      JSON.parse(
        doc(
          paragraph(
            text("Foo", [{ type: "link", attrs: { href: "https://en.wikipedia.org/wiki/Foo_(bar)" } }]),
            text(" and more"),
          ),
        ),
      ),
    );
    expect(parsed("[x](https://a.example/((b)))")).toEqual(JSON.parse(doc(paragraph(text("[x](https://a.example/((b)))")))));
  });

  it("parses a long line of unclosed delimiters quickly and keeps it literal", () => {
    const line = "*a **b [c](d ".repeat(20_000);
    const started = performance.now();
    const result = parsed(line);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(result).toEqual(JSON.parse(doc(paragraph(text(line.trim())))));
  });

  it("passes contentJsonSchema for text and fails it for blank text", () => {
    expect(contentJsonSchema.safeParse(markdownToTiptapDoc("- one\n**two**")).success).toBe(true);
    expect(contentJsonSchema.safeParse(markdownToTiptapDoc("  \n ")).success).toBe(false);
  });

  it("reads back through tiptapDocToPlainText", () => {
    expect(tiptapDocToPlainText(markdownToTiptapDoc("Intro\n- a\n- b\n1. c\nSee [site](https://x.example)"))).toBe(
      "Intro\n- a\n- b\n1. c\nSee site (https://x.example)",
    );
  });
});
