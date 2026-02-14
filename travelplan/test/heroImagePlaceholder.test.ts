import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("trip hero placeholder asset", () => {
  it("exists at the expected public images path", () => {
    const placeholderPath = path.resolve(process.cwd(), "public", "images", "world-map-placeholder.svg");

    expect(fs.existsSync(placeholderPath)).toBe(true);
  });
});
