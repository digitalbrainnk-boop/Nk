"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { CalendarIcon, LiveIcon, TargetIcon, TicketIcon, UserIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils/cn";

type NavItem = { href: string; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> };

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Matchs", Icon: CalendarIcon },
  { href: "/direct", label: "Direct", Icon: LiveIcon },
  { href: "/pronostics", label: "Pronos", Icon: TargetIcon },
  { href: "/coupons", label: "Coupons", Icon: TicketIcon },
  { href: "/compte", label: "Compte", Icon: UserIcon },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/" || pathname.startsWith("/match");
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ pathname }: { pathname: string | null }) {
  return (
    <ul className="mx-auto grid h-14 max-w-xl grid-cols-5">
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                active ? "text-brand" : "text-muted hover:text-ink",
              )}
            >
              <Icon className="size-[22px]" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Barre de navigation du bas (pouce-friendly sur petits téléphones). */
export function BottomNav() {
  return <NavList pathname={usePathname()} />;
}

/** Version sans onglet actif, affichée pendant le pré-rendu. */
export function BottomNavFallback() {
  return <NavList pathname={null} />;
}
