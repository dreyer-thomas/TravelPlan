// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripImportDialog from "@/components/features/trips/TripImportDialog";
import { renderWithProviders } from "./helpers/renderWithProviders";

const MANIFEST = {
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
};

/** The package is a binary container the browser cannot open, so the bytes here are only ballast. */
const backupFile = (name = "backup.zip", type = "application/zip") =>
  new File([JSON.stringify(MANIFEST)], name, { type });

const csrfResponse = {
  ok: true,
  status: 200,
  json: async () => ({ data: { csrfToken: "csrf-token" }, error: null }),
};

const conflictResponse = (conflicts: { id: string; name: string }[]) => ({
  ok: false,
  status: 409,
  json: async () => ({
    data: null,
    error: {
      code: "trip_name_conflict",
      message: "Conflict",
      details: { conflicts },
    },
  }),
});

const successResponse = (data: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  json: async () => ({ data, error: null }),
});

const importedTrip = (mode: "createNew" | "overwrite", id: string) => ({
  trip: {
    id,
    name: "Imported Route Trip",
    startDate: "2026-11-01T00:00:00.000Z",
    endDate: "2026-11-02T00:00:00.000Z",
    heroImageUrl: null,
  },
  dayCount: 2,
  mode,
  travelSegmentCount: 3,
  bucketListItemCount: 4,
  photoCount: 5,
});

const bodyOf = (call: unknown[] | undefined) => (call?.[1] as { body?: unknown } | undefined)?.body;

describe("TripImportDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderDialog = (onImported = vi.fn(), onClose = vi.fn()) => {
    renderWithProviders(<TripImportDialog open onClose={onClose} onImported={onImported} />);
    return { onImported, onClose };
  };

  const selectBackup = async (file = backupFile()) => {
    const fileInput = screen.getByLabelText("Backup file") as HTMLInputElement;
    await userEvent.upload(fileInput, file);
    return fileInput;
  };

  it("accepts a zip package and posts it as multipart form data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse)
      .mockResolvedValueOnce(successResponse(importedTrip("createNew", "trip-new"))) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { onImported } = renderDialog();

    const fileInput = await selectBackup();
    // The client can no longer judge a package - a ZIP is not parseable here - so both containers
    // are offered and validity is only "a file is selected".
    expect(fileInput).toHaveAttribute("accept", "application/zip,.zip,application/json,.json");

    await waitFor(() => expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Start import" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));

    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      { body: FormData; headers: Record<string, string> },
    ];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body.get("file") as File).name).toBe("backup.zip");
    // No strategy on a first attempt, and no `Content-Type`: only the browser knows the boundary.
    expect(init.body.get("strategy")).toBeNull();
    expect(init.body.get("targetTripId")).toBeNull();
    expect(init.headers["x-csrf-token"]).toBe("csrf-token");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });

  it("shows the restored counts and keeps the dialog open until the user closes it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse)
      .mockResolvedValueOnce(successResponse(importedTrip("createNew", "trip-new"))) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const onClose = vi.fn();
    const { onImported } = renderDialog(vi.fn(), onClose);

    await selectBackup();
    await userEvent.click(screen.getByRole("button", { name: "Start import" }));

    const summary = await screen.findByTestId("trip-import-summary");
    expect(summary).toHaveTextContent("Imported “Imported Route Trip” as a new trip.");
    // The whole point of the story: the user can see the media came across.
    expect(summary).toHaveTextContent("Days");
    expect(summary).toHaveTextContent("2");
    expect(summary).toHaveTextContent("Photos");
    expect(summary).toHaveTextContent("5");
    expect(summary).toHaveTextContent("Travel segments");
    expect(summary).toHaveTextContent("3");
    expect(summary).toHaveTextContent("Bucket list");
    expect(summary).toHaveTextContent("4");

    expect(onImported).toHaveBeenCalledTimes(1);
    // Success no longer closes the dialog by itself, or the counts would never be readable.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Start import" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles conflict by allowing create-new retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse)
      .mockResolvedValueOnce(conflictResponse([{ id: "trip-existing", name: "Imported Route Trip" }]))
      .mockResolvedValueOnce(successResponse(importedTrip("createNew", "trip-new"))) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { onImported } = renderDialog();

    await selectBackup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Start import" }));

    expect(await screen.findByText("Trip with this name already exists.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create new trip" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));

    const retryBody = bodyOf((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[2]) as FormData;
    expect(retryBody).toBeInstanceOf(FormData);
    expect(retryBody.get("strategy")).toBe("createNew");
    // `createNew` must not carry a target, or the server would be asked to overwrite.
    expect(retryBody.get("targetTripId")).toBeNull();
  });

  it("allows selecting which conflicting trip to overwrite", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse)
      .mockResolvedValueOnce(
        conflictResponse([
          { id: "trip-existing-1", name: "Imported Route Trip (old)" },
          { id: "trip-existing-2", name: "Imported Route Trip (newer)" },
        ]),
      )
      .mockResolvedValueOnce(successResponse(importedTrip("overwrite", "trip-existing-2"))) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { onImported } = renderDialog();

    await selectBackup();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start import" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Start import" }));

    const targetSelect = await screen.findByLabelText("Trip to overwrite");
    await userEvent.selectOptions(targetSelect, "trip-existing-2");
    await userEvent.click(screen.getByRole("button", { name: "Overwrite existing trip" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));

    const overwriteBody = bodyOf((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[2]) as FormData;
    expect(overwriteBody.get("strategy")).toBe("overwrite");
    // The target can only ever be a trip the server itself reported as a conflict; there is no
    // ambient trip on the trips list to fall back to, and the `tripId` prop that used to supply one
    // is gone.
    expect(overwriteBody.get("targetTripId")).toBe("trip-existing-2");

    expect(await screen.findByTestId("trip-import-summary")).toHaveTextContent(
      "Replaced the existing trip “Imported Route Trip”.",
    );
  });

  it("prints the diagnostics the server collected instead of one generic sentence", async () => {
    const issues = [
      "Photo p1 references archive member photos/p1.jpg, which is not in the package",
      "Archive member photos/stowaway.png is not registered in the photo pool",
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          data: null,
          error: { code: "validation_error", message: "Invalid backup photos", details: { issues } },
        }),
      }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();
    await selectBackup();
    await userEvent.click(screen.getByRole("button", { name: "Start import" }));

    // The route collects every problem so a user fixing a package sees them at once; the dialog
    // used to throw all of it away and say only "this backup could not be read".
    expect(await screen.findByText("This backup could not be read. It may be incomplete or damaged.")).toBeInTheDocument();
    const details = await screen.findByTestId("trip-import-issues");
    expect(details).toHaveTextContent("What the server found");
    expect(details).toHaveTextContent(issues[0]);
    expect(details).toHaveTextContent(issues[1]);
  });

  it("caps how many diagnostics it prints and says how many are left", async () => {
    const issues = Array.from({ length: 14 }, (_, index) => `Photo p${index} is empty`);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          data: null,
          error: { code: "validation_error", message: "Invalid backup photos", details: { issues } },
        }),
      }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();
    await selectBackup();
    await userEvent.click(screen.getByRole("button", { name: "Start import" }));

    const details = await screen.findByTestId("trip-import-issues");
    expect(details).toHaveTextContent("Photo p9 is empty");
    expect(details).not.toHaveTextContent("Photo p10 is empty");
    expect(details).toHaveTextContent("and 4 more");
  });

  it("shows what the export itself had already dropped", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse)
      .mockResolvedValueOnce(
        successResponse({
          ...importedTrip("createNew", "trip-new"),
          warnings: ["Skipped image whose file is missing on disk: /uploads/trips/old/hero.jpg"],
        }),
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();
    await selectBackup();
    await userEvent.click(screen.getByRole("button", { name: "Start import" }));

    // Import succeeded, but with a lower photo count than the original trip had. Without this the
    // loss is invisible.
    const warnings = await screen.findByTestId("trip-import-warnings");
    expect(warnings).toHaveTextContent("Missing from this backup");
    expect(warnings).toHaveTextContent("Skipped image whose file is missing on disk");
  });

  it("keeps the conflict choices when a 409 carries no conflict list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse)
      .mockResolvedValueOnce(conflictResponse([{ id: "trip-existing", name: "Imported Route Trip" }]))
      // `target_trip_not_conflict` answers 409 with no details at all.
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          data: null,
          error: { code: "trip_name_conflict", message: "Target trip must be selected from name conflicts" },
        }),
      }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();
    await selectBackup();
    await userEvent.click(screen.getByRole("button", { name: "Start import" }));

    expect(await screen.findByLabelText("Trip to overwrite")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Overwrite existing trip" }));

    expect(
      await screen.findByText("That trip can no longer be overwritten. Pick another one or create a new trip."),
    ).toBeInTheDocument();
    // The list the server sent a moment ago is still right - only the chosen target is not. Wiping
    // it took the strategy buttons off screen and left closing the dialog as the only way out.
    expect(screen.getByLabelText("Trip to overwrite")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new trip" })).toBeInTheDocument();
  });

  it("tells the user the upload failed when the multipart body did not parse", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          data: null,
          error: { code: "invalid_form_data", message: "Request body must be valid form data" },
        }),
      }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();
    await selectBackup();
    await userEvent.click(screen.getByRole("button", { name: "Start import" }));

    // Not "trip import failed, please try again" - the file is probably fine, the upload was not.
    expect(
      await screen.findByText("The upload did not arrive complete. Please try sending the file again."),
    ).toBeInTheDocument();
  });

  it("rejects a package over the route's size cap without uploading it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(csrfResponse) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderDialog();

    const oversize = backupFile("huge.zip");
    Object.defineProperty(oversize, "size", { value: 101 * 1024 * 1024 });
    await selectBackup(oversize);

    expect(await screen.findByText("Backup file is larger than 100 MB.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start import" })).toBeDisabled();
    // Only the CSRF fetch: the file never went to the route.
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
