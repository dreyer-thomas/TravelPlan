/**
 * Story 16.4. The packing receipt: what one connector write did to the trip's packing list, and everything
 * needed to take it back in one step. It is only ever stored server-side (`ai_changes`), unsigned and
 * trusted, next to the v3 day receipt; `aiChangeRepo` tells the two apart by `kind`.
 *
 * Its own shape rather than a fourth kind of the day receipt (deviation D1 in the story): a trip-wide
 * packing write has no day, and the day receipt and its undo core are built around one.
 *
 * Each entry names one item the write touched, with the `updatedAt` the write left on it (undo is refused
 * when the item carries another stamp since):
 * - `created`: the write created the item; undo deletes it.
 * - `updated`: the write changed the item or its day links; `before` is the item as it was, which undo
 *   writes back, its `updatedAt` and `aiChangedAt` included, so undoing newest first works across chains.
 * - `deleted`: the write deleted the item; undo recreates it with its own id and stamps.
 *
 * No Prisma import on purpose, like `dayChangeReceipt.ts`.
 */

export type PackingItemSnapshot<T extends Date | string = Date> = {
  id: string;
  name: string;
  nameKey: string;
  category: string | null;
  packed: boolean;
  aiChangedAt: T | null;
  createdAt: T;
  updatedAt: T;
  /** The days the item was linked to. */
  dayIds: string[];
};

export type PackingReceiptEntry<T extends Date | string = Date> =
  | { change: "created"; itemId: string; updatedAt: T }
  | { change: "updated"; before: PackingItemSnapshot<T>; updatedAt: T }
  | { change: "deleted"; before: PackingItemSnapshot<T> };

export type PackingChangeReceipt<T extends Date | string = Date> = {
  kind: "packingChanged";
  version: 1;
  entries: PackingReceiptEntry<T>[];
};

export type PackingChangeReceiptWire = PackingChangeReceipt<string>;

const mapSnapshot = <A extends Date | string, B extends Date | string>(
  snapshot: PackingItemSnapshot<A>,
  convert: (value: A) => B,
): PackingItemSnapshot<B> => ({
  ...snapshot,
  dayIds: [...snapshot.dayIds],
  aiChangedAt: snapshot.aiChangedAt === null ? null : convert(snapshot.aiChangedAt),
  createdAt: convert(snapshot.createdAt),
  updatedAt: convert(snapshot.updatedAt),
});

const mapReceipt = <A extends Date | string, B extends Date | string>(
  receipt: PackingChangeReceipt<A>,
  convert: (value: A) => B,
): PackingChangeReceipt<B> => ({
  kind: receipt.kind,
  version: receipt.version,
  entries: receipt.entries.map((entry): PackingReceiptEntry<B> => {
    switch (entry.change) {
      case "created":
        return { change: "created", itemId: entry.itemId, updatedAt: convert(entry.updatedAt) };
      case "updated":
        return { change: "updated", before: mapSnapshot(entry.before, convert), updatedAt: convert(entry.updatedAt) };
      case "deleted":
        return { change: "deleted", before: mapSnapshot(entry.before, convert) };
    }
  }),
});

export const toPackingChangeReceiptWire = (receipt: PackingChangeReceipt): PackingChangeReceiptWire =>
  mapReceipt(receipt, (value: Date) => value.toISOString());

/** The caller has validated the wire form; every date string here parses. */
export const fromPackingChangeReceiptWire = (receipt: PackingChangeReceiptWire): PackingChangeReceipt =>
  mapReceipt(receipt, (value: string) => new Date(value));

export const isPackingChangeReceipt = (receipt: { kind?: unknown } | object): receipt is PackingChangeReceipt =>
  "kind" in receipt && receipt.kind === "packingChanged";
