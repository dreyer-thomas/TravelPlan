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
    <Button variant="text" onClick={handleClick} sx={{ alignSelf: "flex-start", color: "#f3f6fb" }}>
      {label}
    </Button>
  );
}
