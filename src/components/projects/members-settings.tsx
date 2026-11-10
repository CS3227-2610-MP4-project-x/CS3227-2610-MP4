"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { addProjectMember, transferProjectManager } from "./project-actions";
import type { ProjectMemberView } from "@/server/projects";

type Props = Readonly<{ projectId: string; members: readonly ProjectMemberView[] }>;

function addFailureMessage(status: number, code: string | undefined): string {
  if (status === 400 || code === "INVALID_REQUEST") return "Enter a valid GitHub username.";
  if (code === "NOT_FOUND") return "No registered person was found for that GitHub username.";
  if (code === "GITHUB_USERNAME_AMBIGUOUS") return "More than one registered person matches that username. Contact support to resolve it.";
  if (code === "ALREADY_MEMBER") return "That person is already a member of this project.";
  if (code === "FORBIDDEN" || code === "UNAUTHENTICATED") return "Your project access changed. Reloading access settings…";
  return "The member could not be added. Try again.";
}

function transferFailureMessage(status: number, code: string | undefined): string {
  if (code === "TRANSFER_BLOCKED_OPEN_TASKS") return "Reassign this developer’s open tasks before transferring the product manager role.";
  if (code === "TRANSFER_TARGET_NOT_DEVELOPER") return "Choose a current developer in this project.";
  if (code === "NOT_FOUND") return "The selected project member could not be found.";
  if (code === "GITHUB_USERNAME_AMBIGUOUS") return "More than one registered person matches that username.";
  if (code === "FORBIDDEN" || code === "UNAUTHENTICATED" || status === 401) return "Your project access changed. Reloading access settings…";
  return "The product manager role could not be transferred. Try again.";
}

async function responseCode(response: Response): Promise<string | undefined> {
  try {
    const body = await response.json() as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

export function MembersSettings({ projectId, members }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [selectedPerson, setSelectedPerson] = useState("");
  const [pendingAction, setPendingAction] = useState<"idle" | "adding" | "transferring">("idle");
  const [accessChanged, setAccessChanged] = useState(false);
  const [membersAwaitingAccessRefresh, setMembersAwaitingAccessRefresh] = useState<readonly ProjectMemberView[] | null>(null);
  const [message, setMessage] = useState("");
  const developers = members.filter((member) => member.role === "developer");
  const selected = developers.find((member) => member.personId === selectedPerson);
  const accessRefreshPending = membersAwaitingAccessRefresh === members;
  const controlsDisabled = accessChanged || accessRefreshPending;

  async function add(event: { preventDefault(): void }) {
    event.preventDefault();
    if (pendingAction !== "idle" || controlsDisabled) return;
    setPendingAction("adding");
    setMessage("");
    try {
      const response = await addProjectMember(projectId, username);
      if (!response.ok) {
        const code = await responseCode(response);
        setMessage(addFailureMessage(response.status, code));
        if (response.status === 404) {
          setMembersAwaitingAccessRefresh(members);
          router.refresh();
        } else if (response.status === 401 || response.status === 403) {
          setAccessChanged(true);
          router.refresh();
        }
        return;
      }
      setUsername("");
      setMessage("Member added. The list is refreshing.");
      router.refresh();
    } catch {
      setMessage("The member could not be added. Check your connection and try again.");
    } finally {
      setPendingAction("idle");
    }
  }

  async function transfer() {
    if (pendingAction !== "idle" || controlsDisabled || !selected) return;
    const confirmed = window.confirm(
      `Transfer product manager to ${selected.githubUsername}? ${selected.githubUsername} will become product manager, and you will become a developer.`,
    );
    if (!confirmed) return;
    setPendingAction("transferring");
    setMessage("");
    try {
      const response = await transferProjectManager(projectId, selected.githubUsername);
      if (!response.ok) {
        const code = await responseCode(response);
        setMessage(transferFailureMessage(response.status, code));
        if (response.status === 404) {
          setMembersAwaitingAccessRefresh(members);
          router.refresh();
        } else if (response.status === 401 || response.status === 403) {
          setAccessChanged(true);
          router.refresh();
        }
        return;
      }
      router.push(`/projects/${encodeURIComponent(projectId)}/board`);
      router.refresh();
    } catch {
      setMessage("The product manager role could not be transferred. Check your connection and try again.");
    } finally {
      setPendingAction("idle");
    }
  }

  return (
    <section aria-labelledby="project-members-heading" className="rounded-2xl border border-white/10 bg-[#222] p-6 shadow-xl sm:p-9">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-neutral-400">Project access</p>
        <h2 id="project-members-heading" className="mt-2 text-2xl font-semibold tracking-tight">Members</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-400">Manage who can work in this project and choose its product manager.</p>
      </div>
      <ul className="mt-6 divide-y divide-white/10 rounded-xl border border-white/10 bg-[#1d1d1d]">
        {members.map((member) => <li key={member.personId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="font-medium">{member.githubUsername}</span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-neutral-300">{member.role === "product_manager" ? "Product manager" : "Developer"}</span>
        </li>)}
      </ul>

      <form onSubmit={add} className="mt-8 border-t border-white/10 pt-7">
        <h3 className="font-semibold">Add member</h3>
        <p className="mt-1 text-sm text-neutral-400">Add a registered GitHub user as a developer.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="new-member-username">GitHub username</label>
          <input id="new-member-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" required
            placeholder="GitHub username" disabled={pendingAction !== "idle" || controlsDisabled}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#1a1a1a] px-3 text-sm text-neutral-100 outline-none focus:border-emerald-400 disabled:opacity-60" />
          <button type="submit" disabled={pendingAction !== "idle" || controlsDisabled} aria-busy={pendingAction === "adding"} className="min-h-11 rounded-lg bg-emerald-500 px-5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60">
            {pendingAction === "adding" ? "Adding member…" : "Add member"}
            {pendingAction === "adding" && <LoadingSpinner />}
          </button>
        </div>
      </form>

      <div className="mt-8 border-t border-white/10 pt-7">
        <h3 className="font-semibold">Transfer product manager</h3>
        <p className="mt-1 text-sm leading-6 text-neutral-400">Choose a current developer. They cannot take over while they have open tasks assigned to them.</p>
        {developers.length === 0 ? <p className="mt-4 text-sm text-neutral-400">Add a developer before transferring this role.</p> : <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="manager-transfer-target">Choose developer</label>
          <select id="manager-transfer-target" name="managerTarget" value={selectedPerson} onChange={(event) => setSelectedPerson(event.target.value)} disabled={pendingAction !== "idle" || controlsDisabled}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#1a1a1a] px-3 text-sm text-neutral-100 outline-none focus:border-emerald-400 disabled:opacity-60">
            <option value="">Choose a developer</option>
            {developers.map((member) => <option key={member.personId} value={member.personId}>{member.githubUsername}</option>)}
          </select>
          <button type="button" onClick={transfer} disabled={pendingAction !== "idle" || controlsDisabled || !selected} aria-busy={pendingAction === "transferring"} className="min-h-11 rounded-lg border border-white/15 px-5 text-sm font-semibold text-neutral-100 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50">
            {pendingAction === "transferring" ? "Transferring product manager…" : "Transfer product manager"}
            {pendingAction === "transferring" && <LoadingSpinner />}
          </button>
        </div>}
      </div>
      {message && <p role="status" aria-live="polite" className="mt-5 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-neutral-300">{message}</p>}
    </section>
  );
}
