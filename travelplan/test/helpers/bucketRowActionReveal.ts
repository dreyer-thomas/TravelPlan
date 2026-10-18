import "@testing-library/jest-dom/vitest";
import { within } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Story 14.2 (Tommy). Every named button in the row carries the shared row-action class, and the row's
 * stylesheet hides them under `hover: hover` until hover or focus and shows them on touch.
 */
export const expectRowActionReveal = (row: HTMLElement, buttonNames: string[]) => {
  for (const name of buttonNames) {
    expect(within(row).getByRole("button", { name })).toHaveClass("bucket-row-action");
  }
  const css = Array.from(document.querySelectorAll("style"))
    .map((node) => node.textContent ?? "")
    .join("");
  const rowClass = Array.from(row.classList).find((name) => name.startsWith("css-"))!;
  const rule = (selector: string, declaration: string) =>
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{[^}]*${declaration}`);
  expect(css).toMatch(rule(`.${rowClass} .bucket-row-action`, "opacity:0"));
  expect(css).toMatch(rule(`.${rowClass}:hover .bucket-row-action`, "opacity:1"));
  expect(css).toMatch(rule(`.${rowClass} .bucket-row-action:focus-visible`, "opacity:1"));
  for (const branch of ["@media (hover: hover)", "@media (hover: none)", "@media (any-pointer: coarse)"]) {
    expect(css).toContain(branch);
  }
};
