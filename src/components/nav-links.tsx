"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm ${active ? "bg-brand text-brand-ink" : "text-ink hover:bg-bg"}`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
