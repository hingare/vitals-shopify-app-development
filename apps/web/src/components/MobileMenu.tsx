"use client";

import { useEffect, useRef } from "react";
import { Link, usePathname } from "@/i18n/navigation";

/** Small-screen menu. A native <details>, closed again after each page change. */
export function MobileMenu({
  label,
  items,
}: {
  label: string;
  items: Array<{ href: string; label: string }>;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  return (
    <details className="mobile-menu" ref={ref}>
      <summary>{label}</summary>
      <nav className="mobile-panel" aria-label={label}>
        {items.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
