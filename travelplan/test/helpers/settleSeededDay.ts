import { prisma } from "@/lib/db/prisma";
import { planDaySchedule, readScheduleInputInTransaction } from "@/lib/repositories/dayScheduleTransaction";
import { timeToMinutes } from "@/lib/trips/daySchedule";
import { legacyScheduleFields } from "@/lib/trips/legacySchedule";

/**
 * Story 13.1. Rows a suite seeds straight through Prisma all take the schema defaults (FIXED, 15 minutes,
 * `sortOrder` 0). This gives a seeded day the schedule fields the migration gives real data
 * (`legacyScheduleFields`, the migration's rule in TS), in creation order, and keeps every row's
 * `updatedAt`, so a suite's day reads like a migrated one: timed rows FIXED with their own duration,
 * untimed ones FLEXIBLE/15 after them, `sortOrder` dense. Unlike the migration, an untimed row keeps
 * `null` times (the "does not fit yet" state every reader handles): a suite seeds a day row by row, and
 * appended times would make a later re-settle read the row as timed. The next write gives it times.
 *
 * `flexible` names rows that become FLEXIBLE, with their seeded span as the duration; the day is then
 * scheduled once with the real rule and the computed times stored, so the seed is a day the app could
 * have written. A row already FLEXIBLE stays FLEXIBLE. Call it after the day's last seed row and leg.
 */
export const settleSeededDay = async (tripDayId: string, options: { flexible?: string[] } = {}) => {
  const flexible = new Set(options.flexible ?? []);
  const rows = await prisma.dayPlanItem.findMany({
    where: { tripDayId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fromTime: true,
      toTime: true,
      scheduleMode: true,
      durationMinutes: true,
      updatedAt: true,
    },
  });
  const fields = legacyScheduleFields(rows);
  for (const [index, row] of rows.entries()) {
    const legacy = fields[index];
    const start = timeToMinutes(row.fromTime);
    const end = timeToMinutes(row.toTime);
    const span = start !== null && end !== null && end > start ? end - start : null;
    const data =
      flexible.has(row.id) || row.scheduleMode === "FLEXIBLE"
        ? {
            scheduleMode: "FLEXIBLE" as const,
            durationMinutes: flexible.has(row.id) ? (span ?? row.durationMinutes) : row.durationMinutes,
            sortOrder: legacy.sortOrder,
          }
        : legacy.scheduleMode === "FLEXIBLE"
          ? { ...legacy, fromTime: null, toTime: null }
          : legacy;
    await prisma.dayPlanItem.update({ where: { id: row.id }, data: { ...data, updatedAt: row.updatedAt } });
  }

  if (flexible.size === 0) return;
  await prisma.$transaction(async (tx) => {
    const day = await tx.tripDay.findUniqueOrThrow({ where: { id: tripDayId }, select: { tripId: true } });
    const state = await readScheduleInputInTransaction(tx, day.tripId, tripDayId);
    if (!state) return;
    // Story 13.2: a seeded day past 23:59 settles like a write: its overflowing rows lose their times.
    const plan = planDaySchedule(state, { kind: "none" });
    for (const change of plan.changes) {
      await tx.dayPlanItem.update({
        where: { id: change.id },
        data: {
          fromTime: change.fromTime,
          toTime: change.toTime,
          sortOrder: change.sortOrder,
          updatedAt: change.previous.updatedAt,
        },
      });
    }
  });
};
