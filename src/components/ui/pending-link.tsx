"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { LoadingSpinner } from "./loading-spinner";

type PendingLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & Readonly<{ href: string }>;

export function PendingLink({ children, href, ...props }: PendingLinkProps) {
  return (
    <Link {...props} href={href}>
      <PendingIndicator href={href}>{children}</PendingIndicator>
    </Link>
  );
}

function PendingIndicator({ href, children }: Readonly<{ href: string; children: ComponentProps<typeof Link>["children"] }>) {
  const { pending } = useLinkStatus();
  const pathname = usePathname();
  const destination = new URL(href, "https://internal.invalid");
  const isPending = pending && destination.origin === "https://internal.invalid" && destination.pathname !== pathname;
  return <span className="contents" aria-busy={isPending || undefined}>{children}{isPending && <LoadingSpinner />}</span>;
}
