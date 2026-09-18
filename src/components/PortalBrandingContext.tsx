"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type PortalBranding = {
  name: string;
  subtitle: string;
};

const FALLBACK_BRANDING: PortalBranding = { name: "Recruitment Portal", subtitle: "" };
const PortalBrandingContext = createContext<PortalBranding>(FALLBACK_BRANDING);

export function PortalBrandingProvider({ initialBranding, children }: { initialBranding: PortalBranding; children: React.ReactNode }) {
  const [branding, setBranding] = useState(initialBranding);

  useEffect(() => {
    const refreshBranding = () => {
      void fetch("/api/organization/branding", { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || data.success !== true || !data.branding) return;
          setBranding({
            name: String(data.branding.name || FALLBACK_BRANDING.name).trim() || FALLBACK_BRANDING.name,
            subtitle: String(data.branding.subtitle || "").trim(),
          });
        })
        .catch(() => {
          // Keep the server-provided tenant branding if the refresh is unavailable.
        });
    };

    window.addEventListener("portal-branding-updated", refreshBranding);
    return () => window.removeEventListener("portal-branding-updated", refreshBranding);
  }, []);

  return <PortalBrandingContext.Provider value={branding}>{children}</PortalBrandingContext.Provider>;
}

export default PortalBrandingProvider;

export function usePortalBranding() {
  return useContext(PortalBrandingContext);
}
