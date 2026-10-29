import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { costDeps, ECB_UNAVAILABLE, resolveCost } from "@/lib/mcp/costInput";
import { ExchangeRateError } from "@/lib/rates/exchangeRateService";
import { cleanOAuthTables, setupConnectorEnvironment } from "./helpers/oauthFixtures";
import { callTool } from "./helpers/mcpClient";
import {
  errorText,
  setupConnectorTrip,
  storedReceipt,
  structured,
  stubNetworkSeams,
} from "./helpers/connectorWriteFixtures";

/**
 * Story 15.6. Costs and links through the connector: EUR or an ECB currency converted on the server at the
 * ECB rate (`costDeps.rates` stubbed, so no test reaches the ECB), payment schedules, and the refusals that
 * write nothing.
 */

setupConnectorEnvironment();

beforeEach(async () => {
  await cleanOAuthTables();
  await prisma.aiChange.deleteMany();
  await prisma.trip.deleteMany();
  stubNetworkSeams();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Activity = {
  id: string;
  title: string | null;
  link: string | null;
  cost: { eurCents: number; original: { amountMinor: number; currency: string; rate: number; rateDate: string } | null } | null;
  payments: { amountEurCents: number; dueDate: string; amountOriginalMinor?: number }[];
  updatedAt: string;
  aiChangedAt: string | null;
};
type WriteResult = { aiChangeId: string; activity: Activity | null };

const stubRates = (rates: Record<string, number> = { USD: 1.08, CZK: 25 }) =>
  vi.spyOn(costDeps, "rates").mockResolvedValue({ date: "2027-04-30", rates });

describe("resolveCost", () => {
  it("stores EUR as cents with one payment on the entry's day, and clears everything for null", async () => {
    expect(await resolveCost({ amount: 12.5 }, { dueDateDefault: "2027-05-02" })).toEqual({
      fields: {
        costCents: 1250,
        costOriginalAmount: null,
        costCurrency: null,
        costRate: null,
        costRateDate: null,
        payments: [{ amountCents: 1250, dueDate: "2027-05-02", amountOriginal: null }],
      },
    });
    expect(await resolveCost(null, { dueDateDefault: null })).toEqual({
      fields: { costCents: null, costOriginalAmount: null, costCurrency: null, costRate: null, costRateDate: null, payments: [] },
    });
  });

  it("asks a bucket-list cost for its payments, and refuses a foreign zero", async () => {
    expect(await resolveCost({ amount: 10 }, { dueDateDefault: null })).toHaveProperty("refusal");
    stubRates();
    expect(await resolveCost({ amount: 0, currency: "USD" }, { dueDateDefault: "2027-05-02" })).toHaveProperty("refusal");
  });

  it("answers the ECB refusal when the rates are unavailable or lack the currency", async () => {
    vi.spyOn(costDeps, "rates").mockRejectedValue(new ExchangeRateError("rates_unavailable", "down"));
    expect(await resolveCost({ amount: 10, currency: "USD" }, { dueDateDefault: "2027-05-02" })).toEqual({
      refusal: ECB_UNAVAILABLE,
    });
    stubRates({ CZK: 25 });
    expect(await resolveCost({ amount: 10, currency: "USD" }, { dueDateDefault: "2027-05-02" })).toEqual({
      refusal: ECB_UNAVAILABLE,
    });
  });
});

describe("resolveCost: conversion refusals (review)", () => {
  it("refuses a split whose cents cannot reconcile, a cost under one cent and one over 1,000,000 EUR", async () => {
    stubRates({ USD: 0.6, JPY: 160 });
    const tinyPayments = Array.from({ length: 20 }, () => ({ amount: 0.01, dueDate: "2027-05-01" }));
    expect(await resolveCost({ amount: 0.2, currency: "USD", payments: tinyPayments }, { dueDateDefault: null })).toEqual({
      refusal: "The payments cannot be converted to whole euro cents; use fewer or larger payments.",
    });
    expect(await resolveCost({ amount: 0.01, currency: "JPY" }, { dueDateDefault: "2027-05-01" })).toEqual({
      refusal: "The amount is less than one euro cent at today's ECB rate.",
    });
    expect(await resolveCost({ amount: 1_000_000, currency: "USD" }, { dueDateDefault: "2027-05-01" })).toEqual({
      refusal: "The cost converts to more than 1,000,000 EUR.",
    });
  });
});

describe.each(["owner", "contributor"] as const)("cost and link as %s", (role) => {
  it("converts a USD cost with two payments at the ECB rate, as the dialog would store it", async () => {
    const setup = await setupConnectorTrip();
    const { seed } = setup;
    const { token } = setup[role];
    const tripId = seed.trip.id;
    stubRates();
    const museum = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } });

    const result = structured<WriteResult>(
      await callTool(token, "update_activity", {
        tripId,
        activityId: museum.id,
        updatedAt: museum.updatedAt.toISOString(),
        cost: {
          amount: 100,
          currency: "USD",
          payments: [
            { amount: 40, dueDate: "2027-04-01" },
            { amount: 60, dueDate: "2027-05-02" },
          ],
        },
      }),
    );
    expect(result.activity).toMatchObject({
      cost: { eurCents: 9259, original: { amountMinor: 10000, currency: "USD", rate: 1.08, rateDate: "2027-04-30" } },
      payments: [
        { amountEurCents: 3704, dueDate: "2027-04-01", amountOriginalMinor: 4000 },
        { amountEurCents: 5555, dueDate: "2027-05-02", amountOriginalMinor: 6000 },
      ],
      // The link stays as stored.
      link: "https://museum.example",
    });
    expect(result.activity?.aiChangedAt).not.toBeNull();
    const stored = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: museum.id }, include: { payments: true } });
    expect(stored).toMatchObject({ costCents: 9259, costOriginalAmount: 10000, costCurrency: "USD", costRate: 1.08, costRateDate: "2027-04-30" });
    expect((await storedReceipt(result.aiChangeId)).edited.kind).toBe("updated");
  });

  it("creates a day activity with a link and an EUR cost due on the day, then clears both with null", async () => {
    const setup = await setupConnectorTrip();
    const { seed } = setup;
    const { token } = setup[role];
    const tripId = seed.trip.id;

    const created = structured<WriteResult>(
      await callTool(token, "create_activity", {
        tripId,
        dayId: seed.day3.id,
        title: "Boat",
        link: "https://boat.example",
        cost: { amount: 24.9 },
      }),
    );
    expect(created.activity).toMatchObject({
      link: "https://boat.example",
      cost: { eurCents: 2490, original: null },
      payments: [{ amountEurCents: 2490, dueDate: "2027-05-03" }],
    });

    const cleared = structured<WriteResult>(
      await callTool(token, "update_activity", {
        tripId,
        activityId: created.activity!.id,
        updatedAt: created.activity!.updatedAt,
        link: null,
        cost: null,
      }),
    );
    expect(cleared.activity).toMatchObject({ link: null, cost: null, payments: [] });
    expect(await prisma.costPayment.count({ where: { dayPlanItemId: created.activity!.id } })).toBe(0);
  });

  it("gives a bucket-list activity a cost only with its payments", async () => {
    const setup = await setupConnectorTrip();
    const { seed } = setup;
    const { token } = setup[role];
    const tripId = seed.trip.id;
    stubRates();

    expect(errorText(await callTool(token, "create_activity", { tripId, title: "Zoo tickets", cost: { amount: 30 } }))).toContain(
      "give cost.payments",
    );
    const created = structured<WriteResult>(
      await callTool(token, "create_activity", {
        tripId,
        title: "Zoo tickets",
        cost: { amount: 500, currency: "CZK", payments: [{ amount: 500, dueDate: "2027-05-01" }] },
      }),
    );
    expect(created.activity).toMatchObject({
      cost: { eurCents: 2000, original: { amountMinor: 50000, currency: "CZK", rate: 25 } },
      payments: [{ amountEurCents: 2000, dueDate: "2027-05-01", amountOriginalMinor: 50000 }],
    });
  });
});

describe("cost refusals", () => {
  it("writes nothing when the ECB is down, and records no change", async () => {
    const { seed, owner } = await setupConnectorTrip();
    vi.spyOn(costDeps, "rates").mockRejectedValue(new ExchangeRateError("rates_unavailable", "down"));
    const before = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id }, include: { payments: true } });

    expect(
      errorText(
        await callTool(owner.token, "update_activity", {
          tripId: seed.trip.id,
          activityId: seed.museum.id,
          updatedAt: before.updatedAt.toISOString(),
          cost: { amount: 100, currency: "USD" },
        }),
      ),
    ).toBe(ECB_UNAVAILABLE);
    expect(await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id }, include: { payments: true } })).toEqual(before);
    expect(await prisma.aiChange.count()).toBe(0);
  });

  it("refuses an unknown currency (listing the accepted ones), payments that do not add up, and a bad link", async () => {
    const { seed, owner } = await setupConnectorTrip();
    const museum = await prisma.dayPlanItem.findUniqueOrThrow({ where: { id: seed.museum.id } });
    const update = (fields: Record<string, unknown>) =>
      callTool(owner.token, "update_activity", {
        tripId: seed.trip.id,
        activityId: museum.id,
        updatedAt: museum.updatedAt.toISOString(),
        ...fields,
      });

    const currency = errorText(await update({ cost: { amount: 10, currency: "XYZ" } }));
    expect(currency).toContain("EUR, USD, JPY");
    expect(
      errorText(
        await update({
          cost: {
            amount: 10,
            payments: [
              { amount: 4, dueDate: "2027-04-01" },
              { amount: 5, dueDate: "2027-05-01" },
            ],
          },
        }),
      ),
    ).toContain("cost.payments must add up exactly to cost.amount");
    expect(errorText(await update({ cost: { amount: 10.005 } }))).toContain("at most two decimals");
    expect(errorText(await update({ link: "javascript:alert(1)" }))).toContain("Link must");
    expect(await prisma.aiChange.count()).toBe(0);
  });
});
