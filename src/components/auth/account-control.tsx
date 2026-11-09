"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type AccountControlProps = Readonly<{
  githubUsername: string;
  avatarUrl: string | null;
}>;

export function AccountControl({ githubUsername, avatarUrl }: AccountControlProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [hasSignOutError, setHasSignOutError] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    setHasSignOutError(false);
    try {
      const response = await fetch("/api/v1/auth/sign-out", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Sign-out failed");
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setHasSignOutError(true);
      setIsSigningOut(false);
    }
  }

  return (
    <details className="account-control">
      <summary className="account-trigger" aria-label={`Account menu for ${githubUsername}`}>
        {avatarUrl ? (
          <Image className="account-avatar" src={avatarUrl} alt="" width={40} height={40} unoptimized />
        ) : (
          <span className="account-avatar account-avatar-fallback" aria-hidden="true">
            {githubUsername.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="account-trigger-copy">
          <span className="account-eyebrow">Signed in as</span>
          <span className="account-username">@{githubUsername}</span>
        </span>
        <span className="account-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="account-menu">
        {hasSignOutError && <p className="account-error" role="alert">Try again later</p>}
        <button className="sign-out-button" type="button" onClick={signOut} disabled={isSigningOut}>
          {isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </details>
  );
}
