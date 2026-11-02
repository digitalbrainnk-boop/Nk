import { Suspense } from "react";
import { BottomNav, BottomNavFallback } from "./bottom-nav";
import { ResponsibleGamingStrip } from "./responsible-gaming-strip";

/** Bas d'écran fixe : bandeau de prévention + navigation. */
export function AppFooterBar() {
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-30 bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ResponsibleGamingStrip />
      <div className="border-t border-line">
        <Suspense fallback={<BottomNavFallback />}>
          <BottomNav />
        </Suspense>
      </div>
    </nav>
  );
}
