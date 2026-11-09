"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type AccountControlProps = Readonly<{
  githubUsername: string;
  avatarUrl: string | null;
}>;

export function AccountControl({ githubUsername, avatarUrl }: AccountControlProps) {
  const signOut = useAccountSignOut();
  return <details className="account-control">
    <summary className="account-trigger" aria-label={`Account menu for ${githubUsername}`}>
      {avatarUrl ? (
        <Image className="account-avatar" src={avatarUrl} alt="" width={40} height={40} unoptimized />
      ) : (
        <span className="account-avatar account-avatar-fallback" aria-hidden="true">{githubUsername.slice(0, 1).toUpperCase()}</span>
      )}
      <span className="account-trigger-copy"><span className="account-eyebrow">Signed in as</span><span className="account-username">@{githubUsername}</span></span>
      <span className="account-chevron" aria-hidden="true">⌄</span>
    </summary>
    {accountMenuContents(githubUsername, signOut)}
  </details>;
}

/** Compact settings trigger for project headers; the dashboard shows identity beside it. */
export function AccountSettingsControl({ githubUsername }: Readonly<{ githubUsername: string }>) {
  const signOut = useAccountSignOut();
  return <details className="account-control">
    <summary className="account-settings-trigger" aria-label={`Settings and account menu for ${githubUsername}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
        <circle cx="12" cy="12" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 1.7-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.02 1.55V20h-2.4v-.21a1.7 1.7 0 0 0-1.02-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-1.7-1.7.06-.06A1.7 1.7 0 0 0 8.48 15a1.7 1.7 0 0 0-1.55-1.02H6.7v-2.4h.23a1.7 1.7 0 0 0 1.55-1.02 1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.7-1.7.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.02-1.55V5.5h2.4v.27a1.7 1.7 0 0 0 1.02 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.7 1.7-.06.06A1.7 1.7 0 0 0 19.4 10.6a1.7 1.7 0 0 0 1.55 1.02h.25v2.4h-.25A1.7 1.7 0 0 0 19.4 15Z" />
      </svg>
    </summary>
    {accountMenuContents(githubUsername, signOut)}
  </details>;
}

function useAccountSignOut(): Readonly<{ isSigningOut: boolean; hasSignOutError: boolean; signOut(): Promise<void> }> {
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

  return { isSigningOut, hasSignOutError, signOut };
}

function accountMenuContents(githubUsername: string, state: ReturnType<typeof useAccountSignOut>): ReactNode {
  return <div className="account-menu">
    <p className="account-menu-label">GitHub account</p>
    <p className="account-menu-username">@{githubUsername}</p>
    {state.hasSignOutError && <p className="account-error" role="alert">Try again later</p>}
    <button className="sign-out-button" type="button" onClick={state.signOut} disabled={state.isSigningOut}>
      {state.isSigningOut ? "Signing out…" : "Sign out"}
    </button>
  </div>;
}
