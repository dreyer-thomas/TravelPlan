import { z } from "zod";

const targetTypeSchema = z.enum(["trip", "tripDay", "accommodation", "dayPlanItem"]);

export const tripFeedbackCommentSchema = z.object({
  targetType: targetTypeSchema,
  targetId: z.string().trim().min(1),
  tripDayId: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).max(1000),
});

export const tripFeedbackCommentEditSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

export const tripFeedbackVoteSchema = z.object({
  targetType: targetTypeSchema,
  targetId: z.string().trim().min(1),
  tripDayId: z.string().trim().min(1).optional(),
  value: z.enum(["up", "down"]),
});

export type TripFeedbackCommentInput = z.infer<typeof tripFeedbackCommentSchema>;
export type TripFeedbackCommentEditInput = z.infer<typeof tripFeedbackCommentEditSchema>;
export type TripFeedbackVoteInput = z.infer<typeof tripFeedbackVoteSchema>;
