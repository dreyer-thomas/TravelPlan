// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import FullscreenPhotoViewer, { type FullscreenPhoto } from "@/components/ui/FullscreenPhotoViewer";
import { MiniImageStrip, toViewerImages } from "@/components/features/trips/TripDayPlanItemContent";
import { Providers, renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 6.12. Two things are deliberately **not** asserted here and are owed to the browser pass:
 * AC3's "no lighter rim" and AC4's "no horizontal scrollbar" are appearance claims, and jsdom
 * neither lays out nor paints. What is provable here is the *structure* those two rest on — one
 * darkened surface with MUI's backdrop emptied, and no `100vw` anywhere in the style objects — plus
 * every behavioural AC (paging, key handling, the reachability of the overflow images).
 */

const PHOTOS: FullscreenPhoto[] = [
  { key: "a", imageUrl: "/uploads/a.webp", alt: "Stay photo 1" },
  { key: "b", imageUrl: "/uploads/b.webp", alt: "Stay photo 2" },
  { key: "c", imageUrl: "/uploads/c.webp", alt: "Stay photo 3" },
  { key: "d", imageUrl: "/uploads/d.webp", alt: "Stay photo 4" },
];

const renderViewer = (props: Partial<React.ComponentProps<typeof FullscreenPhotoViewer>> = {}) => {
  const onClose = vi.fn();
  const result = renderWithProviders(
    <FullscreenPhotoViewer open images={PHOTOS} startIndex={0} onClose={onClose} {...props} />,
  );
  return { ...result, onClose };
};

const viewerImage = () => within(screen.getByRole("dialog")).getByRole("img");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FullscreenPhotoViewer", () => {
  it("opens at the given index rather than always at the first image", () => {
    renderViewer({ startIndex: 2 });

    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 3");
    expect(screen.getByText("Image 3 of 4")).toBeInTheDocument();
  });

  it("pages forward and back with the on-screen controls, and the alt travels with the image", async () => {
    renderViewer({ startIndex: 1 });

    // AC9: the alt is re-read from the current image on every page, not frozen at the one the
    // viewer opened with — which is what the four inline copies did.
    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 3");
    expect(screen.getByText("Image 3 of 4")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 1");
    expect(screen.getByText("Image 1 of 4")).toBeInTheDocument();
  });

  it("pages with the arrow keys", () => {
    renderViewer({ startIndex: 0 });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 2");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 1");
  });

  it("wraps identically at both ends", () => {
    const { onClose } = renderViewer({ startIndex: 0 });
    const dialog = screen.getByRole("dialog");

    // Previous from the first lands on the last...
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 4");
    expect(screen.getByText("Image 4 of 4")).toBeInTheDocument();

    // ...and next from the last lands on the first. Same rule, both ends.
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 1");
    // Neither wrap is a dismissal.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("announces the position as a live region so paging is not silent to assistive tech", () => {
    renderViewer({ startIndex: 0 });

    // Focus stays on the paging button and its own name never changes, so without a live region a
    // screen-reader user pressing Next hears nothing at all — neither the swapped alt nor this text
    // is inside the focused node.
    const position = screen.getByText("Image 1 of 4");
    expect(position).toHaveAttribute("role", "status");
    expect(position).toHaveAttribute("aria-live", "polite");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByText("Image 2 of 4")).toHaveAttribute("role", "status");
  });

  it("keeps a way out when the collection is empty under an open viewer", () => {
    // A delete behind the viewer, or a caller that opens before its images arrive. Gating the close
    // control on the current image would leave a full-bleed black surface with nothing focusable.
    const { onClose } = renderViewer({ images: [] });

    const close = screen.getByRole("button", { name: "Close photo viewer" });
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalled();
  });

  it("advances one image per step even when two pages land in one batch", () => {
    renderViewer({ startIndex: 0 });
    const dialog = screen.getByRole("dialog");

    // Computed through the functional updater, so key-repeat cannot make both steps read the same
    // stale index and move only once.
    React.act(() => {
      fireEvent.keyDown(dialog, { key: "ArrowRight" });
      fireEvent.keyDown(dialog, { key: "ArrowRight" });
    });
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 3");
  });

  it("keeps the photo through the exit transition when the caller empties the collection on close", () => {
    // `TripDayView` and `TripDayMapFullPage` hold the collection in the same state object as the open
    // flag, so closing empties `images` in the update that flips `open` — while MUI keeps the dialog
    // mounted to animate out. Without the carry-forward the photo vanishes and a blank panel fades.
    const { rerender } = renderWithProviders(
      <FullscreenPhotoViewer open images={PHOTOS} startIndex={1} onClose={vi.fn()} />,
    );
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 2");

    rerender(
      <Providers>
        <FullscreenPhotoViewer open={false} images={[]} startIndex={0} onClose={vi.fn()} />
      </Providers>,
    );
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("alt", "Stay photo 1");
  });

  it("hides the paging controls for a single-image collection but still states the position", () => {
    renderViewer({ images: [PHOTOS[0]], startIndex: 0 });

    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous photo" })).toBeNull();
    expect(screen.getByText("Image 1 of 1")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const { onClose } = renderViewer();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on Tab, on the arrows, or on an arbitrary key", () => {
    const { onClose } = renderViewer();
    const dialog = screen.getByRole("dialog");

    // The defect this replaces: `onKeyDown={() => setFullscreenImage(null)}` on the Dialog, which
    // fired for every key — so Tab, the arrows and any typed character all dismissed the viewer.
    for (const key of ["Tab", "ArrowLeft", "ArrowRight", "a", "Enter", " "]) {
      fireEvent.keyDown(dialog, { key });
    }
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the paging and close controls keyboard-reachable with accessible names", () => {
    renderViewer();
    const dialog = screen.getByRole("dialog");

    for (const name of ["Previous photo", "Next photo", "Close photo viewer"]) {
      const control = within(dialog).getByRole("button", { name });
      expect(control.tagName).toBe("BUTTON");
      expect(control).not.toHaveAttribute("disabled");
      control.focus();
      expect(control).toHaveFocus();
    }
  });

  it("closes from the close control and from the surrounding surface", async () => {
    const { onClose } = renderViewer();

    await userEvent.click(screen.getByRole("button", { name: "Close photo viewer" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Click-to-close on the surface is behaviour users have today and is kept.
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("paging does not double as a dismissal", async () => {
    const { onClose } = renderViewer();

    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("puts the darkened fill on one surface and empties MUI's backdrop (AC3 structure)", () => {
    const { container } = renderViewer();

    // AC3: the four inline copies painted `rgba(0,0,0,0.85)` on a DialogContent that sat on top of
    // MUI's own `rgba(0,0,0,0.5)` backdrop; where the inner fill fell short, the outer read as a
    // lighter rim. Here the fill is on the dialog's own paper and the backdrop is transparent, so
    // exactly one darkened surface exists. Whether it *looks* seamless is the browser's to say.
    const paper = screen.getByRole("dialog");
    expect(paper).toHaveClass("MuiDialog-paperFullScreen");
    expect(getComputedStyle(paper).backgroundColor).toBe("rgba(0, 0, 0, 0.92)");

    const backdrop = container.ownerDocument.querySelector(".MuiBackdrop-root") as HTMLElement;
    expect(backdrop).not.toBeNull();
    expect(getComputedStyle(backdrop).backgroundColor).toBe("rgba(0, 0, 0, 0)");

    // No second fill nested inside the paper.
    const filled = Array.from(paper.querySelectorAll<HTMLElement>("*")).filter((element) => {
      const background = getComputedStyle(element).backgroundColor;
      return background.startsWith("rgba(0, 0, 0") && background !== "rgba(0, 0, 0, 0)";
    });
    // Only the position pill, which is a 4px×12px label and not a covering surface.
    expect(filled.every((element) => element.textContent?.includes("of"))).toBe(true);
  });

  it("expresses no dimension in 100vw (AC4 structure)", () => {
    renderViewer();

    // `100vw` includes the scrollbar width on a pointer device, which is what made the old inner
    // surface wider than the visible area. The emitted CSS is the honest place to check this in
    // jsdom; the absent horizontal scrollbar is the browser pass's job.
    const emitted = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("");
    expect(emitted).not.toContain("100vw");

    const paper = screen.getByRole("dialog");
    for (const element of [paper, ...Array.from(paper.querySelectorAll<HTMLElement>("*"))]) {
      expect(element.getAttribute("style") ?? "").not.toContain("vw");
    }
  });

  it("keeps the image uncropped and unlazy", () => {
    renderViewer();

    const image = viewerImage();
    expect(getComputedStyle(image).objectFit).toBe("contain");
    // The viewer's image is the thing the user just asked for.
    expect(image).not.toHaveAttribute("loading");
  });

  it("re-opens at the newly clicked image rather than where it was left", () => {
    const onClose = vi.fn();
    const { rerender } = renderWithProviders(
      <FullscreenPhotoViewer open images={PHOTOS} startIndex={0} onClose={onClose} />,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 2");

    // The providers have to come back with it: `rerender` replaces the whole tree, wrapper included.
    rerender(
      <Providers>
        <FullscreenPhotoViewer open images={PHOTOS} startIndex={3} onClose={onClose} />
      </Providers>,
    );
    expect(viewerImage()).toHaveAttribute("alt", "Stay photo 4");
  });
});

describe("MiniImageStrip", () => {
  const IMAGES = [
    { id: "one", imageUrl: "/uploads/1.webp" },
    { id: "two", imageUrl: "/uploads/2.webp" },
    { id: "three", imageUrl: "/uploads/3.webp" },
    { id: "four", imageUrl: "/uploads/4.webp" },
    { id: "five", imageUrl: "/uploads/5.webp" },
  ];

  it("wraps every thumbnail in a real button with the image's own accessible name (DW-30)", () => {
    renderWithProviders(<MiniImageStrip images={IMAGES} altPrefix="Museum" onImageClick={vi.fn()} variant="strip" />);

    // A real <button>, not `role="button"` on the <img>: the role makes the element's contents
    // presentational, which is the construction Story 6.9 had to rebuild.
    for (let index = 1; index <= 3; index += 1) {
      const button = screen.getByRole("button", { name: `Museum ${index}` });
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(within(button).getByRole("img")).toHaveAttribute("alt", `Museum ${index}`);
      button.focus();
      expect(button).toHaveFocus();
    }
  });

  it("keeps the three-thumbnail cap and hands the click an index", async () => {
    const onImageClick = vi.fn();
    renderWithProviders(
      <MiniImageStrip images={IMAGES} altPrefix="Museum" onImageClick={onImageClick} variant="strip" />,
    );

    // AC10: the cap is the mockup's photo-strip rule, not a bug. Paging is the answer to the
    // overflow, not more thumbnails.
    expect(screen.getAllByRole("img")).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: "Museum 2" }));
    expect(onImageClick).toHaveBeenCalledWith(1);
  });

  it("makes the +N indicator operable and opens it at the first hidden image (AC6)", async () => {
    const onImageClick = vi.fn();
    renderWithProviders(
      <MiniImageStrip images={IMAGES} altPrefix="Museum" onImageClick={onImageClick} variant="strip" />,
    );

    // Was inert caption text: with a three-thumbnail cap and no paging, the 4th image and beyond
    // were unreachable by any input at all.
    const overflow = screen.getByRole("button", { name: "Show 2 more photos" });
    expect(overflow).toHaveTextContent("+2");
    await userEvent.click(overflow);
    expect(onImageClick).toHaveBeenCalledWith(3);
  });

  it("names a single hidden image in the singular", async () => {
    // This string is read aloud rather than seen — it is the control's only accessible name — so the
    // codebase's singular-twin key applies rather than a written-out "(s)" a screen reader spells out.
    // Four photos is the commonest overflow case.
    const onImageClick = vi.fn();
    renderWithProviders(
      <MiniImageStrip images={IMAGES.slice(0, 4)} altPrefix="Museum" onImageClick={onImageClick} variant="strip" />,
    );

    const overflow = screen.getByRole("button", { name: "Show 1 more photo" });
    expect(overflow).toHaveTextContent("+1");
    await userEvent.click(overflow);
    expect(onImageClick).toHaveBeenCalledWith(3);
  });

  it("renders no +N control when nothing is hidden", () => {
    renderWithProviders(
      <MiniImageStrip images={IMAGES.slice(0, 2)} altPrefix="Museum" onImageClick={vi.fn()} variant="strip" />,
    );

    expect(screen.queryByRole("button", { name: /more photo/ })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("hands the viewer the whole collection, not just the rendered thumbnails", () => {
    // The half of DW-30 paging closes: `toViewerImages` is what the call sites pass along, and it
    // carries all five images with the same alt strings the strip renders.
    const collection = toViewerImages(IMAGES, "Museum");
    expect(collection).toHaveLength(5);
    expect(collection[3]).toEqual({ key: "four", imageUrl: "/uploads/4.webp", alt: "Museum 4" });
  });

  it("opens the viewer at an overflow image the strip never rendered, end to end", async () => {
    const Harness = () => {
      const [state, setState] = React.useState<{ images: FullscreenPhoto[]; index: number } | null>(null);
      return (
        <>
          <MiniImageStrip
            images={IMAGES}
            altPrefix="Museum"
            variant="strip"
            onImageClick={(index) => setState({ images: toViewerImages(IMAGES, "Museum"), index })}
          />
          <FullscreenPhotoViewer
            open={Boolean(state)}
            images={state?.images ?? []}
            startIndex={state?.index ?? 0}
            onClose={() => setState(null)}
          />
        </>
      );
    };

    renderWithProviders(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Show 2 more photos" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img")).toHaveAttribute("alt", "Museum 4");
    expect(screen.getByText("Image 4 of 5")).toBeInTheDocument();

    // ...and the fifth, which no thumbnail in the strip ever pointed at.
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByRole("img")).toHaveAttribute("alt", "Museum 5");
  });

  it("traps focus while open and returns it to the thumbnail that opened it (AC8)", async () => {
    const Harness = () => {
      const [state, setState] = React.useState<{ images: FullscreenPhoto[]; index: number } | null>(null);
      return (
        <>
          <MiniImageStrip
            images={IMAGES}
            altPrefix="Museum"
            variant="strip"
            onImageClick={(index) => setState({ images: toViewerImages(IMAGES, "Museum"), index })}
          />
          <FullscreenPhotoViewer
            open={Boolean(state)}
            images={state?.images ?? []}
            startIndex={state?.index ?? 0}
            onClose={() => setState(null)}
          />
        </>
      );
    };

    renderWithProviders(<Harness />);
    const opener = screen.getByRole("button", { name: "Museum 2" });
    await userEvent.click(opener);

    const dialog = await screen.findByRole("dialog");
    // MUI's own focus trap does this — but only because the blanket `onKeyDown` that used to sit on
    // the Dialog (and closed it on Tab) is gone.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
