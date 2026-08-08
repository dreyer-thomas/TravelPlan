// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useOpenInstanceKey } from "@/components/ui/DialogShell";

/**
 * `useOpenInstanceKey` is the whole mechanism behind "a dialog gets a fresh instance per open".
 *
 * Four trip dialogs used to carry a hand-maintained reset-on-open effect — a cluster of `setX` calls
 * clearing everything the previous open had left behind — because their parents mount them once and
 * show them with an `open` prop alone. Three shipped defects came out of that list being incomplete: an
 * unanswered place-candidate list, staged photos and staged documents each leaked from one entity's
 * dialog into the next's. Those clusters are gone, and what replaces them is one number — the parent
 * passes this hook's return value as `key`, so React remounts the dialog on every open and each state
 * simply starts from its `useState` initial value.
 *
 * Which makes the rows below a load-bearing contract rather than incidental behaviour:
 *
 * - **Open edge** — the key must change, or nothing is reset and those defects come back.
 * - **Close edge** — the key must *not* change, or the dialog would unmount the instant it is dismissed
 *   and MUI's exit transition would never play. That is the reason the dialogs are not simply wrapped
 *   in `{open && …}`, and it is the constraint the whole design turns on.
 * - **Steady state** — the key must not change on an unrelated re-render, or a parent state change
 *   would throw away everything the user had typed mid-edit.
 * - **Identity** — an entity swap with no open edge behind it counts as a new instance while open, and
 *   is ignored while closing. `TripDayView`'s deep-link effect is the path that needs the first half;
 *   `handlePlanDialogClose` clearing the selection is the path that needs the second.
 *
 * Asserted through a rendered tree rather than by calling the hook in isolation, because the key's
 * *point* is remounting: what is measured below is a child's own state being re-seeded (open edge) or
 * surviving (the other two), which is exactly what the dialogs rely on.
 */

/**
 * A stand-in for one of the dialogs: it seeds a state from a prop at mount and lets the test dirty it,
 * so "was this remounted?" is answerable without counting anything.
 */
function Seeded({ seed }: { seed: string }) {
  const [value, setValue] = useState(seed);
  return (
    <button type="button" data-testid="seeded" onClick={() => setValue("edited")}>
      {value}
    </button>
  );
}

function Harness({
  open,
  seed,
  unrelated = 0,
  identity,
}: {
  open: boolean;
  seed: string;
  unrelated?: number;
  identity?: string;
}) {
  const instanceKey = useOpenInstanceKey(open, identity);
  return (
    <div>
      <span data-testid="key">{instanceKey}</span>
      <span data-testid="unrelated">{unrelated}</span>
      <Seeded key={instanceKey} seed={seed} />
    </div>
  );
}

const currentKey = () => Number(screen.getByTestId("key").textContent);
const edit = () => fireEvent.click(screen.getByTestId("seeded"));

describe("useOpenInstanceKey", () => {
  it("returns a new key on the open edge, so the child remounts and re-seeds", () => {
    const { rerender } = render(<Harness open={false} seed="stay A" />);
    const closedKey = currentKey();
    edit();
    expect(screen.getByTestId("seeded")).toHaveTextContent("edited");

    rerender(<Harness open seed="stay B" />);

    expect(currentKey()).toBe(closedKey + 1);
    // Nothing of the previous instance survived — the point of the exercise.
    expect(screen.getByTestId("seeded")).toHaveTextContent("stay B");
  });

  /**
   * The one row that holds for a *different* reason than the other three, which is why it is asserted
   * rather than assumed: `useState({ open, key: 0 })` seeds `instance.open` from the prop, so a first
   * render with `open` already true records that open instead of counting it. It is correct because
   * the mount *is* the fresh instance — but seeding state from a prop looks like the props-in-state
   * smell, and "simplifying" the initializer to `{ open: false, key: 0 }` would still pass every other
   * case here while remounting an already-open dialog one render after it appears, throwing away
   * whatever it had just seeded.
   */
  it("does not bump when the first render is already open", () => {
    const { rerender } = render(<Harness open seed="stay A" />);
    const mountedOpenKey = currentKey();
    edit();

    rerender(<Harness open seed="stay A" unrelated={1} />);

    expect(currentKey()).toBe(mountedOpenKey);
    expect(screen.getByTestId("seeded")).toHaveTextContent("edited");
  });

  it("keeps the key across the close edge, so the instance survives to play its exit transition", () => {
    const { rerender } = render(<Harness open seed="stay A" />);
    const openKey = currentKey();
    edit();

    rerender(<Harness open={false} seed="stay A" />);

    expect(currentKey()).toBe(openKey);
    // Still the same instance, still holding its state: it is closing, not gone.
    expect(screen.getByTestId("seeded")).toHaveTextContent("edited");
  });

  it("keeps the key when open is unchanged, so a re-render mid-edit loses nothing", () => {
    const { rerender } = render(<Harness open seed="stay A" />);
    const openKey = currentKey();
    edit();

    rerender(<Harness open seed="stay A" unrelated={1} />);
    rerender(<Harness open seed="stay A" unrelated={2} />);

    expect(currentKey()).toBe(openKey);
    expect(screen.getByTestId("unrelated")).toHaveTextContent("2");
    expect(screen.getByTestId("seeded")).toHaveTextContent("edited");
  });

  /**
   * The `identity` half. `TripDayView`'s deep-link effect can call `setSelectedPlanItem` on a plan
   * dialog that is already open — a client-side navigation to another `?open=plan&itemId=` — so an
   * entity swap with no open edge behind it has to count as a new instance too. Without this the form
   * re-seeds (its effect lists `item`) while the previous activity's tab, staged photos and staged
   * documents stay exactly where they were: the leak this whole mechanism exists to stop, arriving by
   * a different door.
   */
  it("bumps when the identity changes while open, because that is a different entity", () => {
    const { rerender } = render(<Harness open seed="activity A" identity="item-a" />);
    const first = currentKey();
    edit();

    rerender(<Harness open seed="activity B" identity="item-b" />);

    expect(currentKey()).toBe(first + 1);
    expect(screen.getByTestId("seeded")).toHaveTextContent("activity B");
  });

  /**
   * And the reason `identity` is read only while open: every parent clears its selection in the same
   * commit that closes the dialog, so an identity consulted on the close edge would bump the key and
   * tear the closing instance out from under its exit transition — the one thing the design exists to
   * avoid.
   */
  it("ignores an identity that changes on the close edge", () => {
    const { rerender } = render(<Harness open seed="activity A" identity="item-a" />);
    const openKey = currentKey();
    edit();

    rerender(<Harness open={false} seed="activity A" identity="add" />);

    expect(currentKey()).toBe(openKey);
    expect(screen.getByTestId("seeded")).toHaveTextContent("edited");
  });

  /**
   * The gap between those two rules: while the dialog is closed the recorded `identity` goes stale,
   * because the guard that would refresh it is itself gated on `open`. That is fine, and this pins why
   * — the *open edge* writes the current identity along with the new key, so the next open is seeded
   * from what the parent is pointing at now, not from what it pointed at when the last one closed.
   * The failure this rules out is a double bump: an implementation that recorded identity changes while
   * closed as well would come out of this sequence one key ahead, which costs nothing here but means
   * the closing instance was remounted mid-transition on the way through.
   */
  it("records an identity that changed while closed at the next open edge, and bumps only once", () => {
    const { rerender } = render(<Harness open seed="activity A" identity="item-a" />);
    const openKey = currentKey();

    // Closed, then pointed at a different entity while it is still closed — two renders, no open edge.
    rerender(<Harness open={false} seed="activity A" identity="item-a" />);
    rerender(<Harness open={false} seed="activity B" identity="item-b" />);
    expect(currentKey()).toBe(openKey);

    rerender(<Harness open seed="activity B" identity="item-b" />);

    expect(currentKey()).toBe(openKey + 1);
    expect(screen.getByTestId("seeded")).toHaveTextContent("activity B");

    // And the identity really was recorded on the way in: a re-render at the same identity must not
    // read as a swap and bump again.
    rerender(<Harness open seed="activity B" identity="item-b" unrelated={1} />);
    expect(currentKey()).toBe(openKey + 1);
  });

  it("increments once per open, never once per render", () => {
    const { rerender } = render(<Harness open={false} seed="stay A" />);
    const first = currentKey();

    rerender(<Harness open seed="stay A" />);
    const opened = currentKey();
    rerender(<Harness open seed="stay A" unrelated={1} />);
    rerender(<Harness open={false} seed="stay A" unrelated={1} />);
    rerender(<Harness open={false} seed="stay A" unrelated={2} />);
    rerender(<Harness open seed="stay B" unrelated={2} />);

    expect(opened).toBe(first + 1);
    expect(currentKey()).toBe(opened + 1);
  });
});
