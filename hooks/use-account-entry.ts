"use client";

import { useEffect, useState } from "react";

export function useAccountEntry() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { cache: "no-store", signal: controller.signal })
      .then((response): Promise<{ signedIn?: boolean } | null> => response.ok ? response.json() as Promise<{ signedIn?: boolean }> : Promise.resolve(null))
      .then((data) => setSignedIn(data?.signedIn === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return signedIn;
}
