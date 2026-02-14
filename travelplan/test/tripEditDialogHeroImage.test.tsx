// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripEditDialog from "@/components/features/trips/TripEditDialog";
import { I18nProvider } from "@/i18n/provider";

const mockCsrfResponse = {
  data: { csrfToken: "test-token" },
  error: null,
};

const mockEditResponse = {
  data: {
    trip: {
      id: "trip-edit-hero",
      name: "Edited Trip",
      startDate: "2026-06-10T00:00:00.000Z",
      endDate: "2026-06-12T00:00:00.000Z",
      dayCount: 3,
      accommodationCostTotalCents: null,
    },
    days: [],
  },
  error: null,
};

const mockHeroUploadResponse = {
  data: {
    trip: {
      id: "trip-edit-hero",
      heroImageUrl: "/uploads/trips/trip-edit-hero/hero.png",
    },
  },
  error: null,
};

describe("TripEditDialog hero image", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          json: async () => mockCsrfResponse,
        } as Response;
      }

      if (url.includes("/api/trips/trip-edit-hero") && method === "PATCH") {
        return {
          ok: true,
          json: async () => mockEditResponse,
        } as Response;
      }

      if (url.includes("/api/trips/trip-edit-hero/hero-image") && method === "POST") {
        return {
          ok: true,
          json: async () => mockHeroUploadResponse,
        } as Response;
      }

      return {
        ok: false,
        json: async () => ({ data: null, error: { code: "unknown", message: "Unexpected request" } }),
      } as Response;
    }) as unknown as typeof fetch;
  });

  it("uploads hero image after saving trip edits", async () => {
    const user = userEvent.setup();
    const handleUpdated = vi.fn();
    const handleClose = vi.fn();
    render(
      <I18nProvider initialLanguage="en">
        <TripEditDialog
          open
          trip={{
            id: "trip-edit-hero",
            name: "Original Trip",
            startDate: "2026-06-10T00:00:00.000Z",
            endDate: "2026-06-12T00:00:00.000Z",
            dayCount: 3,
            accommodationCostTotalCents: null,
          }}
          onClose={handleClose}
          onUpdated={handleUpdated}
        />
      </I18nProvider>
    );

    const dialog = screen.getByRole("dialog");
    const scope = within(dialog);
    const fileInput = scope.getByLabelText(/hero image/i);
    await user.upload(fileInput, new File([new Uint8Array([1, 2, 3])], "hero.png", { type: "image/png" }));

    await user.click(scope.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(handleUpdated).toHaveBeenCalled();
    });

    const heroCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, init]) => {
      const url = typeof input === "string" ? input : input.toString();
      return url.includes("/api/trips/trip-edit-hero/hero-image") && init?.method === "POST";
    });

    expect(heroCall).toBeDefined();
  });

  it("handles non-json upload responses without crashing", async () => {
    const user = userEvent.setup();
    const handleUpdated = vi.fn();
    const handleClose = vi.fn();

    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.includes("/api/auth/csrf")) {
        return { ok: true, json: async () => mockCsrfResponse } as Response;
      }
      if (url.includes("/api/trips/trip-edit-hero") && method === "PATCH") {
        return { ok: true, json: async () => mockEditResponse } as Response;
      }
      if (url.includes("/api/trips/trip-edit-hero/hero-image") && method === "POST") {
        return {
          ok: false,
          json: async () => {
            throw new SyntaxError("Unexpected token < in JSON");
          },
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({ data: null, error: { code: "unknown", message: "Unexpected request" } }),
      } as Response;
    });

    render(
      <I18nProvider initialLanguage="en">
        <TripEditDialog
          open
          trip={{
            id: "trip-edit-hero",
            name: "Original Trip",
            startDate: "2026-06-10T00:00:00.000Z",
            endDate: "2026-06-12T00:00:00.000Z",
            dayCount: 3,
            accommodationCostTotalCents: null,
          }}
          onClose={handleClose}
          onUpdated={handleUpdated}
        />
      </I18nProvider>
    );

    const dialog = screen.getByRole("dialog");
    const scope = within(dialog);
    await user.upload(scope.getByLabelText(/hero image/i), new File([new Uint8Array([1, 2, 3])], "hero.png", { type: "image/png" }));
    await user.click(scope.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(handleUpdated).toHaveBeenCalled());
    expect(handleClose).not.toHaveBeenCalled();
    expect(screen.getByText(/hero image upload failed/i)).toBeInTheDocument();
  });
});
