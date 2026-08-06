"use client";

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { FullscreenPhoto } from "@/components/ui/FullscreenPhotoViewer";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";

type RichDocNode = {
  type?: string;
  text?: string;
  marks?: Array<{ type?: string; attrs?: { href?: string } }>;
  attrs?: { src?: string; alt?: string };
  content?: RichDocNode[];
};

export type ImageStripItem = {
  id: string;
  imageUrl: string;
};

export const isSafeLink = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("http://") || normalized.startsWith("https://");
};

/**
 * Re-exported, not defined here: this module is `"use client"`, so an export of it is a client
 * reference and server code cannot call it (Story 9.2's packet route needs the same label rule the
 * printed sheet uses). The definition is `@/lib/trips/planText`; this line is what keeps the six
 * existing importers of *this* module working unchanged.
 */
export { parsePlanText } from "@/lib/trips/planText";

const parseRichDoc = (value: string): RichDocNode | null => {
  try {
    const parsed = JSON.parse(value) as RichDocNode;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
};

const applyMarks = (text: string, marks: RichDocNode["marks"]): ReactNode => {
  return (marks ?? []).reduce<ReactNode>((acc, mark, index) => {
    if (mark?.type === "italic") return <em key={`mark-italic-${index}`}>{acc}</em>;
    if (mark?.type === "bold") return <strong key={`mark-bold-${index}`}>{acc}</strong>;
    if (mark?.type === "strike") return <s key={`mark-strike-${index}`}>{acc}</s>;
    if (mark?.type === "code") return <code key={`mark-code-${index}`}>{acc}</code>;
    if (mark?.type === "link" && mark.attrs?.href && isSafeLink(mark.attrs.href)) {
      return (
        <a key={`mark-link-${index}`} href={mark.attrs.href} target="_blank" rel="noreferrer noopener">
          {acc}
        </a>
      );
    }
    return acc;
  }, text);
};

const renderRichNode = (node: RichDocNode, key: string, imageAltFallback: string): ReactNode => {
  const children = Array.isArray(node.content)
    ? node.content.map((child, index) => renderRichNode(child, `${key}-${index}`, imageAltFallback)).filter(Boolean)
    : [];

  if (node.type === "doc") return <Box key={key}>{children}</Box>;
  if (node.type === "paragraph") {
    return (
      <Typography key={key} variant="body2" component="p" sx={{ m: 0, whiteSpace: "pre-wrap" }}>
        {children}
      </Typography>
    );
  }
  if (node.type === "bulletList") {
    return (
      <Box key={key} component="ul" sx={{ m: 0, pl: 2.5 }}>
        {children}
      </Box>
    );
  }
  if (node.type === "orderedList") {
    return (
      <Box key={key} component="ol" sx={{ m: 0, pl: 2.5 }}>
        {children}
      </Box>
    );
  }
  if (node.type === "listItem") return <Box key={key} component="li">{children}</Box>;
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "image" && typeof node.attrs?.src === "string" && isSafeLink(node.attrs.src)) {
    return (
      <Box
        key={key}
        component="img"
        src={node.attrs.src}
        alt={typeof node.attrs.alt === "string" && node.attrs.alt.trim() ? node.attrs.alt : imageAltFallback}
        data-testid="day-plan-inline-image"
        sx={{
          display: "block",
          maxWidth: "100%",
          width: "100%",
          height: "auto",
          maxHeight: 240,
          objectFit: "contain",
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          my: 0.75,
        }}
      />
    );
  }
  if (node.type === "text" && typeof node.text === "string") return <span key={key}>{applyMarks(node.text, node.marks)}</span>;
  if (children.length > 0) return <Box key={key}>{children}</Box>;
  return null;
};

export const PlanItemRichContent = ({ contentJson, fallbackText }: { contentJson: string; fallbackText: string }) => {
  const { t } = useI18n();
  const doc = parseRichDoc(contentJson);
  if (!doc) {
    return <Typography variant="body2">{fallbackText}</Typography>;
  }

  const rendered = renderRichNode(doc, "root", t("trips.plan.inlineImageAlt"));
  if (!rendered) {
    return <Typography variant="body2">{fallbackText}</Typography>;
  }

  return <Box display="flex" flexDirection="column" gap={0.75}>{rendered}</Box>;
};

/** The strip's per-image alt, shared with the viewer so the two cannot drift. */
export const stripImageAlt = (altPrefix: string, index: number) => `${altPrefix} ${index + 1}`;

/**
 * The collection the strip hands `FullscreenPhotoViewer` — **every** image, not the three the strip
 * renders. The strip's three-thumbnail cap is the mockup's photo-strip rule and stays; paging inside
 * the viewer is what makes the fourth image and beyond reachable at all (DW-30).
 */
export const toViewerImages = (
  images: readonly ImageStripItem[],
  altPrefix: string,
): FullscreenPhoto[] =>
  images.map((image, index) => ({
    key: image.id,
    imageUrl: image.imageUrl,
    alt: stripImageAlt(altPrefix, index),
  }));

/**
 * `variant="strip"` is DESIGN.md's `photo-strip`: uniform, fixed-width, left-aligned, centre-cropped,
 * sharp-cornered 56px squares along the bottom of a timeline card. `variant="gallery"` keeps the
 * larger rounded treatment used by the full-page map dialog, which is not part of the Epic 7 redesign.
 *
 * Each thumbnail is a real `<button>` wrapping the `<img>` rather than an `<img>` carrying
 * `role="button"`: the role makes an element's contents presentational, which is the trap Story 6.9
 * had to rebuild a card out of. `onImageClick` takes the **index** into `images`, not a URL — the
 * caller owns the collection and hands the whole of it to the viewer.
 */
export const MiniImageStrip = ({
  images,
  altPrefix,
  onImageClick,
  variant = "gallery",
}: {
  images: ImageStripItem[];
  altPrefix: string;
  onImageClick: (index: number) => void;
  variant?: "strip" | "gallery";
}) => {
  const { t } = useI18n();

  if (images.length === 0) {
    return null;
  }

  const visible = images.slice(0, 3);
  const remaining = images.length - visible.length;
  const isStrip = variant === "strip";
  const size = isStrip ? 56 : 96;

  return (
    <Box display="flex" alignItems="center" gap={isStrip ? "6px" : 0.75} justifyContent="flex-start" mt={0.75}>
      {visible.map((image, index) => (
        <Box
          key={image.id}
          component="button"
          type="button"
          // No `aria-label`: the button is named by the image it contains, which already carries the
          // indexed alt. A label here would shadow that name with a second wording of the same thing.
          onClick={() => onImageClick(index)}
          sx={{
            // Fixed basis, never flex: 1 - thumbnails are uniform, not stretched to fill the card.
            flex: isStrip ? `0 0 ${size}px` : undefined,
            width: size,
            height: size,
            padding: 0,
            border: "none",
            background: "none",
            display: "block",
            cursor: "pointer",
            borderRadius: isStrip ? 0 : 1,
            "&:focus-visible": { outline: "2px solid", outlineColor: "text.primary", outlineOffset: "2px" },
          }}
        >
          <Box
            component="img"
            src={image.imageUrl}
            alt={stripImageAlt(altPrefix, index)}
            sx={{
              // Restated rather than `100%`: the thumbnail's own geometry is what DESIGN.md pins,
              // and it must not become a function of whatever the wrapper button resolves to.
              width: size,
              height: size,
              objectFit: "cover",
              objectPosition: "center",
              // Photography is always sharp, independent of the radius of the card containing it.
              borderRadius: isStrip ? 0 : 1,
              border: "1px solid",
              borderColor: isStrip ? "rgba(0,0,0,0.06)" : "divider",
              display: "block",
            }}
            loading="lazy"
          />
        </Box>
      ))}
      {remaining > 0 ? (
        // Was inert caption text, which left the 4th image and beyond unreachable by any input
        // (DW-30). It opens the viewer at the first image the strip does not show — index 3.
        <Typography
          component="button"
          type="button"
          variant="caption"
          color="text.secondary"
          aria-label={
            remaining === 1
              ? t("trips.gallery.showMoreImagesOne")
              : formatMessage(t("trips.gallery.showMoreImages"), { count: remaining })
          }
          onClick={() => onImageClick(visible.length)}
          sx={{
            fontWeight: 600,
            // The 44px touch floor, below the 56px thumbnails so the row's height is unchanged.
            minWidth: 44,
            minHeight: 44,
            padding: 0,
            border: "none",
            background: "none",
            cursor: "pointer",
            "&:focus-visible": { outline: "2px solid", outlineColor: "text.primary", outlineOffset: "2px" },
          }}
        >
          +{remaining}
        </Typography>
      ) : null}
    </Box>
  );
};
