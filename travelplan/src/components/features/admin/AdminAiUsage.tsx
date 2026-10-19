"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from "@mui/material";
import { formatMessage } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import type { AiUsageSummary } from "@/lib/ai/usageSummary";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

export type AdminAiUsageData = {
  month: string;
  months: string[];
  summary: AiUsageSummary;
};

/** One state at a time, the same union shape as `AdminUsersList`. */
type UsageState =
  | { status: "loading" }
  | { status: "blocked" }
  | { status: "error"; messageKey: string }
  | { status: "loaded"; data: AdminAiUsageData };

/**
 * Story 8.7. What the AI day searches cost, one month at a time, for an administrator.
 *
 * The page gates itself; this component still handles `forbidden` because the role can be revoked between
 * that render and this fetch (the reasoning of `AdminUsersList`). Money is USD, Anthropic's billing
 * currency - `formatCost` is EUR-only and is deliberately not used - and is labelled as an estimate.
 */
export default function AdminAiUsage() {
  const { t, language } = useI18n();
  const { tokens } = useTheme().palette;
  const monthLabelId = useId();
  const tokensHeadingId = useId();
  const perUserHeadingId = useId();
  const [state, setState] = useState<UsageState>({ status: "loading" });
  /** `null` until the admin picks one: the server's current month, not the browser's. */
  const [month, setMonth] = useState<string | null>(null);
  /**
   * The last months the server offered, kept apart from the fetch state so the picker stays usable while a
   * month loads and after one failed to - otherwise only a page reload would let the admin pick again.
   */
  const [picker, setPicker] = useState<{ month: string; months: string[] } | null>(null);

  const locale = language === "de" ? "de-DE" : "en-US";
  const formats = useMemo(
    () => ({
      count: new Intl.NumberFormat(locale),
      percent: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
      usd: new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      usdPerSearch: new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }),
      month: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    }),
    [locale],
  );
  const monthName = (key: string) => {
    const [year, monthNumber] = key.split("-").map(Number);
    return formats.month.format(new Date(year, monthNumber - 1, 1));
  };

  const fetchUsage = useCallback(async (requested: string | null): Promise<UsageState> => {
    try {
      const query = requested ? `?month=${encodeURIComponent(requested)}` : "";
      const response = await fetch(`/api/admin/ai-usage${query}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await response.json()) as ApiEnvelope<AdminAiUsageData>;

      if (!response.ok || body.error || !body.data) {
        switch (body.error?.code) {
          case "forbidden":
            return { status: "blocked" };
          case "unauthorized":
          case "password_change_required":
            return { status: "error", messageKey: "errors.unauthorized" };
          default:
            return { status: "error", messageKey: "admin.aiUsage.loadError" };
        }
      }
      if (!Array.isArray(body.data.months) || !body.data.summary) {
        return { status: "error", messageKey: "admin.aiUsage.loadError" };
      }
      return { status: "loaded", data: body.data };
    } catch {
      return { status: "error", messageKey: "admin.aiUsage.loadError" };
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchUsage(month).then((next) => {
      if (!active) return;
      setState(next);
      if (next.status === "loaded") setPicker({ month: next.data.month, months: next.data.months });
    });
    return () => {
      active = false;
    };
  }, [fetchUsage, month]);

  const data = state.status === "loaded" ? state.data : null;
  const summary = data?.summary ?? null;
  const notAvailable = t("admin.aiUsage.notAvailable");
  const costIncomplete = summary && summary.unpricedModels.length > 0 ? t("admin.aiUsage.costIncomplete") : undefined;

  const tableSx = {
    "& .MuiTableCell-root": { borderColor: tokens.border, px: "8px", py: "8px" },
    "& .MuiTableCell-head": { color: tokens.inkSoft, fontWeight: 600 },
  } as const;

  return (
    <Box
      sx={{
        backgroundColor: tokens.card,
        border: `1px solid ${tokens.borderStrong}`,
        borderRadius: "8px",
        padding: "18px",
      }}
    >
      <Box display="flex" flexWrap="wrap" alignItems="flex-start" justifyContent="space-between" gap={2}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="labelCaps" component="h1" sx={{ color: tokens.inkSoft }}>
            {t("admin.aiUsage.title")}
          </Typography>
          <Typography variant="body2" component="div" sx={{ mt: "4px", color: tokens.inkSoft }}>
            {t("admin.aiUsage.subtitle")}
          </Typography>
        </Box>
        {picker && (
          <Box>
            <Typography id={monthLabelId} variant="caption" component="div" sx={{ color: tokens.inkSoft, mb: "4px" }}>
              {t("admin.aiUsage.monthLabel")}
            </Typography>
            <Select
              size="small"
              value={month ?? picker.month}
              onChange={(event) => {
                // The old month's figures are cleared at once, so they never show under the new month.
                setState({ status: "loading" });
                setMonth(event.target.value);
              }}
              inputProps={{ "aria-labelledby": monthLabelId }}
              sx={{ minWidth: 180 }}
            >
              {picker.months.map((key) => (
                <MenuItem key={key} value={key}>
                  {monthName(key)}
                </MenuItem>
              ))}
            </Select>
          </Box>
        )}
      </Box>

      <Box sx={{ mt: "14px" }}>
        {state.status === "loading" && (
          <Box display="flex" justifyContent="center" py={2}>
            <CircularProgress size={24} />
          </Box>
        )}

        {state.status === "blocked" && <Alert severity="info">{t("admin.aiUsage.forbidden")}</Alert>}

        {state.status === "error" && <Alert severity="error">{t(state.messageKey)}</Alert>}

        {summary && summary.totals.searches === 0 && (
          <Typography variant="body2" component="p" sx={{ color: tokens.inkSoft }}>
            {t("admin.aiUsage.empty")}
          </Typography>
        )}

        {summary && summary.totals.searches > 0 && (
          <>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))", md: "repeat(5, minmax(0, 1fr))" },
                gap: "10px",
              }}
            >
              <StatTile
                label={t("admin.aiUsage.searches")}
                value={formats.count.format(summary.totals.searches)}
                detail={formatMessage(t("admin.aiUsage.failedCount"), { count: formats.count.format(summary.totals.failed) })}
              />
              <StatTile
                label={t("admin.aiUsage.estimatedCost")}
                value={formats.usd.format(summary.estimatedCostUsd)}
                detail={costIncomplete}
              />
              <StatTile
                label={t("admin.aiUsage.costPerSearch")}
                value={summary.costPerSearchUsd === null ? notAvailable : formats.usdPerSearch.format(summary.costPerSearchUsd)}
                detail={costIncomplete}
              />
              <StatTile
                label={t("admin.aiUsage.cacheReadShare")}
                value={summary.cacheReadShare === null ? notAvailable : formats.percent.format(summary.cacheReadShare)}
              />
              <StatTile label={t("admin.aiUsage.webSearches")} value={formats.count.format(summary.totals.webSearchRequests)} />
            </Box>

            <Typography variant="caption" component="p" sx={{ mt: "10px", color: tokens.inkSoft }}>
              {t("admin.aiUsage.estimateNote")}
            </Typography>
            {summary.unpricedModels.map((model) => (
              <Alert key={model} severity="warning" sx={{ mt: "10px" }}>
                {formatMessage(t("admin.aiUsage.unpricedModel"), { model })}
              </Alert>
            ))}

            <SectionHeading id={tokensHeadingId}>{t("admin.aiUsage.tokensHeading")}</SectionHeading>
            <TableContainer sx={{ overflowX: "auto" }}>
              <Table size="small" aria-labelledby={tokensHeadingId} sx={tableSx}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t("admin.aiUsage.tokenKind")}</TableCell>
                    <TableCell align="right">{t("admin.aiUsage.tokenCount")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(
                    [
                      ["admin.aiUsage.inputTokens", summary.totals.inputTokens],
                      ["admin.aiUsage.cacheWriteTokens", summary.totals.cacheCreationInputTokens],
                      ["admin.aiUsage.cacheReadTokens", summary.totals.cacheReadInputTokens],
                      ["admin.aiUsage.outputTokens", summary.totals.outputTokens],
                    ] as const
                  ).map(([labelKey, value]) => (
                    <TableRow key={labelKey}>
                      <TableCell>{t(labelKey)}</TableCell>
                      <TableCell align="right">{formats.count.format(value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <SectionHeading id={perUserHeadingId}>{t("admin.aiUsage.perUserHeading")}</SectionHeading>
            <TableContainer sx={{ overflowX: "auto" }}>
              <Table size="small" aria-labelledby={perUserHeadingId} sx={tableSx}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t("admin.aiUsage.account")}</TableCell>
                    <TableCell align="right">{t("admin.aiUsage.searches")}</TableCell>
                    <TableCell align="right">{t("admin.aiUsage.estimatedCost")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.perUser.map((entry) => (
                    <TableRow key={entry.userId ?? "deleted"}>
                      <TableCell sx={{ overflowWrap: "anywhere" }}>
                        {entry.userId === null ? (
                          <Box component="span" sx={{ fontStyle: "italic" }}>
                            {t("admin.aiUsage.deletedAccount")}
                          </Box>
                        ) : (
                          entry.email
                        )}
                      </TableCell>
                      <TableCell align="right">{formats.count.format(entry.searches)}</TableCell>
                      <TableCell align="right">
                        {entry.pricedSearches === 0 ? notAvailable : formats.usd.format(entry.estimatedCostUsd)}
                        {entry.pricedSearches > 0 && entry.pricedSearches < entry.searches && (
                          <Typography variant="caption" component="div" sx={{ color: tokens.inkSoft }}>
                            {t("admin.aiUsage.costIncomplete")}
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Box>
    </Box>
  );
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  const { tokens } = useTheme().palette;
  return (
    <Typography
      id={id}
      variant="labelCaps"
      component="h2"
      sx={{ display: "block", fontSize: 11, letterSpacing: "0.06em", color: tokens.inkSoft, mt: "18px", mb: "6px" }}
    >
      {children}
    </Typography>
  );
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  const { tokens } = useTheme().palette;
  return (
    <Box sx={{ border: `1px solid ${tokens.border}`, borderRadius: "6px", padding: "10px", minWidth: 0 }}>
      <Typography variant="caption" component="div" sx={{ color: tokens.inkSoft }}>
        {label}
      </Typography>
      <Typography variant="body1" component="div" sx={{ color: tokens.ink, fontWeight: 600, overflowWrap: "anywhere" }}>
        {value}
      </Typography>
      {detail && (
        <Typography variant="caption" component="div" sx={{ color: tokens.inkSoft }}>
          {detail}
        </Typography>
      )}
    </Box>
  );
}
