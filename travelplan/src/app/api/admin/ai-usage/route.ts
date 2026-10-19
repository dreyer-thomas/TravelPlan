import type { NextRequest } from "next/server";
import { apiError } from "@/lib/errors/apiError";
import { fail, ok } from "@/lib/http/response";
import { requireAdmin } from "@/lib/auth/adminAccess";
import { getModelPrice } from "@/lib/ai/config";
import { currentMonthKey, monthRange, monthsBetween, summarizeAiUsage } from "@/lib/ai/usageSummary";
import { getEarliestAiUsageAt, listAiUsageForRange } from "@/lib/repositories/aiUsageRepo";
import { buildAdminAiUsageQuerySchema } from "@/lib/validation/adminAiUsageSchemas";

export const runtime = "nodejs";

/**
 * Story 8.7. What the AI day searches cost, one server-local month at a time.
 *
 * `requireAdmin` first, like every `/api/admin/*` route: the proxy does not cover this path and the menu
 * row's absence is not a guard. No CSRF on the `GET`, matching `admin/users`. `no-store`, because the body
 * names accounts by email.
 *
 * `months` runs from the month of the earliest record to the current one, newest first, so the picker
 * offers exactly the months that can hold data. The cost is computed here from the stored counts and the
 * price table - an estimate; the Anthropic console is the bill.
 */
export const GET = async (request: NextRequest) => {
  const auth = await requireAdmin(request);
  if (auth.response) {
    return auth.response;
  }

  const current = currentMonthKey(new Date());
  const parsed = buildAdminAiUsageQuerySchema(current).safeParse({
    month: request.nextUrl.searchParams.get("month") ?? undefined,
  });
  if (!parsed.success) {
    return fail(apiError("validation_error", "Invalid month", parsed.error.flatten()), 400);
  }
  const month = parsed.data.month ?? current;

  try {
    const { from, to } = monthRange(month);
    const [rows, earliest] = await Promise.all([listAiUsageForRange(from, to), getEarliestAiUsageAt()]);
    // The asked month is always offered, even one before the earliest record, and so is the current one
    // when the earliest record is dated after it (a clock set back): the picker never holds a value it
    // does not list. Zero-padded keys compare as strings.
    const lowest = [earliest ? currentMonthKey(earliest) : current, month, current].sort()[0];
    const months = monthsBetween(lowest, current);
    return ok(
      { month, months, summary: summarizeAiUsage(rows, getModelPrice) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("admin/ai-usage GET: unable to load usage", error);
    return fail(apiError("server_error", "Unable to load AI usage"), 500);
  }
};
