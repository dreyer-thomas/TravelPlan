import { z } from "zod";

export const dayRouteParamsSchema = z.object({
  id: z.string().trim().min(1, "Trip id is required"),
  dayId: z.string().trim().min(1, "Trip day id is required"),
});

export type DayRouteParamsInput = z.infer<typeof dayRouteParamsSchema>;
