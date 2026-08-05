// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DocChip from "@/components/ui/DocChip";
import { emotionDeclarations } from "./helpers/emotionStyles";
import { renderWithProviders } from "./helpers/renderWithProviders";

const DOCUMENT_URL = "/uploads/trips/trip-1/days/day-1/accommodations/acc-1/documents/doc-1700000000000-ab12cd34.pdf";

describe("DocChip", () => {
  it("labels the chip with the file name minus its final extension, and nothing else", () => {
    renderWithProviders(
      <DocChip documentUrl={DOCUMENT_URL} fileName="Ticket Rom.v2.pdf" index={0} total={1} />,
    );

    const chip = screen.getByRole("link");
    // Exact, not a substring: the visible text is the label and only the label. The glyph beside it
    // is `aria-hidden` and contributes no text, so an extension leaking back in would show up here.
    expect(chip).toHaveTextContent(/^Ticket Rom\.v2$/);
    expect(chip.textContent).toBe("Ticket Rom.v2");
  });

  it("is an anchor to the document that opens in a new tab with the opener severed", () => {
    renderWithProviders(
      <DocChip documentUrl={DOCUMENT_URL} fileName="Ticket Rom.pdf" index={0} total={1} />,
    );

    const chip = screen.getByRole("link");
    // An anchor rather than a button is what makes the chip keyboard-reachable over the timeline
    // card's stretched edit overlay (`overlaidContentSx`'s `"& a, & button"` opt-in) and what keeps
    // an image document out of `FullscreenPhotoViewer` — there is no click handler to route it there.
    expect(chip.tagName).toBe("A");
    expect(chip).toHaveAttribute("href", DOCUMENT_URL);
    expect(chip).toHaveAttribute("target", "_blank");
    const rel = chip.getAttribute("rel") ?? "";
    expect(rel.split(/\s+/)).toEqual(expect.arrayContaining(["noreferrer", "noopener"]));
  });

  /**
   * Nothing forbids two documents on one entry sharing a file name — the unique index is on
   * `sortOrder` — and two identically named links on one card is the defect Story 5.11's review found
   * on two comboboxes. The position disambiguates the accessible name while the visible label stays
   * the bare name, so both halves are asserted here: distinguishable names, identical text.
   */
  it("distinguishes two chips carrying the same file name", () => {
    renderWithProviders(
      <>
        <DocChip documentUrl="/uploads/a/one.pdf" fileName="Ticket.pdf" index={0} total={2} />
        <DocChip documentUrl="/uploads/a/two.pdf" fileName="Ticket.pdf" index={1} total={2} />
      </>,
    );

    const [first, second] = screen.getAllByRole("link");
    const firstName = first.getAttribute("aria-label");
    const secondName = second.getAttribute("aria-label");

    expect(firstName).toBeTruthy();
    expect(secondName).toBeTruthy();
    expect(firstName).not.toBe(secondName);
    // The name still carries the document's own name — the position is added to it, not instead of it.
    expect(firstName).toContain("Ticket");
    expect(secondName).toContain("Ticket");
    // …and the two are visibly identical, which is the point of disambiguating the name rather than
    // the label.
    expect(first.textContent).toBe("Ticket");
    expect(second.textContent).toBe("Ticket");
  });

  /**
   * DESIGN.md's 44px floor, read out of what Emotion actually declared rather than out of the
   * component's source: a source grep would pass for a `minHeight: 44` sitting in a branch that never
   * renders, or under a breakpoint that resets it. `emotionDeclarations` reads the CSSOM, which
   * `getComputedStyle` cannot do for `sx` rules in jsdom.
   */
  it("declares the 44px minimum height unconditionally", () => {
    renderWithProviders(
      <DocChip documentUrl={DOCUMENT_URL} fileName="Ticket Rom.pdf" index={0} total={1} />,
    );

    const minHeight = emotionDeclarations(screen.getByRole("link"), "min-height");
    expect(minHeight.base).toContain("44px");
    // Nothing may take it away again above a breakpoint — DW-180 is that exact failure, twice.
    for (const values of minHeight.media.values()) {
      for (const value of values) expect(value).toBe("44px");
    }
  });

  it("ellipsises the label on one line at the token's 160px", () => {
    renderWithProviders(
      <DocChip
        documentUrl={DOCUMENT_URL}
        fileName="A very long booking confirmation name that cannot fit.pdf"
        index={0}
        total={1}
      />,
    );

    const label = screen.getByText("A very long booking confirmation name that cannot fit");
    expect(emotionDeclarations(label, "max-width").base).toContain("160px");
    expect(emotionDeclarations(label, "text-overflow").base).toContain("ellipsis");
    expect(emotionDeclarations(label, "white-space").base).toContain("nowrap");
    expect(emotionDeclarations(label, "overflow").base).toContain("hidden");
  });
});
