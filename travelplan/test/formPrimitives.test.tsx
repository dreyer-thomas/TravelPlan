// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@mui/material";
import FormField from "@/components/forms/FormField";
import FormNotice from "@/components/forms/FormNotice";
import PhotoUploadField from "@/components/forms/PhotoUploadField";
import DialogShell from "@/components/ui/DialogShell";
import { IMAGE_UPLOAD_ACCEPT } from "@/lib/trips/imageUploads";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 7.7's shared form primitives, tested once here rather than four times across the dialogs
 * that consume them.
 *
 * These cover the three ACs that are about the primitives themselves: AC5 (the 56px photo strip and
 * its per-image accessible names), AC6 (the label move must not drift a single accessible name) and
 * AC8 (no MUI error red anywhere in this family). The geometry AC5 also specifies — 56×56 boxes,
 * `border-radius: 0`, ≥44×44 hit areas — is asserted at the style-declaration level here and
 * measured for real in the browser pass, because jsdom does not lay anything out.
 */

const IMAGES = [
  { key: "a", imageUrl: "/uploads/a.webp" },
  { key: "b", imageUrl: "/uploads/b.webp" },
  { key: "c", imageUrl: "/uploads/c.webp" },
];

describe("FormField", () => {
  it("associates the above-field label with the input via htmlFor/id", () => {
    renderWithProviders(<FormField id="trip-name" label="Trip name" />);

    const input = screen.getByLabelText("Trip name");
    expect(input).toHaveAttribute("id", "trip-name");
    expect(input.tagName).toBe("INPUT");
  });

  it("keeps the accessible name byte-identical to the i18n value, uppercasing only in CSS", () => {
    renderWithProviders(<FormField id="stay-name" label="Stay name" />);

    // The label element's textContent is what getByLabelText matches on. If the restyle uppercased
    // the string instead of the CSS, every pinned getByLabelText query would break at once.
    const label = document.querySelector('label[for="stay-name"]') as HTMLElement;
    expect(label.textContent).toBe("Stay name");
    expect(label.textContent).not.toBe("STAY NAME");
    expect(getComputedStyle(label).textTransform).toBe("uppercase");
  });

  it("puts nothing but the label text inside the <label> element", () => {
    // The mockup's `.field-label` carries an "optional" badge; rendering it inside the label would
    // change the accessible name from "Link" to "Link optional".
    renderWithProviders(<FormField id="link" label="Link" hint="Optional booking link" />);

    const label = document.querySelector('label[for="link"]') as HTMLElement;
    expect(label.textContent).toBe("Link");
    expect(screen.getByLabelText("Link")).toBeInTheDocument();
    // The hint is still rendered — just not inside the label.
    expect(screen.getByText("Optional booking link")).toBeInTheDocument();
  });

  it("renders the error line in the warn family, never MUI's error red", () => {
    renderWithProviders(<FormField id="cost" label="Cost" error="Enter a valid amount" hint="Optional amount" />);

    expect(screen.getByText("Enter a valid amount")).toBeInTheDocument();
    // An error replaces the hint rather than stacking under it.
    expect(screen.queryByText("Optional amount")).toBeNull();

    const helper = document.querySelector(".MuiFormHelperText-root") as HTMLElement;
    expect(helper).toHaveClass("Mui-error");
    // The class alone proves nothing about the colour — MUI's own `Mui-error` default is #d32f2f,
    // which DESIGN.md does not have. What is actually at risk is FormField's `warning.main`
    // override, so assert the resolved colour: `colors.warn` #8A5A2B.
    expect(getComputedStyle(helper).color).toBe("rgb(138, 90, 43)");
    expect(getComputedStyle(helper).color).not.toBe("rgb(211, 47, 47)");
  });

  it("passes a ref-carrying register() spread through to the underlying input", () => {
    // The shape react-hook-form's register() actually returns: name + onChange + onBlur + ref. The
    // ref is the non-obvious part — FormField types it `Ref<HTMLDivElement>` because MUI lands it on
    // the FormControl root, and RHF's focus-on-error only works via its querySelectorAll fallback
    // from there. If that ever became the <input>, the type is wrong; if it became null, focus
    // management silently dies.
    const onChange = vi.fn();
    const onBlur = vi.fn();
    let captured: unknown = undefined;
    const ref = (node: unknown) => {
      captured = node;
    };

    renderWithProviders(<FormField id="notes" label="Notes" name="notes" onChange={onChange} onBlur={onBlur} ref={ref} />);

    const input = screen.getByLabelText("Notes");
    expect(input).toHaveAttribute("name", "notes");

    const root = captured as HTMLElement;
    expect(root).toBeInstanceOf(HTMLElement);
    expect(root).toHaveClass("MuiFormControl-root");
    expect(root.querySelectorAll("input, select, textarea")[0]).toBe(input);

    fireEvent.change(input, { target: { value: "typed" } });
    expect(onChange).toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalled();
  });

  it("merges an array- or callback-form sx instead of dropping it", () => {
    // `TextFieldProps["sx"]` accepts object | array | callback. An object spread turns an array into
    // `{0: {...}}` and a callback into `{}`, both silently and both type-clean.
    renderWithProviders(<FormField id="boxed" label="Boxed" sx={[{ marginTop: "13px" }]} />);
    const fromArray = document.querySelector("#boxed")!.closest(".MuiFormControl-root") as HTMLElement;
    expect(getComputedStyle(fromArray).marginTop).toBe("13px");

    cleanup();

    renderWithProviders(<FormField id="fn" label="Fn" sx={() => ({ marginTop: "17px" })} />);
    const fromCallback = document.querySelector("#fn")!.closest(".MuiFormControl-root") as HTMLElement;
    expect(getComputedStyle(fromCallback).marginTop).toBe("17px");
  });
});

describe("PhotoUploadField", () => {
  // `null` (not `undefined`) means "this surface has no viewer" — `undefined` would fall through to
  // the default and re-add the handler this case is asserting the absence of.
  const renderStrip = (images = IMAGES, onImageOpen: ((index: number) => void) | null = vi.fn()) =>
    renderWithProviders(
      <PhotoUploadField
        id="gallery"
        label="Image gallery"
        zoneTitle="Choose photos"
        accept={IMAGE_UPLOAD_ACCEPT}
        multiple
        onFilesSelected={() => undefined}
        images={images.map((image) => ({ ...image, onRemove: vi.fn() }))}
        onImageOpen={onImageOpen ?? undefined}
      />,
    );

  const removeButtons = () => screen.getAllByRole("button", { name: /^Remove image/ });

  it("renders one thumbnail per image with an indexed, meaning-bearing alt string", () => {
    renderStrip();

    // AC5: dialog photo previews are meaning-bearing (DESIGN.md.Photo Alt-Text), so each carries its
    // own indexed alt rather than the single shared `trips.gallery.thumbnailAlt` value.
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.getByAltText("Image 1 of 3")).toBeInTheDocument();
    expect(screen.getByAltText("Image 2 of 3")).toBeInTheDocument();
    expect(screen.getByAltText("Image 3 of 3")).toBeInTheDocument();
    expect(screen.queryByAltText("Gallery thumbnail")).toBeNull();
  });

  it("gives every remove button a name unique within the strip", () => {
    renderStrip();

    // The defect this replaces: three buttons all named "Remove", indistinguishable to a screen
    // reader user deciding which photo to delete. Scoped to the remove controls — Story 6.12 added a
    // second button per thumbnail (the one that opens the viewer), named by the image itself.
    const names = removeButtons().map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual(["Remove image 1 of 3", "Remove image 2 of 3", "Remove image 3 of 3"]);
    expect(new Set(names).size).toBe(names.length);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("draws sharp-cornered 56px thumbnails on a fixed basis, never flex: 1", () => {
    renderStrip();

    const thumb = screen.getByAltText("Image 1 of 3");
    const style = getComputedStyle(thumb);
    expect(style.width).toBe("56px");
    expect(style.height).toBe("56px");
    // Photography is always sharp, whatever the radius of the surface holding it.
    expect(style.borderRadius).toBe("0px");
    expect(style.objectFit).toBe("cover");
    // Uniform, not stretched to fill the row (EXPERIENCE.md:67). The image now sits inside a
    // `<button>` (Story 6.12), so the fixed basis is two levels up rather than one.
    const cell = thumb.closest("div") as HTMLElement;
    expect(getComputedStyle(cell).flex).toContain("0 0 56px");
  });

  it("sizes each remove affordance to the 44px touch floor", () => {
    renderStrip();

    for (const button of removeButtons()) {
      const style = getComputedStyle(button);
      expect(Number.parseInt(style.width, 10)).toBeGreaterThanOrEqual(44);
      expect(Number.parseInt(style.height, 10)).toBeGreaterThanOrEqual(44);
    }
  });

  it("keeps the file input keyboard-reachable and named by the caps label", () => {
    renderStrip();

    // The dropzone is a transparent, full-bleed <input type="file">, not a JS click handler on a
    // div: the whole zone is the native control, so it stays focusable with no extra wiring.
    const input = screen.getByLabelText("Image gallery");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("multiple");
    expect(input).not.toHaveAttribute("hidden");
    expect(getComputedStyle(input).display).not.toBe("none");
  });

  it("renders the empty line and no strip when there are no images", () => {
    renderWithProviders(
      <PhotoUploadField
        id="gallery"
        label="Image gallery"
        zoneTitle="Choose photos"
        accept={IMAGE_UPLOAD_ACCEPT}
        onFilesSelected={() => undefined}
        emptyLabel="No images yet."
        images={[]}
      />,
    );

    expect(screen.getByText("No images yet.")).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("omits the remove affordance for a read-only preview", () => {
    // The day-details dialog's AC7 preview: removal is the footer's explicit action, not a per-thumb
    // control, so the preview renders with no remove button at all.
    renderWithProviders(
      <PhotoUploadField
        id="day-image"
        label="Day image"
        zoneTitle="Choose photos"
        accept={IMAGE_UPLOAD_ACCEPT}
        onFilesSelected={() => undefined}
        images={[{ key: "current", imageUrl: "/uploads/day.webp", alt: "Current day image" }]}
      />,
    );

    expect(screen.getByAltText("Current day image")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  // --- Story 6.12 / DW-51: thumbnails are keyboard-operable ------------------------------------

  it("wraps each thumbnail in a real button named by the image it opens", async () => {
    const onImageOpen = vi.fn();
    renderStrip(IMAGES, onImageOpen);

    // The defect: `<Box component="img" onClick={image.onOpen}>` with `cursor: pointer` and no
    // `tabIndex`, `role` or key handler — click-only, on three surfaces at once. A real `<button>`
    // wraps the image rather than `role="button"` on it, which would make its contents
    // presentational (the construction Story 6.9 had to rebuild).
    for (let index = 1; index <= 3; index += 1) {
      const button = screen.getByRole("button", { name: `Image ${index} of 3` });
      expect(button.tagName).toBe("BUTTON");
      expect(button).toHaveAttribute("type", "button");
      expect(within(button).getByAltText(`Image ${index} of 3`)).toBeInTheDocument();
      button.focus();
      expect(button).toHaveFocus();
    }

    fireEvent.click(screen.getByRole("button", { name: "Image 2 of 3" }));
    // The index into the collection, not a per-image closure over one URL: the viewer takes the
    // whole collection plus a starting index.
    expect(onImageOpen).toHaveBeenCalledWith(1);
  });

  it("renders no thumbnail button when the surface has no viewer", () => {
    // The day-details preview passes no `onImageOpen`; a control that does nothing is worse than no
    // control, so none is rendered and the tab order is unchanged.
    renderStrip(IMAGES, null);

    expect(screen.queryByRole("button", { name: "Image 1 of 3" })).toBeNull();
    expect(removeButtons()).toHaveLength(3);
  });
});

describe("DialogShell", () => {
  const renderShell = (props: Partial<React.ComponentProps<typeof DialogShell>> = {}) =>
    renderWithProviders(
      <DialogShell
        open
        onClose={() => undefined}
        title="Add stay"
        subtitle="Day 3 · 5/12"
        width={520}
        footer={<Button variant="contained">Save stay</Button>}
        {...props}
      >
        <p>body</p>
      </DialogShell>,
    );

  it("names the dialog by its title alone, not by the sub-line", () => {
    renderShell();

    // 7.5's defect #1: a sub-line inside DialogTitle joins the dialog's accessible name unless the
    // title gets its own id and the Dialog an explicit aria-labelledby.
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Add stay");
    expect(dialog).not.toHaveAccessibleName("Add stay Day 3 · 5/12");
    // The sub-line is still rendered, just not part of the name.
    expect(within(dialog).getByText("Day 3 · 5/12")).toBeInTheDocument();
  });

  it("omits the sub-line entirely when none is given", () => {
    renderShell({ subtitle: undefined });

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Add stay");
  });

  it("renders the footer content the caller supplies", () => {
    renderShell();

    expect(screen.getByRole("button", { name: "Save stay" })).toBeInTheDocument();
  });
});

describe("no MUI error red anywhere in the form primitives (AC8)", () => {
  /*
    A negative assertion is only worth its line if the positive case can actually reach the DOM.
    This pins the *mechanism* — that `color="error"` really does emit `.MuiButton-colorError` under
    this theme — so the AC8 sweeps below and in `tripAccommodationDialog.test.tsx` are known to be
    capable of failing. The sweeps that matter run against real dialog markup, not a fixture
    authored by the test: see `tripAccommodationDialog.test.tsx`.
  */
  it("would detect a colorError button if one were reintroduced", () => {
    renderWithProviders(<Button color="error">Remove stay</Button>);

    expect(screen.getByRole("button", { name: "Remove stay" })).toHaveClass("MuiButton-colorError");
  });

  it("renders no MUI Alert for a non-field message", () => {
    renderWithProviders(<FormNotice tone="warn" message="Could not save the trip." />);

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Could not save the trip.");
    expect(notice).not.toHaveClass("MuiAlert-root");
    expect(document.querySelectorAll(".MuiAlert-standardError")).toHaveLength(0);
  });
});
