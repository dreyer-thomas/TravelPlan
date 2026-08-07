// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TripCreateForm from "@/components/features/trips/TripCreateForm";
import { Providers } from "./helpers/renderWithProviders";

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
      <Providers language="en">
        <TripCreateForm />
      </Providers>
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

  it("blocks submit when a location cannot be resolved", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url.includes("/api/auth/csrf")) {
        return {
          ok: true,
          json: async () => mockCsrfResponse,
        } as Response;
      }

      // Story 6.28 turned the route's `result` into a `results` array: one candidate is still adopted
      // directly, and an empty array is where `result: null` used to be.
      if (url.includes("/api/geocode") && url.includes("Start")) {
        return {
          ok: true,
          json: async () => ({ data: { results: [{ lat: 48.14, lng: 11.58, label: "Start City" }] }, error: null }),
        } as Response;
      }

      if (url.includes("/api/geocode") && url.includes("Dest")) {
        return {
          ok: true,
          json: async () => ({ data: { results: [] }, error: null }),
        } as Response;
      }

      if (url.includes("/api/trips") && method === "POST") {
        return {
          ok: true,
          json: async () => mockCreateResponse,
        } as Response;
      }

      return {
        ok: false,
        json: async () => ({ data: null, error: { code: "unknown", message: "Unexpected request" } }),
      } as Response;
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      <Providers language="en">
        <TripCreateForm />
      </Providers>
    );

    await user.type(screen.getByLabelText(/trip name/i), "Geo Trip");
    await user.type(screen.getByLabelText(/start date/i), "2026-02-10");
    await user.type(screen.getByLabelText(/end date/i), "2026-02-12");

    await user.type(screen.getByLabelText(/start location/i), "Start City");
    await user.type(screen.getByLabelText(/destination/i), "Dest City");

    const findButtons = screen.getAllByRole("button", { name: /find/i });
    await user.click(findButtons[0]);
    await user.click(findButtons[1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: /create trip/i }));

    expect(await screen.findByText(/resolve this location/i)).toBeInTheDocument();

    const createCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === "string" ? input : input.toString();
      return url.includes("/api/trips") && init?.method === "POST";
    });
    expect(createCall).toBeUndefined();
  });

  /**
   * Story 6.28. This form is one file but **two** place fields, and the handler is parameterised by
   * `kind` — so every case here exercises the arm the other three surfaces do not have. It is also the
   * only surface with a per-field error channel, which is where its parse failures go rather than to the
   * form-level notice: the message is about one of two boxes and the banner cannot say which.
   */
  describe("story 6.28 — coordinates by hand and a choice of places", () => {
    const geocodeFetch = (results: Array<{ lat: number; lng: number; label: string }>, sentBodies: string[] = []) => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/auth/csrf")) {
          return { ok: true, json: async () => mockCsrfResponse } as Response;
        }
        if (url.includes("/api/geocode")) {
          return { ok: true, json: async () => ({ data: { results }, error: null }) } as Response;
        }
        if (init?.body) sentBodies.push(String(init.body));
        return { ok: true, json: async () => mockCreateResponse } as Response;
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      return fetchMock;
    };

    // The CSRF token is fetched on mount, so the absence of a geocode request is a filtered call list.
    const geocodeCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/geocode"));

    const renderForm = () =>
      render(
        <Providers language="en">
          <TripCreateForm />
        </Providers>,
      );

    // AC1 / AC6, on the `destination` arm as well as `start` — the handler branches on `kind` at every
    // one of its eight state writes, and a copy-paste slip there would set the wrong end of the trip.
    it("resolves a typed coordinate pair on both ends without touching the geocoder", async () => {
      const user = userEvent.setup();
      const fetchMock = geocodeFetch([]);
      renderForm();

      await user.type(screen.getByLabelText(/start location/i), "48.8584, 2.2945");
      await user.type(screen.getByLabelText(/destination/i), "-36.8485, 174.7633");

      const findButtons = screen.getAllByRole("button", { name: /find/i });
      await user.click(findButtons[0]);
      await user.click(findButtons[1]);

      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();
      expect(screen.getByText("Latitude: -36.848500 · Longitude: 174.763300")).toBeInTheDocument();
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC2.
    it("resolves a pasted Google Maps URL without touching the geocoder", async () => {
      const user = userEvent.setup();
      const fetchMock = geocodeFetch([]);
      renderForm();

      await user.click(screen.getByLabelText(/start location/i));
      await user.paste("https://www.google.com/maps/@48.8584,2.2945,17z/data=!3m1!4b1");
      await user.click(screen.getAllByRole("button", { name: /find/i })[0]);

      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC4, in this form's per-field slot rather than the banner, and with nothing set.
    it("faults an out-of-range pair in the field's own error slot", async () => {
      const user = userEvent.setup();
      const fetchMock = geocodeFetch([]);
      renderForm();

      await user.type(screen.getByLabelText(/destination/i), "48.0, 181.0");
      await user.click(screen.getAllByRole("button", { name: /find/i })[1]);

      expect(await screen.findByText("Longitude must be between -180 and 180")).toBeInTheDocument();
      // Both readouts still empty: the destination was refused and the start was never touched.
      expect(screen.getAllByText("No coordinates selected")).toHaveLength(2);
      expect(geocodeCalls(fetchMock)).toHaveLength(0);
    });

    // AC3.
    it("refuses an ambiguous comma pair with the spelling to use instead", async () => {
      const user = userEvent.setup();
      geocodeFetch([]);
      renderForm();

      await user.type(screen.getByLabelText(/start location/i), "48,8584,2,2945");
      await user.click(screen.getAllByRole("button", { name: /find/i })[0]);

      expect(
        await screen.findByText("Coordinates unclear. Write 48.8584, 2.2945 or 48,8584; 2,2945."),
      ).toBeInTheDocument();
      expect(screen.getAllByText("No coordinates selected")).toHaveLength(2);
    });

    // AC5. Nothing is adopted until a row is activated, and then the row's label is what the box and the
    // payload carry.
    it("adopts nothing until a candidate row is activated, then stores that row's label", async () => {
      const sentBodies: string[] = [];
      const user = userEvent.setup();
      geocodeFetch(
        [
          { lat: 48.8584, lng: 2.2945, label: "Paris, France" },
          { lat: 33.6617, lng: -95.5555, label: "Paris, Texas" },
        ],
        sentBodies,
      );
      renderForm();

      await user.type(screen.getByLabelText(/trip name/i), "Geo Trip");
      await user.type(screen.getByLabelText(/start date/i), "2026-02-10");
      await user.type(screen.getByLabelText(/end date/i), "2026-02-12");
      await user.type(screen.getByLabelText(/start location/i), "Paris");
      await user.click(screen.getAllByRole("button", { name: /find/i })[0]);

      expect(await screen.findByText("Select a place (2)")).toBeInTheDocument();
      expect(screen.getAllByText("No coordinates selected")).toHaveLength(2);

      await user.click(screen.getByRole("button", { name: "Paris, Texas" }));

      expect(await screen.findByText("Latitude: 33.661700 · Longitude: -95.555500")).toBeInTheDocument();
      expect(screen.getByLabelText(/start location/i)).toHaveValue("Paris, Texas");
      expect(screen.queryByRole("button", { name: "Paris, France" })).toBeNull();

      // And the pair the payload demands: this form only sends locations when both ends are resolved, so
      // the destination is typed as a pair to close it out and the whole payload is checked at once.
      await user.type(screen.getByLabelText(/destination/i), "48.8584; 2.2945");
      await user.click(screen.getAllByRole("button", { name: /find/i })[1]);
      await user.click(screen.getByRole("button", { name: /create trip/i }));

      await waitFor(() => expect(sentBodies).toHaveLength(1));
      const payload = JSON.parse(sentBodies[0]);
      expect(payload.startLocation).toEqual({ lat: 33.6617, lng: -95.5555, label: "Paris, Texas" });
      expect(payload.destinationLocation).toEqual({ lat: 48.8584, lng: 2.2945, label: "48.858400, 2.294500" });
    });

    /**
     * Story 6.28 review, P2, on both arms. This form's `onChange` already nulls the resolved location on
     * every keystroke — the candidate list is the same state one level up and had been left standing, so
     * the rows kept answering a query the box no longer held. Both fields are checked because the handler
     * branches on `kind` at every state write and a copy-paste slip there is invisible from one arm.
     */
    it("dismisses an unanswered candidate list when either place field is edited", async () => {
      const user = userEvent.setup();
      geocodeFetch([
        { lat: 48.8584, lng: 2.2945, label: "Paris, France" },
        { lat: 33.6617, lng: -95.5555, label: "Paris, Texas" },
      ]);
      renderForm();

      await user.type(screen.getByLabelText(/start location/i), "Paris");
      await user.click(screen.getAllByRole("button", { name: /find/i })[0]);
      expect(await screen.findByRole("button", { name: "Paris, Texas" })).toBeInTheDocument();

      await user.type(screen.getByLabelText(/start location/i), "on");

      expect(screen.queryByRole("button", { name: "Paris, Texas" })).toBeNull();
      expect(screen.queryByText("Select a place (2)")).toBeNull();

      await user.type(screen.getByLabelText(/destination/i), "Paris");
      await user.click(screen.getAllByRole("button", { name: /find/i })[1]);
      expect(await screen.findByRole("button", { name: "Paris, France" })).toBeInTheDocument();

      await user.type(screen.getByLabelText(/destination/i), "on");

      expect(screen.queryByRole("button", { name: "Paris, France" })).toBeNull();
      expect(screen.queryByText("Select a place (2)")).toBeNull();
    });

    // AC8. `Clear` still empties the field and the location after a manual entry.
    it("clears a manually entered pair", async () => {
      const user = userEvent.setup();
      geocodeFetch([]);
      renderForm();

      await user.type(screen.getByLabelText(/start location/i), "48.8584, 2.2945");
      await user.click(screen.getAllByRole("button", { name: /find/i })[0]);
      expect(await screen.findByText("Latitude: 48.858400 · Longitude: 2.294500")).toBeInTheDocument();

      await user.click(screen.getAllByRole("button", { name: /clear/i })[0]);

      expect(screen.getAllByText("No coordinates selected")).toHaveLength(2);
      expect(screen.getByLabelText(/start location/i)).toHaveValue("");
    });
  });
});
