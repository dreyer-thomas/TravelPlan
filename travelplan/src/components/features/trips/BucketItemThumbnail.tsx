"use client";

import { Box } from "@mui/material";

/**
 * Story 14.1, DESIGN.md `bucket-item`. The first picture of a bucket-list idea: a 40px square at the
 * photography radius (0), cropped to fill. Nothing at all when there is no picture - no placeholder.
 * Shared by the overview card and the Day Detail panel; `MiniImageStrip` is 56px and multi-image, a
 * different thing.
 *
 * Decorative (`alt=""`): it always sits beside the idea's title, which a screen reader would otherwise
 * read twice on every row.
 */
export const BUCKET_ITEM_THUMBNAIL_PX = 40;

export default function BucketItemThumbnail({ imageUrl }: { imageUrl: string | null }) {
  if (!imageUrl) return null;
  return (
    <Box
      component="img"
      src={imageUrl}
      alt=""
      loading="lazy"
      sx={{
        width: BUCKET_ITEM_THUMBNAIL_PX,
        height: BUCKET_ITEM_THUMBNAIL_PX,
        flexShrink: 0,
        objectFit: "cover",
        borderRadius: 0,
        display: "block",
      }}
    />
  );
}
