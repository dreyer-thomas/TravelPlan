"use client";

import { Alert, Box, Button, CircularProgress } from "@mui/material";
import Link from "next/link";
import { useEffect, useState } from "react";
import TripDayPrintDocument from "@/components/features/trips/TripDayPrintDocument";
import type { TripDayPrintPayload } from "@/lib/repositories/tripRepo";
import { useI18n } from "@/i18n/provider";

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
};

type TripDayPrintPageProps = {
  tripId: string;
  dayId: string;
};

export default function TripDayPrintPage({ tripId, dayId }: TripDayPrintPageProps) {
  const { t } = useI18n();
  const [payload, setPayload] = useState<TripDayPrintPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/trips/${tripId}/days/${dayId}/print`, { credentials: "include" })
      .then(async (res) => {
        const body = (await res.json()) as ApiEnvelope<TripDayPrintPayload>;
        if (cancelled) return;
        if (!res.ok || body.error || !body.data) {
          setError(t("trips.dayPrint.loadError"));
          return;
        }
        setPayload(body.data);
      })
      .catch(() => {
        if (!cancelled) setError(t("trips.dayPrint.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tripId, dayId, t]);

  return (
    <Box sx={{ maxWidth: "780px", mx: "auto", px: 2, py: 3 }}>
      <Box className="print-hide" sx={{ mb: 2, display: "flex", gap: 1, alignItems: "center" }}>
        <Button component={Link} href={`/trips/${tripId}/days/${dayId}`} variant="text" size="small">
          {t("trips.dayPrint.back")}
        </Button>
        {payload && !loading && (
          <Button variant="outlined" size="small" onClick={() => window.print()}>
            {t("trips.dayView.printAction")}
          </Button>
        )}
      </Box>

      {loading && (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress size={32} />
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {payload && !loading && (
        <TripDayPrintDocument payload={payload} onReady={() => window.print()} />
      )}
    </Box>
  );
}
