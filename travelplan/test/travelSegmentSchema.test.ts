import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";

describe("travel_segments schema", () => {
  it("creates the travel_segments table with expected columns", async () => {
    const columns = await prisma.$queryRawUnsafe<{ name: string }[]>(
      "PRAGMA table_info('travel_segments')",
    );

    expect(columns.length).toBeGreaterThan(0);
    const names = columns.map((column) => column.name);
    expect(names).toEqual([
      "id",
      "trip_day_id",
      "from_item_type",
      "from_item_id",
      "to_item_type",
      "to_item_id",
      "transport_type",
      "duration_minutes",
      "distance_km",
      "link_url",
      "created_at",
      "updated_at",
    ]);
  });
});
