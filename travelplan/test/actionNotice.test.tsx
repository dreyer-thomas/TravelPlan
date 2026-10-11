// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { ActionNotice } from "@/components/ui/ActionNotice";
import { Providers, renderWithProviders } from "./helpers/renderWithProviders";

/**
 * Story 11.1 — `DESIGN.md.Components → action-notice`. A status, not an alert: the save succeeded and the
 * notice reports what it did besides.
 */
describe("ActionNotice", () => {
  it("announces its summary as a status and is not an MUI Alert", () => {
    renderWithProviders(
      <ActionNotice
        summary="1 travel leg removed"
        onClose={() => {}}
        closeLabel="Dismiss notice"
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice.getAttribute("data-testid")).toBe("action-notice");
    expect(notice.textContent).toContain("1 travel leg removed");
    expect(notice.className).not.toMatch(/MuiAlert/);
    expect(document.querySelector(".MuiAlert-root")).toBeNull();
  });

  it("offers a 44px close target with an accessible name", () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ActionNotice
        summary="x"
        onClose={onClose}
        closeLabel="Dismiss notice"
      />,
    );

    const close = screen.getByRole("button", { name: "Dismiss notice" });
    expect(close.getAttribute("data-testid")).toBe("action-notice-close");
    const style = getComputedStyle(close);
    expect(style.width).toBe("44px");
    expect(style.height).toBe("44px");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the warning line only when given one", () => {
    const { rerender } = renderWithProviders(
      <ActionNotice summary="x" onClose={() => {}} closeLabel="Close" />,
    );
    expect(screen.queryByText("Check the times")).toBeNull();

    rerender(
      <Providers>
        <ActionNotice
          summary="x"
          warning="Check the times"
          onClose={() => {}}
          closeLabel="Close"
        />
      </Providers>,
    );
    expect(screen.getByText("Check the times")).toBeTruthy();
  });

  it("renders the action only with a label and a handler, and disables it while pending", () => {
    const onAction = vi.fn();
    const { rerender } = renderWithProviders(
      <ActionNotice summary="x" onClose={() => {}} closeLabel="Close" />,
    );
    expect(screen.queryByTestId("action-notice-undo")).toBeNull();

    rerender(
      <Providers>
        <ActionNotice
          summary="x"
          actionLabel="Undo"
          onAction={onAction}
          onClose={() => {}}
          closeLabel="Close"
        />
      </Providers>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledTimes(1);

    rerender(
      <Providers>
        <ActionNotice
          summary="x"
          actionLabel="Undo"
          onAction={onAction}
          actionPending
          onClose={() => {}}
          closeLabel="Close"
        />
      </Providers>,
    );
    expect(
      (screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
