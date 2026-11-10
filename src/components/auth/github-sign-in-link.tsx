"use client";

import { useState, type ComponentProps } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type GitHubSignInLinkProps = Omit<ComponentProps<"a">, "href"> & Readonly<{ href: string }>;

export function GitHubSignInLink({ children, onClick, ...props }: GitHubSignInLinkProps) {
  const [pending, setPending] = useState(false);

  return (
    <a
      {...props}
      aria-busy={pending || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        setPending(true);
      }}
    >
      {children}
      {pending && <LoadingSpinner />}
    </a>
  );
}
