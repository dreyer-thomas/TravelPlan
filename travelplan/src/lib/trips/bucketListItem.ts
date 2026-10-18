/**
 * Story 14.1. A parked activity - an activity with no day yet - as `GET bucket-list-items` returns it:
 * everything the activity dialog needs to open on it, plus the row's first picture.
 *
 * Story 14.2: shared by the overview's bucket card and Day Detail's, since both now open an idea in the
 * activity dialog to edit it.
 */
export type BucketListItem = {
  id: string;
  tripId: string;
  title: string;
  contentJson: string;
  durationMinutes: number;
  costCents: number | null;
  costOriginalAmount: number | null;
  costCurrency: string | null;
  costRate: number | null;
  costRateDate: string | null;
  payments: { amountCents: number; dueDate: string; amountOriginal?: number }[];
  linkUrl: string | null;
  location: { lat: number; lng: number; label: string | null } | null;
  firstImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The row as the activity dialog's `item`: parked, so FLEXIBLE with no day and no times. */
export const toBucketDialogItem = (item: BucketListItem) => ({
  id: item.id,
  tripDayId: null,
  title: item.title,
  fromTime: null,
  toTime: null,
  contentJson: item.contentJson,
  costCents: item.costCents,
  costOriginalAmount: item.costOriginalAmount,
  costCurrency: item.costCurrency,
  costRate: item.costRate,
  costRateDate: item.costRateDate,
  payments: item.payments,
  linkUrl: item.linkUrl,
  location: item.location,
  createdAt: item.createdAt,
  scheduleMode: "FLEXIBLE" as const,
  durationMinutes: item.durationMinutes,
});
