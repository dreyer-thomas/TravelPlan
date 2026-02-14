// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it } from "vitest";

// eslint-disable-next-line no-console
console.log("tiptap import test: start");

describe("tiptap imports", () => {
  it("imports @tiptap/react", async () => {
    // eslint-disable-next-line no-console
    console.log("tiptap import: before @tiptap/react");
    await import("@tiptap/react");
    // eslint-disable-next-line no-console
    console.log("tiptap import: after @tiptap/react");
  });

  it("imports @tiptap/starter-kit", async () => {
    // eslint-disable-next-line no-console
    console.log("tiptap import: before @tiptap/starter-kit");
    await import("@tiptap/starter-kit");
    // eslint-disable-next-line no-console
    console.log("tiptap import: after @tiptap/starter-kit");
  });

  it("imports @tiptap/extension-link", async () => {
    // eslint-disable-next-line no-console
    console.log("tiptap import: before @tiptap/extension-link");
    await import("@tiptap/extension-link");
    // eslint-disable-next-line no-console
    console.log("tiptap import: after @tiptap/extension-link");
  });
});
