"use client";

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/provider";

type RichDocNode = {
  type?: string;
  text?: string;
  marks?: Array<{ type?: string; attrs?: { href?: string } }>;
  attrs?: { src?: string; alt?: string };
  content?: RichDocNode[];
};

type ImageStripItem = {
  id: string;
  imageUrl: string;
};

export const isSafeLink = (value: string) => {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("http://") || normalized.startsWith("https://");
};

export const parsePlanText = (value: string) => {
  try {
    const doc = JSON.parse(value);
    const parts: string[] = [];

    const walk = (node: { text?: string; content?: unknown[] }) => {
      if (!node) return;
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) {
        node.content.forEach((child) => walk(child as { text?: string; content?: unknown[] }));
      }
    };

    walk(doc as { text?: string; content?: unknown[] });
    return parts.join(" ").trim();
  } catch {
    return "";
  }
};

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

/**
 * `variant="strip"` is DESIGN.md's `photo-strip`: uniform, fixed-width, left-aligned, centre-cropped,
 * sharp-cornered 56px squares along the bottom of a timeline card. `variant="gallery"` keeps the
 * larger rounded treatment used by the full-page map dialog, which is not part of the Epic 7 redesign.
 */
export const MiniImageStrip = ({
  images,
  altPrefix,
  onImageClick,
  variant = "gallery",
}: {
  images: ImageStripItem[];
  altPrefix: string;
  onImageClick: (imageUrl: string, alt: string) => void;
  variant?: "strip" | "gallery";
}) => {
  if (images.length === 0) {
    return null;
  }

  const visible = images.slice(0, 3);
  const remaining = images.length - visible.length;
  const isStrip = variant === "strip";

  return (
    <Box display="flex" alignItems="center" gap={isStrip ? "6px" : 0.75} justifyContent="flex-start" mt={0.75}>
      {visible.map((image, index) => (
        <Box
          key={image.id}
          component="img"
          src={image.imageUrl}
          alt={`${altPrefix} ${index + 1}`}
          sx={{
            // Fixed basis, never flex: 1 - thumbnails are uniform, not stretched to fill the card.
            flex: isStrip ? "0 0 56px" : undefined,
            width: isStrip ? 56 : 96,
            height: isStrip ? 56 : 96,
            objectFit: "cover",
            objectPosition: "center",
            // Photography is always sharp, independent of the radius of the card containing it.
            borderRadius: isStrip ? 0 : 1,
            border: "1px solid",
            borderColor: isStrip ? "rgba(0,0,0,0.06)" : "divider",
            cursor: "pointer",
          }}
          loading="lazy"
          onClick={() => onImageClick(image.imageUrl, `${altPrefix} ${index + 1}`)}
        />
      ))}
      {remaining > 0 ? (
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          +{remaining}
        </Typography>
      ) : null}
    </Box>
  );
};
