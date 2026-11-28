"use client";

import { useEffect, useState } from "react";

export function useAccountEntry() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    // The public navigation must not keep a stalled session request alive.
    const timer = setTimeout(() => controller.abort(), 5_000);
    fetch("/api/session", { cache: "no-store", signal: controller.signal })
      .then((response): Promise<{ signedIn?: boolean } | null> =>
        !controller.signal.aborted && response.ok ? response.json() as Promise<{ signedIn?: boolean }> : Promise.resolve(null))
      .then((data) => {
        // A timed-out or superseded effect must never update the navigation.
        if (!controller.signal.aborted) setSignedIn(data?.signedIn === true);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return signedIn;
}
