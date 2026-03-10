export type FeedbackTargetType = "trip" | "tripDay" | "accommodation" | "dayPlanItem";

export type TripFeedbackCapabilities = {
  comments: boolean;
  votes: boolean;
};

const FEEDBACK_CAPABILITIES: Record<FeedbackTargetType, TripFeedbackCapabilities> = {
  trip: { comments: true, votes: true },
  tripDay: { comments: true, votes: false },
  accommodation: { comments: true, votes: false },
  dayPlanItem: { comments: true, votes: true },
};

export const getTripFeedbackCapabilities = (targetType: FeedbackTargetType): TripFeedbackCapabilities =>
  FEEDBACK_CAPABILITIES[targetType];

export const supportsTripFeedbackVoting = (targetType: FeedbackTargetType) =>
  getTripFeedbackCapabilities(targetType).votes;
