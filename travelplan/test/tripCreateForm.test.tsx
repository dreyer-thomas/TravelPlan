// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripCreateForm from "@/components/features/trips/TripCreateForm";
import { I18nProvider } from "@/i18n/provider";

const mockCsrfResponse = {
  data: { csrfToken: "test-token" },
  error: null,
};

const mockCreateResponse = {
  data: {
    trip: {
      id: "trip-hero-123",
      name: "Hero Trip",
      startDate: "2026-02-10T00:00:00.000Z",
      endDate: "2026-02-12T00:00:00.000Z",
    },
    dayCount: 3,
  },
  error: null,
};

const mockHeroUploadResponse = {
  data: {
    trip: {
      id: "trip-hero-123",
      heroImageUrl: "/uploads/trips/trip-hero-123/hero.webp",
    },
  },
  error: null,
};

describe("TripCreateForm", () => {
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

      if (url.includes("/api/trips") && method === "POST" && !url.includes("hero-image")) {
        return {
          ok: true,
          json: async () => mockCreateResponse,
        } as Response;
      }

      if (url.includes("/api/trips/trip-hero-123/hero-image") && method === "POST") {
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

  it("uploads the hero image after trip creation when a file is selected", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLanguage="en">
        <TripCreateForm />
      </I18nProvider>
    );

    await user.type(screen.getByLabelText(/trip name/i), "Hero Trip");
    await user.type(screen.getByLabelText(/start date/i), "2026-02-10");
    await user.type(screen.getByLabelText(/end date/i), "2026-02-12");

    const file = new File([new Uint8Array([1, 2, 3])], "hero.webp", { type: "image/webp" });
    const fileInput = screen.getByLabelText(/hero image/i);
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: /create trip/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const heroCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, init]) => {
      const url = typeof input === "string" ? input : input.toString();
      return url.includes("/api/trips/trip-hero-123/hero-image") && init?.method === "POST";
    });

    expect(heroCall).toBeDefined();
    const [, init] = heroCall as [RequestInfo, RequestInit];
    expect(init?.body).toBeInstanceOf(FormData);
    const formData = init?.body as FormData;
    expect(formData.get("file")).toBeInstanceOf(File);
  });
});
