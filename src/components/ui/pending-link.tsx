"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentProps } from "react";
import { LoadingSpinner } from "./loading-spinner";

type PendingLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & Readonly<{ href: string }>;

export function PendingLink({ children, href, ...props }: PendingLinkProps) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

  useEffect(() => setPending(false), [pathname]);

  return (
    <Link
      {...props}
      href={href}
      aria-busy={pending || undefined}
      onNavigate={() => {
        const destination = new URL(href, window.location.href);
        if (destination.pathname !== pathname) setPending(true);
      }}
    >
      {children}
      {pending && <LoadingSpinner />}
    </Link>
  );
}
