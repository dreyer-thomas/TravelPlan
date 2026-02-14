// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it } from "vitest";

// eslint-disable-next-line no-console
console.log("mui import test: start");

describe("mui imports", () => {
  it("imports @mui/material", async () => {
    // eslint-disable-next-line no-console
    console.log("mui import: before @mui/material");
    await import("@mui/material");
    // eslint-disable-next-line no-console
    console.log("mui import: after @mui/material");
  });

  it("imports @mui/material/Dialog", async () => {
    // eslint-disable-next-line no-console
    console.log("mui import: before @mui/material/Dialog");
    await import("@mui/material/Dialog");
    // eslint-disable-next-line no-console
    console.log("mui import: after @mui/material/Dialog");
  });
});
