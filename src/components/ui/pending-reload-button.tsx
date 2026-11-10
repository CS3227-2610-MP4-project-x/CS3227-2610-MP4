"use client";

import { useState, type ComponentProps } from "react";
import { LoadingSpinner } from "./loading-spinner";

type PendingReloadButtonProps = Omit<ComponentProps<"button">, "onClick" | "type"> & Readonly<{ children: string }>;

export function PendingReloadButton({ children, ...props }: PendingReloadButtonProps) {
  const [pending, setPending] = useState(false);

  return (
    <button
      {...props}
      type="button"
      aria-busy={pending || undefined}
      disabled={pending || props.disabled}
      onClick={() => {
        setPending(true);
        requestAnimationFrame(() => window.location.reload());
      }}
    >
      {children}
      {pending && <LoadingSpinner />}
    </button>
  );
}
