// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripImportDialog from "@/components/features/trips/TripImportDialog";
import { I18nProvider } from "@/i18n/provider";

describe("TripImportDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handles conflict by allowing create-new retry", async () => {
    const onImported = vi.fn();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          data: null,
          error: {
            code: "trip_name_conflict",
            message: "Conflict",
            details: {
              conflicts: [{ id: "trip-existing", name: "Imported Route Trip" }],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: { id: "trip-new", name: "Imported Route Trip" },
            dayCount: 1,
            mode: "createNew",
          },
          error: null,
        }),
      }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripImportDialog
          open
          tripId="trip-1"
          onClose={() => undefined}
          onImported={onImported}
        />
      </I18nProvider>
    );

    const fileInput = screen.getByLabelText("JSON file") as HTMLInputElement;
    const file = new File(
      [
        JSON.stringify({
          meta: {
            exportedAt: "2026-02-14T12:00:00.000Z",
            appVersion: "0.1.0",
            formatVersion: 1,
          },
          trip: {
            id: "export-trip-1",
            name: "Imported Route Trip",
            startDate: "2026-11-01T00:00:00.000Z",
            endDate: "2026-11-02T00:00:00.000Z",
            heroImageUrl: null,
            createdAt: "2026-02-14T12:00:00.000Z",
            updatedAt: "2026-02-14T12:00:00.000Z",
          },
          days: [
            {
              id: "export-day-1",
              date: "2026-11-01T00:00:00.000Z",
              dayIndex: 1,
              createdAt: "2026-02-14T12:00:00.000Z",
              updatedAt: "2026-02-14T12:00:00.000Z",
              accommodation: null,
              dayPlanItems: [],
            },
          ],
        }),
      ],
      "backup.json",
      { type: "application/json" }
    );

    await userEvent.upload(fileInput, file);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import JSON" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Import JSON" }));

    expect(await screen.findByText("Trip with this name already exists.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create new trip" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/trips/import",
        expect.objectContaining({ method: "POST" })
      )
    );
  });

  it("allows selecting which conflicting trip to overwrite", async () => {
    const onImported = vi.fn();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          data: null,
          error: {
            code: "trip_name_conflict",
            message: "Conflict",
            details: {
              conflicts: [
                { id: "trip-existing-1", name: "Imported Route Trip (old)" },
                { id: "trip-existing-2", name: "Imported Route Trip (newer)" },
              ],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            trip: { id: "trip-existing-2", name: "Imported Route Trip" },
            dayCount: 1,
            mode: "overwrite",
          },
          error: null,
        }),
      }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider initialLanguage="en">
        <TripImportDialog
          open
          tripId="trip-1"
          onClose={() => undefined}
          onImported={onImported}
        />
      </I18nProvider>
    );

    const fileInput = screen.getByLabelText("JSON file") as HTMLInputElement;
    const file = new File(
      [
        JSON.stringify({
          meta: {
            exportedAt: "2026-02-14T12:00:00.000Z",
            appVersion: "0.1.0",
            formatVersion: 1,
          },
          trip: {
            id: "export-trip-1",
            name: "Imported Route Trip",
            startDate: "2026-11-01T00:00:00.000Z",
            endDate: "2026-11-02T00:00:00.000Z",
            heroImageUrl: null,
            createdAt: "2026-02-14T12:00:00.000Z",
            updatedAt: "2026-02-14T12:00:00.000Z",
          },
          days: [
            {
              id: "export-day-1",
              date: "2026-11-01T00:00:00.000Z",
              dayIndex: 1,
              createdAt: "2026-02-14T12:00:00.000Z",
              updatedAt: "2026-02-14T12:00:00.000Z",
              accommodation: null,
              dayPlanItems: [],
            },
          ],
        }),
      ],
      "backup.json",
      { type: "application/json" }
    );

    await userEvent.upload(fileInput, file);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import JSON" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Import JSON" }));

    const targetSelect = await screen.findByLabelText("Trip to overwrite");
    await userEvent.selectOptions(targetSelect, "trip-existing-2");
    await userEvent.click(screen.getByRole("button", { name: "Overwrite existing trip" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    const overwriteCall = fetchMock.mock.calls[2];
    const parsedBody = JSON.parse((overwriteCall?.[1] as { body?: string }).body ?? "{}") as {
      targetTripId?: string;
      strategy?: string;
    };
    expect(parsedBody.strategy).toBe("overwrite");
    expect(parsedBody.targetTripId).toBe("trip-existing-2");
  });
});
