"use client";

import dynamic from "next/dynamic";

// Leaflet braucht window – deshalb nur im Browser laden.
export const SiteMapLazy = dynamic(() => import("./site-map"), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-xl bg-muted" />,
});
