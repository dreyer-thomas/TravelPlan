import { prisma } from "@/lib/db/prisma";

/**
 * Story 14.1. `DayPlanItem.tripId` is required and Prisma cannot default it from the day, so a seed helper
 * that is handed only a day id looks its trip up. Seeds that have the day object in hand pass
 * `day.tripId` directly instead.
 */
export const tripIdOfDay = async (tripDayId: string) =>
  (await prisma.tripDay.findUniqueOrThrow({ where: { id: tripDayId }, select: { tripId: true } })).tripId;
