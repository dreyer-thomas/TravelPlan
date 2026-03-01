import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");
const globalsCssPath = resolve(repoRoot, "src/app/globals.css");
const landingCssPath = resolve(repoRoot, "src/app/page.module.css");
const themePath = resolve(repoRoot, "src/theme.ts");

const read = (path: string) => readFileSync(path, "utf-8");

const expectSansStack = (content: string, label: string) => {
  expect(content, `${label} should include Calibri`).toContain("Calibri");
  expect(content, `${label} should include Arial`).toContain("Arial");
  expect(content, `${label} should include sans-serif`).toContain("sans-serif");
};

describe("typography sans-serif stack", () => {
  it("removes Fraunces from theme and landing styles", () => {
    const globalsCss = read(globalsCssPath);
    const landingCss = read(landingCssPath);
    const theme = read(themePath);

    expect(globalsCss).not.toContain("Fraunces");
    expect(landingCss).not.toContain("Fraunces");
    expect(theme).not.toContain("Fraunces");
  });

  it("defines Calibri/Arial sans-serif stacks in globals and theme", () => {
    const globalsCss = read(globalsCssPath);
    const theme = read(themePath);

    expectSansStack(globalsCss, "globals.css");
    expectSansStack(theme, "theme.ts");
  });

  it("keeps landing page headings on the display font variable", () => {
    const landingCss = read(landingCssPath);

    const selectors = [".brand", ".title", ".sectionTitle", ".card h3"];
    for (const selector of selectors) {
      const pattern = new RegExp(`${selector}[\\s\\S]*?font-family:\\s*var\\(--font-display\\);`);
      expect(landingCss, `${selector} should use --font-display`).toMatch(pattern);
    }
  });

  it("forces form controls to inherit the sans-serif stack", () => {
    const globalsCss = read(globalsCssPath);

    expect(globalsCss).toMatch(/input,\s*select,\s*textarea\s*{[\s\S]*font-family:\s*inherit;/);
  });
});
