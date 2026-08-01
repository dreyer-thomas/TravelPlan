"use client";

import { Button } from "@mui/material";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export default function TripDayMapBackButton({ href, label }: { href: string; label: string }) {
  const router = useRouter();

  const handleClick = useCallback(() => {
    if (typeof window === "undefined") {
      router.push(href);
      return;
    }

    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push(href);
  }, [href, router]);

  return (
    // No color override: the text-button default resolves to primary.main (the accent), which is what
    // the sibling back button on trips/[id]/page.tsx renders. The 44px touch target comes from
    // theme.ts's MuiButton.root { minHeight: 44 } and needs no restatement here.
    <Button variant="text" onClick={handleClick} sx={{ alignSelf: "flex-start" }}>
      {label}
    </Button>
  );
}
