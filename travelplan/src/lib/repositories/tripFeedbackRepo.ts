import type { $Enums } from "@/generated/prisma/client";
import { getTripAccessForUser } from "@/lib/auth/tripAccess";
import { prisma } from "@/lib/db/prisma";
import { supportsTripFeedbackVoting, type FeedbackTargetType } from "@/lib/feedback/tripFeedbackCapabilities";
export type FeedbackVoteValue = "up" | "down";

export type TripFeedbackComment = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    email: string;
  };
};

export type TripFeedbackSummary = {
  targetType: FeedbackTargetType;
  targetId: string;
  comments: TripFeedbackComment[];
  voteSummary: {
    upCount: number;
    downCount: number;
    userVote: FeedbackVoteValue | null;
  };
};

export type TripFeedbackMap = Record<string, TripFeedbackSummary>;
export type UpdateTripFeedbackCommentResult =
  | { outcome: "updated"; feedback: TripFeedbackSummary }
  | { outcome: "not_found" }
  | { outcome: "forbidden" };

const toSummaryIdentity = (target: {
  targetType: $Enums.FeedbackTargetType;
  tripId: string;
  tripDayId: string | null;
  accommodationId: string | null;
  dayPlanItemId: string | null;
}) => {
  const targetType: FeedbackTargetType =
    target.targetType === "TRIP"
      ? "trip"
      : target.targetType === "TRIP_DAY"
        ? "tripDay"
        : target.targetType === "ACCOMMODATION"
          ? "accommodation"
          : "dayPlanItem";
  const targetId =
    targetType === "trip"
      ? target.tripId
      : targetType === "tripDay"
        ? target.tripDayId!
        : targetType === "accommodation"
          ? target.accommodationId!
          : target.dayPlanItemId!;

  return { targetType, targetId };
};

export class UnsupportedTripFeedbackVoteError extends Error {
  constructor(targetType: FeedbackTargetType) {
    super(`Voting is not supported for ${targetType} feedback targets`);
    this.name = "UnsupportedTripFeedbackVoteError";
  }
}

type FeedbackTargetInput =
  | { type: "trip"; tripId: string }
  | { type: "tripDay"; tripId: string; tripDayId: string }
  | { type: "accommodation"; tripId: string; tripDayId: string; accommodationId: string }
  | { type: "dayPlanItem"; tripId: string; tripDayId: string; dayPlanItemId: string };

const toPrismaTargetType = (type: FeedbackTargetType): $Enums.FeedbackTargetType => {
  switch (type) {
    case "trip":
      return "TRIP";
    case "tripDay":
      return "TRIP_DAY";
    case "accommodation":
      return "ACCOMMODATION";
    case "dayPlanItem":
      return "DAY_PLAN_ITEM";
  }
};

const toTargetKey = (input: FeedbackTargetInput) => {
  switch (input.type) {
    case "trip":
      return `trip:${input.tripId}`;
    case "tripDay":
      return `tripDay:${input.tripDayId}`;
    case "accommodation":
      return `accommodation:${input.accommodationId}`;
    case "dayPlanItem":
      return `dayPlanItem:${input.dayPlanItemId}`;
  }
};

const toSummaryKey = (type: FeedbackTargetType, targetId: string) => `${type}:${targetId}`;

const findSupportedTarget = async (input: FeedbackTargetInput) => {
  switch (input.type) {
    case "trip": {
      const trip = await prisma.trip.findUnique({
        where: { id: input.tripId },
        select: { id: true },
      });
      if (!trip) return null;
      return {
        tripId: trip.id,
        targetType: "trip" as const,
        targetId: trip.id,
        tripDayId: null,
        accommodationId: null,
        dayPlanItemId: null,
      };
    }
    case "tripDay": {
      const day = await prisma.tripDay.findFirst({
        where: { id: input.tripDayId, tripId: input.tripId },
        select: { id: true, tripId: true },
      });
      if (!day) return null;
      return {
        tripId: day.tripId,
        targetType: "tripDay" as const,
        targetId: day.id,
        tripDayId: day.id,
        accommodationId: null,
        dayPlanItemId: null,
      };
    }
    case "accommodation": {
      const accommodation = await prisma.accommodation.findFirst({
        where: {
          id: input.accommodationId,
          tripDayId: input.tripDayId,
          tripDay: { tripId: input.tripId },
        },
        select: {
          id: true,
          tripDayId: true,
          tripDay: { select: { tripId: true } },
        },
      });
      if (!accommodation) return null;
      return {
        tripId: accommodation.tripDay.tripId,
        targetType: "accommodation" as const,
        targetId: accommodation.id,
        tripDayId: accommodation.tripDayId,
        accommodationId: accommodation.id,
        dayPlanItemId: null,
      };
    }
    case "dayPlanItem": {
      const item = await prisma.dayPlanItem.findFirst({
        where: {
          id: input.dayPlanItemId,
          tripDayId: input.tripDayId,
          tripDay: { tripId: input.tripId },
        },
        select: {
          id: true,
          tripDayId: true,
          tripDay: { select: { tripId: true } },
        },
      });
      if (!item) return null;
      return {
        tripId: item.tripDay.tripId,
        targetType: "dayPlanItem" as const,
        targetId: item.id,
        tripDayId: item.tripDayId,
        accommodationId: null,
        dayPlanItemId: item.id,
      };
    }
  }
};

const ensureFeedbackTarget = async (input: FeedbackTargetInput) => {
  const supported = await findSupportedTarget(input);
  if (!supported) {
    return null;
  }

  const targetKey = toTargetKey(input);
  const target = await prisma.tripFeedbackTarget.upsert({
    where: { targetKey },
    create: {
      tripId: supported.tripId,
      targetType: toPrismaTargetType(supported.targetType),
      targetKey,
      tripDayId: supported.tripDayId,
      accommodationId: supported.accommodationId,
      dayPlanItemId: supported.dayPlanItemId,
    },
    update: {
      updatedAt: new Date(),
    },
    select: {
      id: true,
      tripId: true,
    },
  });

  return {
    targetRowId: target.id,
    tripId: target.tripId,
    targetType: supported.targetType,
    targetId: supported.targetId,
  };
};

export const listTripFeedbackForUser = async (userId: string, tripId: string): Promise<TripFeedbackMap | null> => {
  const access = await getTripAccessForUser(userId, tripId);
  if (!access) return null;

  const targets = await prisma.tripFeedbackTarget.findMany({
    where: { tripId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      comments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          author: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      },
      votes: {
        select: {
          userId: true,
          value: true,
        },
      },
    },
  });

  const feedback = Object.fromEntries(
    targets.map((target) => {
      const targetType: FeedbackTargetType =
        target.targetType === "TRIP"
          ? "trip"
          : target.targetType === "TRIP_DAY"
            ? "tripDay"
            : target.targetType === "ACCOMMODATION"
              ? "accommodation"
              : "dayPlanItem";
      const targetId =
        targetType === "trip"
          ? target.tripId
          : targetType === "tripDay"
            ? target.tripDayId!
            : targetType === "accommodation"
              ? target.accommodationId!
              : target.dayPlanItemId!;

      const upCount = target.votes.filter((vote) => vote.value === "UP").length;
      const downCount = target.votes.filter((vote) => vote.value === "DOWN").length;
      const ownVote = target.votes.find((vote) => vote.userId === userId);
      const summary: TripFeedbackSummary = {
        targetType,
        targetId,
        comments: target.comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          author: {
            id: comment.author.id,
            email: comment.author.email,
          },
        })),
        voteSummary: {
          upCount,
          downCount,
          userVote: ownVote ? (ownVote.value === "UP" ? "up" : "down") : null,
        },
      };

      return [toSummaryKey(targetType, targetId), summary];
    }),
  );

  return feedback;
};

export const addTripFeedbackComment = async ({
  userId,
  target,
  body,
}: {
  userId: string;
  target: FeedbackTargetInput;
  body: string;
}): Promise<TripFeedbackSummary | null> => {
  const access = await getTripAccessForUser(userId, target.tripId);
  if (!access) return null;

  const resolvedTarget = await ensureFeedbackTarget(target);
  if (!resolvedTarget) return null;

  const trimmedBody = body.trim();
  if (!trimmedBody) {
    throw new Error("Comment body is required");
  }

  await prisma.tripFeedbackComment.create({
    data: {
      targetId: resolvedTarget.targetRowId,
      authorId: userId,
      body: trimmedBody,
    },
  });

  const feedback = await listTripFeedbackForUser(userId, resolvedTarget.tripId);
  return feedback?.[toSummaryKey(resolvedTarget.targetType, resolvedTarget.targetId)] ?? null;
};

export const upsertTripFeedbackVote = async ({
  userId,
  target,
  value,
}: {
  userId: string;
  target: FeedbackTargetInput;
  value: FeedbackVoteValue;
}): Promise<TripFeedbackSummary | null> => {
  const access = await getTripAccessForUser(userId, target.tripId);
  if (!access) return null;

  if (!supportsTripFeedbackVoting(target.type)) {
    throw new UnsupportedTripFeedbackVoteError(target.type);
  }

  const resolvedTarget = await ensureFeedbackTarget(target);
  if (!resolvedTarget) return null;

  await prisma.tripFeedbackVote.upsert({
    where: {
      targetId_userId: {
        targetId: resolvedTarget.targetRowId,
        userId,
      },
    },
    create: {
      targetId: resolvedTarget.targetRowId,
      userId,
      value: value === "up" ? "UP" : "DOWN",
    },
    update: {
      value: value === "up" ? "UP" : "DOWN",
    },
  });

  const feedback = await listTripFeedbackForUser(userId, resolvedTarget.tripId);
  return feedback?.[toSummaryKey(resolvedTarget.targetType, resolvedTarget.targetId)] ?? null;
};

export const canWriteTripFeedback = async (userId: string, tripId: string) => {
  const access = await getTripAccessForUser(userId, tripId);
  return access !== null;
};

export const updateTripFeedbackComment = async ({
  userId,
  tripId,
  commentId,
  body,
}: {
  userId: string;
  tripId: string;
  commentId: string;
  body: string;
}): Promise<UpdateTripFeedbackCommentResult> => {
  const access = await getTripAccessForUser(userId, tripId);
  if (!access) {
    return { outcome: "not_found" };
  }

  const trimmedBody = body.trim();
  if (!trimmedBody) {
    throw new Error("Comment body is required");
  }

  const comment = await prisma.tripFeedbackComment.findFirst({
    where: {
      id: commentId,
      target: {
        tripId,
      },
    },
    select: {
      id: true,
      authorId: true,
      target: {
        select: {
          tripId: true,
          targetType: true,
          tripDayId: true,
          accommodationId: true,
          dayPlanItemId: true,
        },
      },
    },
  });

  if (!comment) {
    return { outcome: "not_found" };
  }

  if (comment.authorId !== userId) {
    return { outcome: "forbidden" };
  }

  await prisma.tripFeedbackComment.update({
    where: { id: comment.id },
    data: {
      body: trimmedBody,
    },
  });

  const { targetType, targetId } = toSummaryIdentity(comment.target);

  const feedback = await listTripFeedbackForUser(userId, tripId);
  const summary = feedback?.[toSummaryKey(targetType, targetId)] ?? null;

  if (!summary) {
    return { outcome: "not_found" };
  }

  return { outcome: "updated", feedback: summary };
};

export const deleteTripFeedbackComment = async ({
  userId,
  tripId,
  commentId,
}: {
  userId: string;
  tripId: string;
  commentId: string;
}): Promise<UpdateTripFeedbackCommentResult> => {
  const access = await getTripAccessForUser(userId, tripId);
  if (!access) {
    return { outcome: "not_found" };
  }

  const comment = await prisma.tripFeedbackComment.findFirst({
    where: {
      id: commentId,
      target: {
        tripId,
      },
    },
    select: {
      id: true,
      authorId: true,
      target: {
        select: {
          tripId: true,
          targetType: true,
          tripDayId: true,
          accommodationId: true,
          dayPlanItemId: true,
        },
      },
    },
  });

  if (!comment) {
    return { outcome: "not_found" };
  }

  if (comment.authorId !== userId) {
    return { outcome: "forbidden" };
  }

  await prisma.tripFeedbackComment.delete({
    where: { id: comment.id },
  });

  const { targetType, targetId } = toSummaryIdentity(comment.target);
  const feedback = await listTripFeedbackForUser(userId, tripId);
  const summary = feedback?.[toSummaryKey(targetType, targetId)] ?? null;

  if (!summary) {
    return {
      outcome: "updated",
      feedback: {
        targetType,
        targetId,
        comments: [],
        voteSummary: {
          upCount: 0,
          downCount: 0,
          userVote: null,
        },
      },
    };
  }

  return { outcome: "updated", feedback: summary };
};
