// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogCloseButton, DialogTitleWithClose } from "@/components/ui/DialogCloseButton";
import DiscardChangesDialog, { useDiscardGuard } from "@/components/ui/DiscardChangesDialog";
import { Dialog, DialogContent } from "@mui/material";
import TripDeleteDialog from "@/components/features/trips/TripDeleteDialog";
import TripEditDialog from "@/components/features/trips/TripEditDialog";
import TripImportDialog from "@/components/features/trips/TripImportDialog";
import TripCreateDialog from "@/components/features/trips/TripCreateDialog";
import TripDayTravelSegmentDialog from "@/components/features/trips/TripDayTravelSegmentDialog";
import TripAccommodationDialog from "@/components/features/trips/TripAccommodationDialog";
import TripBucketListPanel from "@/components/features/trips/TripBucketListPanel";
import FullscreenPhotoViewer from "@/components/ui/FullscreenPhotoViewer";
import TripShareDialog from "@/components/features/trips/TripShareDialog";
import { renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 6.25 — "Close Is a Cross, and Keeping Is Named".
 *
 * The claims here are the ones no per-dialog suite can make, because they are claims about *every*
 * dialog: that the control is the same control in the same corner with the same name (AC1), that no
 * form dialog offers a footer Cancel any more (AC2, AC4), that the two destructive confirmations kept
 * both buttons and renamed the safe one (AC3), and that a form with typing in it asks before the
 * glyph throws it away (AC7).
 *
 * Deliberately **not** a grep over source text. Every assertion below goes through a rendered dialog
 * against real MUI, because "the `✕` is there" and "the `✕` is reachable, named and wired to close" are
 * different statements and only the second one is worth anything.
 */

const csrfResponse = {
  ok: true,
  status: 200,
  json: async () => ({ data: { csrfToken: "test-token" }, error: null }),
};

const emptyBucketList = {
  ok: true,
  status: 200,
  json: async () => ({ data: { items: [] }, error: null }),
};

const BUCKET_ITEM = {
  id: "bucket-1",
  tripId: "trip-1",
  title: "Livraria Lello",
  description: null,
  positionText: null,
  location: null,
  position: 1,
};

/** Swaps the bucket-list collection for one holding a single item, so its delete path is reachable. */
const stubBucketListWithOneItem = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("bucket-list-items")) {
        return { ok: true, status: 200, json: async () => ({ data: { items: [BUCKET_ITEM] }, error: null }) };
      }
      return csrfResponse;
    }) as unknown as typeof fetch,
  );

const TRIP = {
  id: "trip-1",
  name: "Portugal Roadtrip",
  startDate: "2026-09-12T00:00:00.000Z",
  endDate: "2026-09-20T00:00:00.000Z",
  dayCount: 9,
  accommodationCostTotalCents: null,
  heroImageUrl: null,
};

/** The one query this whole story is about: a control named by `common.close`, in English. */
const closeControls = () => screen.queryAllByRole("button", { name: "Close" });
const closeControl = () => screen.getByRole("button", { name: "Close" });

beforeEach(() => {
  // Every dialog below fetches a CSRF token on open, and two also load a collection. A permissive
  // default keeps this suite about chrome rather than about each dialog's network shape.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("bucket-list-items")) return emptyBucketList;
      return csrfResponse;
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the shared close control (AC1, AC6)", () => {
  const renderTitleRow = (props: Partial<Parameters<typeof DialogTitleWithClose>[0]> = {}) =>
    renderWithProviders(
      <Dialog open>
        <DialogTitleWithClose label="Close" onClose={() => undefined} {...props}>
          Delete trip?
        </DialogTitleWithClose>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );

  /**
   * `DESIGN.md.Components → icon-button.close`, measured off the computed style rather than off the
   * `sx` literal — a literal cannot tell you the theme's `MuiPaper` border landed on it anyway.
   * `formPrimitives.test.tsx` makes the same assertions through `DialogShell`; this is the other half,
   * the path the ten dialogs that build their own `<Dialog>` take, and the two must not diverge.
   */
  it("builds the glyph to icon-button.close on the non-shell path too", () => {
    renderTitleRow();
    const style = getComputedStyle(screen.getByTestId("dialog-close"));

    expect(style.width).toBe("44px");
    expect(style.height).toBe("44px");
    expect(style.borderStyle === "" || style.borderStyle === "none").toBe(true);
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // #6B675C — `{colors.ink-soft}`, the token DESIGN.md names for a dismissive icon action.
    expect(style.color).toBe("rgb(107, 103, 92)");
  });

  /**
   * `theme.ts` scopes the app-wide focus ring to `MuiButton` and MUI's `ButtonBase` ships `outline: 0`,
   * so an `IconButton` shows nothing under keyboard focus unless it says so itself. Story 6.24 fixed
   * that per-site on two buttons (DW-154); the point of the shared component is that the fix travels
   * with the glyph, so it is asserted on the shared path rather than on each of the ten call sites.
   */
  it("carries the focus ring with it", () => {
    renderTitleRow();
    const button = screen.getByTestId("dialog-close");

    // The `before` half is the whole point: `0px` is what an unstyled MUI IconButton computes to.
    expect(getComputedStyle(button).outline).toBe("0px");

    button.classList.add("Mui-focusVisible");

    expect(getComputedStyle(button).outline).toBe("2px solid #2B2A26");
    expect(getComputedStyle(button).outlineOffset).toBe("2px");
  });

  /**
   * MUI's `DialogTitle` is an `<h2>` and the glyph sits inside it, so name-from-content walks into the
   * button and a screen reader navigating by heading hears "Delete trip? · Close". The heading role
   * moves down onto the title line. `DialogShell` hit this in 6.24; the fix has to travel with the
   * glyph or each of the ten reintroduces it.
   */
  it("keeps the glyph out of the heading's name", () => {
    renderTitleRow();

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveAccessibleName("Delete trip?");
    expect(heading).not.toContainElement(screen.getByTestId("dialog-close"));
  });

  it("names the glyph and calls onClose", async () => {
    const onClose = vi.fn();
    renderTitleRow({ onClose });

    expect(closeControl()).toHaveAccessibleName("Close");
    await userEvent.click(closeControl());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** A dialog that refuses Escape while honouring the `✕` has not protected anyone's input. */
  it("disables the glyph while a write is in flight", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <Dialog open>
        <DialogTitleWithClose label="Close" onClose={onClose} disabled>
          Delete trip?
        </DialogTitleWithClose>
      </Dialog>,
    );

    // `fireEvent`, not `userEvent`: MUI's disabled button carries `pointer-events: none` and
    // `userEvent` refuses the interaction rather than performing a no-op, which would pass this for
    // the wrong reason.
    expect(screen.getByTestId("dialog-close")).toBeDisabled();
    fireEvent.click(screen.getByTestId("dialog-close"));
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * A real `Tooltip`, not the native `title` attribute — `title` never fires on keyboard focus and
   * never on touch, which on a dialog's only labelled dismissal would reach mouse users alone. The
   * tooltip repeats the accessible name rather than replacing it, so `aria-label` has to survive.
   */
  it("uses a tooltip that repeats rather than replaces the name", async () => {
    renderWithProviders(<DialogCloseButton label="Close" onClose={() => undefined} />);

    const button = screen.getByTestId("dialog-close");
    expect(button).toHaveAttribute("aria-label", "Close");
    expect(button).not.toHaveAttribute("title");

    await userEvent.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Close");
  });
});

describe("the discard guard (AC7)", () => {
  const Harness = ({ dirty, onClose }: { dirty: boolean; onClose: () => void }) => {
    const guard = useDiscardGuard(dirty, onClose);
    return (
      <>
        <Dialog open onClose={guard.requestClose}>
          <DialogTitleWithClose label="Close" onClose={guard.requestClose}>
            Edit trip
          </DialogTitleWithClose>
        </Dialog>
        <DiscardChangesDialog {...guard.dialogProps} />
      </>
    );
  };

  it("closes an untouched form in one click, asking nothing", async () => {
    const onClose = vi.fn();
    renderWithProviders(<Harness dirty={false} onClose={onClose} />);

    await userEvent.click(closeControl());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  it("asks before discarding typed input, and keeping leaves the form open", async () => {
    const onClose = vi.fn();
    renderWithProviders(<Harness dirty onClose={onClose} />);

    await userEvent.click(closeControl());

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("discard-changes-body")).toHaveTextContent(
      "Your changes will be discarded.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Keep editing" })).toBeNull());
  });

  it("closes on the discard answer", async () => {
    const onClose = vi.fn();
    renderWithProviders(<Harness dirty onClose={onClose} />);

    await userEvent.click(closeControl());
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The glyph, Escape and the backdrop are one outcome, which is what makes guarding the handler guard
   * all three. A dialog that asks on the `✕` and discards silently on Escape has the pattern in name
   * only, and Escape is the gesture a user reaches for fastest.
   */
  it("asks on Escape as well as on the glyph", async () => {
    const onClose = vi.fn();
    renderWithProviders(<Harness dirty onClose={onClose} />);

    fireEvent.keyDown(screen.getAllByRole("dialog")[0], { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("discard-changes-body")).toBeInTheDocument();
  });

  /**
   * The safe answer is also what Escape and the backdrop resolve to on the *question* — and it is why
   * the question needs no `✕` of its own. Two clicks on the same corner would otherwise land the user
   * back in the form they were leaving.
   */
  it("gives the question itself no close glyph, and resolves its own Escape to keeping", async () => {
    const onClose = vi.fn();
    renderWithProviders(<Harness dirty onClose={onClose} />);

    await userEvent.click(closeControl());
    const question = await screen.findByRole("dialog");

    expect(within(question).queryByTestId("dialog-close")).toBeNull();

    fireEvent.keyDown(question, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("every dialog carries exactly one ✕ (AC1) and no Cancel (AC2)", () => {
  /**
   * One case per dialog rather than a loop: the props differ, and a table that has to carry six
   * different prop shapes stops being more readable than the cases it replaced. What is shared is the
   * *assertion*, below.
   */
  const expectSingleNamedClose = async (onClose: ReturnType<typeof vi.fn>) => {
    expect(closeControls()).toHaveLength(1);
    // AC2/AC4: `common.cancel` is gone, so no dialog offers a button named Cancel any more.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await userEvent.click(closeControl());
    expect(onClose).toHaveBeenCalledTimes(1);
  };

  it("trip edit dialog", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripEditDialog open trip={TRIP} onClose={onClose} onUpdated={() => undefined} />,
    );

    await expectSingleNamedClose(onClose);
  });

  it("trip import dialog", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripImportDialog open onClose={onClose} onImported={() => undefined} />,
    );

    await expectSingleNamedClose(onClose);
  });

  it("trip create dialog", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TripCreateDialog open onClose={onClose} />);

    await expectSingleNamedClose(onClose);
  });

  it("travel segment dialog", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripDayTravelSegmentDialog
        open
        tripId="trip-1"
        tripDayId="day-1"
        fromItem={{ id: "item-1", type: "dayPlanItem", label: "Morning", location: null }}
        toItem={{ id: "stay-1", type: "accommodation", label: "Hotel", location: null }}
        segment={null}
        onClose={onClose}
        onSaved={() => undefined}
      />,
    );

    await expectSingleNamedClose(onClose);
  });

  /**
   * The delete confirmation gets the `✕` too (AC3), and it is not raised by one — the trigger is a
   * delete action — so the glyph is an escape rather than a second copy of the question.
   */
  it("trip delete confirmation", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripDeleteDialog open tripName="Portugal Roadtrip" tripId="trip-1" onClose={onClose} onDeleted={() => undefined} />,
    );

    expect(closeControls()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    await userEvent.click(closeControl());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * `TripBucketListPanel` holds **both** kinds — a form and a confirmation, two dialogs in one file —
   * and Story 6.25's Trap 1 is that they must not be treated alike. Both get the glyph; only the
   * confirmation keeps two footer buttons.
   */
  it("bucket list form dialog", async () => {
    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Add item" }));

    expect(await screen.findByRole("heading", { name: "Add bucket list item", level: 2 })).toBeInTheDocument();
    expect(closeControls()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    await userEvent.click(closeControl());
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Add bucket list item", level: 2 })).toBeNull(),
    );
  });
});

/**
 * AC7 on the real dialogs rather than on the harness above. The harness proves the mechanism; these
 * prove each dialog's *dirty signal* — which is the half that can be silently wrong, because a signal
 * stuck on `false` discards typing without asking and a signal stuck on `true` interrogates a form
 * nobody touched. Both directions are asserted for that reason.
 */
describe("each form dialog's own dirty signal (AC7)", () => {
  it("the trip edit dialog closes silently when nothing was typed", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripEditDialog open trip={TRIP} onClose={onClose} onUpdated={() => undefined} />,
    );

    await userEvent.click(closeControl());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  it("the trip edit dialog asks once a field has been typed into", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripEditDialog open trip={TRIP} onClose={onClose} onUpdated={() => undefined} />,
    );

    await userEvent.type(screen.getByLabelText("Trip name"), " 2027");
    await userEvent.click(closeControl());

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("discard-changes-body")).toBeInTheDocument();
  });

  /**
   * The `heroImage` file input, which is the field the browser pass found the defect on.
   *
   * `dirtyFields` cannot record a `FileList` change — it is not a value diff react-hook-form can
   * compute — so both `heroImage` dialogs track the selection with their own flag. Without it a user
   * who picks a photo and then hits the `✕` loses it silently, which is the one field with nothing on
   * the server behind it.
   *
   * **What this case cannot prove**, and the reason the fix needed a browser: `isDirty` on these two
   * forms is `true` from the first render in a real browser, because an empty `FileList` never compares
   * equal to the `undefined` the defaults hold for `heroImage`. jsdom's empty file input *does* compare
   * equal, so the "untouched closes silently" case above passes here either way. The measurement lives
   * in the story record; what is pinned here is that a chosen file counts.
   */
  it("the trip edit dialog asks after a hero image is chosen", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripEditDialog open trip={TRIP} onClose={onClose} onUpdated={() => undefined} />,
    );

    const file = new File(["binary"], "hero.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Hero image (optional)"), file);
    await userEvent.click(closeControl());

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("discard-changes-body")).toBeInTheDocument();
  });

  it("the trip create dialog asks after a hero image is chosen", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TripCreateDialog open onClose={onClose} />);

    const file = new File(["binary"], "hero.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Hero image (optional)"), file);
    await userEvent.click(closeControl());

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("discard-changes-body")).toBeInTheDocument();
  });

  /**
   * The trap this case exists for. `TripAccommodationDialog` runs two normalisation effects that
   * `setValue(..., { shouldDirty: true })` on the payment rows, and a stay that opens with a cost is
   * exactly the state that could trip them. If it does, `isDirty` is `true` before the user has done
   * anything and every dismissal of an untouched stay raises a question about changes that do not
   * exist. That failure is invisible by inspection and obvious here.
   */
  it("the accommodation dialog does not read dirty on an untouched stay with a cost", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripAccommodationDialog
        open
        tripId="trip-1"
        stayType="current"
        day={{
          id: "day-1",
          date: "2026-11-01T00:00:00.000Z",
          dayIndex: 1,
          accommodation: {
            id: "stay-1",
            name: "Harbor Hotel",
            notes: null,
            status: "planned",
            costCents: 12000,
            link: null,
            checkInTime: null,
            checkOutTime: null,
            location: { lat: 41.15, lng: -8.61, label: "Porto" },
          },
        }}
        onClose={onClose}
        onSaved={() => undefined}
      />,
    );

    await screen.findByRole("button", { name: "Close" });
    await userEvent.click(closeControl());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  /**
   * Story 6.25 code review. The case above uses a stay with **no `payments` array**, and that is the
   * one shape where the trap it describes provably cannot spring: `buildDefaultPayments` derives the
   * single row from `costCents`, so the normalisation effect finds the two sides already equal and
   * never writes. A stay whose stored payment *disagrees* with its cost — a deposit against a larger
   * total, which the import path restores verbatim from a backup — made the effect write on the first
   * render after open, and with `shouldDirty: true` that latched `isDirty` before any interaction.
   *
   * This is the fixture that actually exercises it. The effect now marks dirty only once its values
   * have settled, so the first pass is a normalisation of what the form opened with rather than a
   * user edit.
   */
  it("the accommodation dialog does not read dirty when a stored payment disagrees with the cost", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripAccommodationDialog
        open
        tripId="trip-1"
        stayType="current"
        day={{
          id: "day-1",
          date: "2026-11-01T00:00:00.000Z",
          dayIndex: 1,
          accommodation: {
            id: "stay-1",
            name: "Harbor Hotel",
            notes: null,
            status: "planned",
            // 120,00 € stay against a single recorded 60,00 € deposit.
            costCents: 12000,
            payments: [{ amountCents: 6000, dueDate: "2026-10-01" }],
            link: null,
            checkInTime: null,
            checkOutTime: null,
            location: null,
          },
        }}
        onClose={onClose}
        onSaved={() => undefined}
      />,
    );

    await screen.findByRole("button", { name: "Close" });
    await userEvent.click(closeControl());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  /** And the other direction, so the case above cannot pass by the guard simply never firing. */
  it("the accommodation dialog asks once the stay has been edited", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <TripAccommodationDialog
        open
        tripId="trip-1"
        stayType="current"
        day={{
          id: "day-1",
          date: "2026-11-01T00:00:00.000Z",
          dayIndex: 1,
          accommodation: {
            id: "stay-1",
            name: "Harbor Hotel",
            notes: null,
            status: "planned",
            costCents: 12000,
            link: null,
            checkInTime: null,
            checkOutTime: null,
            location: null,
          },
        }}
        onClose={onClose}
        onSaved={() => undefined}
      />,
    );

    await userEvent.type(await screen.findByLabelText("Stay name"), " Annex");
    await userEvent.click(closeControl());

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("discard-changes-body")).toBeInTheDocument();
  });

  /**
   * The travel-segment dialog compares against a snapshot of the values it opened with rather than
   * against react-hook-form, because it is not a react-hook-form dialog. Same two directions.
   */
  it("the travel segment dialog closes silently, then asks once a duration is changed", async () => {
    const onClose = vi.fn();
    const props = {
      open: true as const,
      tripId: "trip-1",
      tripDayId: "day-1",
      fromItem: { id: "item-1", type: "dayPlanItem" as const, label: "Morning", location: null },
      toItem: { id: "stay-1", type: "accommodation" as const, label: "Hotel", location: null },
      segment: null,
      onSaved: () => undefined,
    };

    const { unmount } = renderWithProviders(<TripDayTravelSegmentDialog {...props} onClose={onClose} />);
    await userEvent.click(closeControl());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
    unmount();

    const onCloseAgain = vi.fn();
    renderWithProviders(<TripDayTravelSegmentDialog {...props} onClose={onCloseAgain} />);
    await userEvent.type(screen.getByLabelText("Duration (h)"), "2");
    await userEvent.click(closeControl());

    expect(onCloseAgain).not.toHaveBeenCalled();
    expect(await screen.findByTestId("discard-changes-body")).toBeInTheDocument();
  });

  /*
    The four cases below were added by Story 6.25's code review. The block above pinned four of the
    nine guards, while the story record claimed all nine in both directions — and the two dialogs whose
    guards were unpinned are exactly where the review found the two worst defects. These close the
    bucket-list and import halves of that gap; the move picker and the day-image dialog are pinned in
    `tripDayViewLayout.test.tsx` and `tripDayPlanDialog.test.tsx`, where those surfaces already render.
  */

  it("the bucket list form closes silently when nothing was typed", async () => {
    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Add item" }));
    await screen.findByRole("heading", { name: "Add bucket list item", level: 2 });
    await userEvent.click(closeControl());

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Add bucket list item", level: 2 })).toBeNull(),
    );
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  it("the bucket list form asks once a title has been typed", async () => {
    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Add item" }));
    await userEvent.type(await screen.findByLabelText("Title"), "Hike the Tongariro Crossing");
    await userEvent.click(closeControl());

    expect(await screen.findByTestId("discard-changes-body")).toBeInTheDocument();
    // Not asserted by role: MUI's `Modal` stamps `aria-hidden="true"` on the app root while the
    // discard question is open, so the form behind it is invisible to role queries — the same trap
    // this story's browser pass hit with Playwright's role selectors. "Keep editing" being offered is
    // what proves nothing has been thrown away yet.
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeInTheDocument();
  });

  it("the import dialog closes silently when no backup has been chosen", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TripImportDialog open onClose={onClose} onImported={() => undefined} />);

    await userEvent.click(closeControl());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard changes?")).toBeNull();
  });

  /**
   * A chosen file is the one thing on this dialog the user cannot get back by reopening: the picker
   * starts empty every time.
   */
  it("the import dialog asks once a backup has been chosen", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TripImportDialog open onClose={onClose} onImported={() => undefined} />);

    const backup = new File(["binary"], "trip-backup.zip", { type: "application/zip" });
    await userEvent.upload(screen.getByLabelText("Backup file"), backup);
    await userEvent.click(closeControl());

    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByTestId("discard-changes-body")).toBeInTheDocument();
  });
});

describe("the two destructive confirmations keep both buttons and name the safe one (AC3)", () => {
  it("trip delete reads Keep trip beside Delete trip", () => {
    renderWithProviders(
      <TripDeleteDialog
        open
        tripName="Portugal Roadtrip"
        tripId="trip-1"
        onClose={() => undefined}
        onDeleted={() => undefined}
      />,
    );

    const keep = screen.getByRole("button", { name: "Keep trip" });
    const destroy = screen.getByRole("button", { name: "Delete trip" });
    expect(keep).toBeInTheDocument();
    expect(destroy).toBeInTheDocument();

    /*
      The weight is the other half of AC3 and the reason these two are carved out of AC2: the safe
      answer must not shrink to a corner glyph while the other one is contained and red. Asserted as
      "the destructive half is contained-error and the safe half is not", which is what "keep the
      visual weight as it is" means in classes.
    */
    expect(destroy).toHaveClass("MuiButton-contained");
    expect(destroy).toHaveClass("MuiButton-colorError");
    expect(keep).not.toHaveClass("MuiButton-contained");
    expect(keep).not.toHaveClass("MuiButton-colorError");
  });

  it("bucket list delete reads Keep item beside Delete item", async () => {
    stubBucketListWithOneItem();
    renderWithProviders(<TripBucketListPanel tripId="trip-1" />);

    // The card opens collapsed, so the row's actions have to be revealed before one can be reached.
    await userEvent.click(await screen.findByRole("button", { name: "Expand bucket list" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete item" }));

    expect(await screen.findByRole("heading", { name: "Delete bucket list item?", level: 2 })).toBeInTheDocument();

    // Two buttons, both naming an outcome about the same object in the same noun — "Keep item" beside
    // "Delete item". `getAllBy` for the destructive one: the row's own trash glyph shares its name, and
    // the dialog's is the one inside the dialog.
    const dialog = screen.getByRole("dialog");
    const keep = within(dialog).getByRole("button", { name: "Keep item" });
    const destroy = within(dialog).getByRole("button", { name: "Delete item" });

    expect(destroy).toHaveClass("MuiButton-contained");
    expect(destroy).toHaveClass("MuiButton-colorError");
    expect(keep).not.toHaveClass("MuiButton-contained");
    expect(keep).not.toHaveClass("MuiButton-colorError");

    // And the confirmation carries the `✕` too — it is not raised by one.
    expect(within(dialog).getByTestId("dialog-close")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});

describe("the two dialogs that already had a close control keep exactly one (AC1, recorded exemptions)", () => {
  /**
   * `FullscreenPhotoViewer` (Story 6.12) has no title row at all; its close is already a named 44px
   * control at the top right, in the on-photo chrome DESIGN.md's `icon-button` entry specifies for a
   * glyph sitting on a photo. A second one in the same corner is what Story 6.25's Trap 2 forbids.
   */
  it("the fullscreen photo viewer has one close, and it is its own", () => {
    renderWithProviders(
      <FullscreenPhotoViewer
        open
        images={[{ key: "a", imageUrl: "/uploads/a.jpg", alt: "Photo 1" }]}
        startIndex={0}
        onClose={() => undefined}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Close photo viewer" })).toHaveLength(1);
    // Not the shared glyph: this one is `ON_PHOTO_CHROME`, not `icon-button.close` on a card.
    expect(screen.queryByTestId("dialog-close")).toBeNull();
  });

  /**
   * `TripShareDialog` is the story's second written-down exemption. Its dismissal is already a named
   * 44px control — a footer `Schließen` from Story 7.5 — and its binding mockup
   * (`mockups/trips-list-share-login.html`) draws it there. Moving it into the title row deletes the
   * dialog's footer bar, which is a chrome redesign of one dialog and a second mockup to change;
   * Task 2 explicitly defers that class of work. So: one close control, in the footer, and no second.
   */
  it("the share dialog has one close, in its footer", async () => {
    renderWithProviders(
      <TripShareDialog open tripId="trip-1" tripName="Portugal Roadtrip" onClose={() => undefined} />,
    );

    await waitFor(() => expect(closeControls()).toHaveLength(1));
    expect(screen.queryByTestId("dialog-close")).toBeNull();
  });
});
