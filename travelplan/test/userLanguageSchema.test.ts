import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type SqliteTableInfo = {
  name: string;
  dflt_value: string | null;
};

describe("User preferred language schema", () => {
  it("defines preferred_language with default en", async () => {
    const columns = (await prisma.$queryRaw`PRAGMA table_info(users)` ) as SqliteTableInfo[];
    const preferred = columns.find((column) => column.name === "preferred_language");

    expect(preferred).toBeDefined();
    expect(preferred?.dflt_value).toBe("'en'");
  });
});
