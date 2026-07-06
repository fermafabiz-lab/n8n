"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-fetches server data on an interval so approvals/status flips made by
// n8n show up without a manual reload. Pauses while the tab is hidden.
export default function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const id = setInterval(tick, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
