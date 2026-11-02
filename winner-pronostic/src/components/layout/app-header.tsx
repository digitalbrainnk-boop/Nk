import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { UserMenu, UserMenuFallback } from "./user-menu";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
      <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
        <Link href="/" aria-label="Winner Pronostic — accueil">
          <Logo />
        </Link>
        <Suspense fallback={<UserMenuFallback />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}
