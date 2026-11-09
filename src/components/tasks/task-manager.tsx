"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { validateTaskDraft, type TaskDraft } from "./task-management-input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PendingReloadButton } from "@/components/ui/pending-reload-button";

// Deliberately UI-owned projections, containing only the values these controls need.
type MemberChoice = Readonly<{ personId: string; githubUsername: string; role: string }>;
export type ManagedTask = Readonly<{
  id: string; taskKey: string; version: number; title: string; description: string;
  dueDate: string; branchName: string | null; assignee: Readonly<{ id: string; githubUsername: string }>;
  acceptanceCriteria: readonly Readonly<{ id: string; description: string }>[];
}>;
type Props = Readonly<{
  projectId: string; task?: ManagedTask; members: readonly MemberChoice[] | null;
  className?: string; expandedClassName?: string;
}>;
type Mode = "create" | "edit" | "reassign" | null;
const control = "min-h-11 rounded-lg border border-white/15 bg-[#1a1a1a] px-3 py-2 text-sm text-neutral-100 focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:opacity-50";
const buttonStyle = "min-h-11 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed";

function initialDraft(task?: ManagedTask): TaskDraft {
  return task ? { title: task.title, description: task.description, dueDate: task.dueDate, branchName: task.branchName ?? "", acceptanceCriteria: task.acceptanceCriteria.map(c => ({ id: c.id, description: c.description })) }
    : { title: "", description: "", dueDate: "", branchName: "", acceptanceCriteria: [{ description: "" }] };
}

/** PM-only host pages mount these controls; the existing routes enforce authorization again. */
export function TaskManager({ projectId, task, members, className, expandedClassName }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState<TaskDraft>(() => initialDraft(task));
  const [assigneeId, setAssigneeId] = useState(task?.assignee.id ?? "");
  const [formVersion, setFormVersion] = useState(task?.version);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<"save" | "delete" | null>(null);
  const [refreshing, startTransition] = useTransition();
  const inFlight = useRef(false);
  const snapshot = task ?? members;
  const [awaitingSnapshot, setAwaitingSnapshot] = useState<typeof snapshot | undefined>(undefined);
  const [uncertain, setUncertain] = useState(false);
  const disabled = busy || refreshing || uncertain || (awaitingSnapshot !== undefined && awaitingSnapshot === snapshot);
  const sectionClassName = [className ?? "my-6 rounded-2xl border border-white/10 bg-[#222] p-5 text-neutral-100",
    mode !== null ? expandedClassName : undefined].filter(Boolean).join(" ");
  const developers = members?.filter(member => member.role === "developer") ?? [];
  const choicesAvailable = members !== null && developers.length > 0;
  const boardUrl = `/projects/${encodeURIComponent(projectId)}/board`;
  const tasksUrl = `/api/v1/projects/${encodeURIComponent(projectId)}/tasks`;
  const taskUrl = `${tasksUrl}/${encodeURIComponent(task?.id ?? "")}`;

  function open(next: Exclude<Mode, null>) {
    if (disabled) return;
    setDraft(initialDraft(task)); setAssigneeId(task?.assignee.id ?? ""); setFormVersion(task?.version); setMessage(""); setMode(next);
  }
  function refresh() {
    setAwaitingSnapshot(snapshot);
    startTransition(() => router.refresh());
  }
  function refuseUncertain() {
    setMode(null); setUncertain(true);
    setMessage("The task request outcome could not be confirmed. Reload the page before trying again.");
  }

  async function send(url: string, method: string, body: object, expectedStatus: 200 | 201 | 204, success: (response: Response) => Promise<void>, action: "save" | "delete") {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setPendingAction(action); setMessage("");
    try {
      const response = await fetch(url, { method, cache: "no-store", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
      if (response.status === expectedStatus) { await success(response); return; }
      if (response.ok) { refuseUncertain(); return; }
      let code: unknown;
      try { const error = await response.json() as { error?: { code?: unknown } }; code = error.error?.code; } catch { /* Only status and known codes are presented. */ }
      if (response.status === 409 && code === "VERSION_CONFLICT") {
        setMessage("The task was changed by someone else. Reload and try again"); setMode(null); refresh();
      } else if (response.status === 403 || response.status === 401 || response.status === 404) {
        setMessage(response.status === 401 ? "Your session changed. Sign in again; reloading access." : "Your task access changed. Reload and try again.");
        setMode(null); refresh();
      } else if (response.status === 409 && code === "ASSIGNEE_NOT_DEVELOPER") {
        setMessage("The assignee must be a current developer in this project. Reload developer choices and choose again.");
      } else if (response.status === 400) {
        setMessage(code === "ACCEPTANCE_CRITERIA_REQUIRED" ? "At least one acceptance criterion is required." : "Check the task fields and acceptance criteria, then try again.");
      } else { refuseUncertain(); }
    } catch { refuseUncertain(); }
    finally { inFlight.current = false; setBusy(false); setPendingAction(null); }
  }

  async function save(event: { preventDefault(): void }) {
    event.preventDefault();
    if (disabled || inFlight.current || !mode) return;
    if (mode === "reassign") {
      if (!task || !developers.some(member => member.personId === assigneeId)) { setMessage("Choose a current developer in this project."); return; }
      await send(`${taskUrl}/assignee`, "PUT", { assigneeId, version: formVersion }, 200, async () => { setMode(null); setMessage("Assignment saved. Refreshing task."); refresh(); }, "save");
      return;
    }
    const error = validateTaskDraft(draft);
    if (error) { setMessage(error); return; }
    if (mode === "create" && !developers.some(member => member.personId === assigneeId)) { setMessage("Choose a current developer in this project."); return; }
    const fields = { title: draft.title.trim(), description: draft.description.trim(), dueDate: draft.dueDate, branchName: draft.branchName.trim() || null };
    if (mode === "create") {
      await send(tasksUrl, "POST", { ...fields, assigneeId, acceptanceCriteria: draft.acceptanceCriteria.map(c => c.description.trim()) }, 201, async response => {
        const created = await response.json() as { id?: unknown };
        if (typeof created.id !== "string" || !created.id) { refuseUncertain(); return; }
        setMode(null); setUncertain(true);
        router.push(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(created.id)}`); router.refresh();
      }, "save");
    } else if (task) {
      await send(taskUrl, "PATCH", { ...fields, version: formVersion, acceptanceCriteria: draft.acceptanceCriteria.map(c => ({ ...(c.id ? { id: c.id } : {}), description: c.description.trim() })) }, 200, async () => { setMode(null); setMessage("Task saved. Refreshing detail."); refresh(); }, "save");
    }
  }

  async function remove() {
    if (!task || disabled || inFlight.current) return;
    if (!window.confirm(`Delete ${task.taskKey}? This removes the task from the board.`)) return;
    await send(taskUrl, "DELETE", { version: task.version }, 204, async () => {
      setMode(null); setUncertain(true); router.push(boardUrl); router.refresh();
    }, "delete");
  }

  function field(name: "title" | "description" | "dueDate" | "branchName", label: string) {
    const props = { name, value: draft[name], disabled, onChange: (event: { target: { value: string } }) => setDraft({ ...draft, [name]: event.target.value }), className: control, required: name !== "branchName" };
    return <label className="grid gap-2 text-sm">{label}{name === "description" ? <textarea {...props} rows={4} /> : <input {...props} type={name === "dueDate" ? "date" : "text"} />}</label>;
  }
  const assignee = <label className="grid gap-2 text-sm">Assignee<select name="assigneeId" value={assigneeId} onChange={event => setAssigneeId(event.target.value)} disabled={disabled || !choicesAvailable} className={control} required>
    <option value="">Choose a developer</option>{developers.map(member => <option key={member.personId} value={member.personId}>{member.githubUsername}</option>)}
  </select></label>;

  return <section aria-label="Task management" className={sectionClassName}>
    <div className="flex flex-wrap gap-3">
      {task ? <><button type="button" className={buttonStyle} onClick={() => open("edit")} disabled={disabled}>Edit</button><button type="button" className={buttonStyle} onClick={() => open("reassign")} disabled={disabled || !choicesAvailable}>Reassign</button><button type="button" className={buttonStyle} onClick={remove} disabled={disabled} aria-busy={pendingAction === "delete"}>Delete{pendingAction === "delete" && <LoadingSpinner />}</button></>
        : <button type="button" className={buttonStyle} onClick={() => open("create")} disabled={disabled || !choicesAvailable}>New Task</button>}
    </div>
    {!choicesAvailable && <p className="mt-3 text-sm text-neutral-300">{members === null ? "Developer choices could not be loaded. Reload the page to try again." : "Add a developer in Settings before creating or reassigning a task."}</p>}
    {mode && <form onSubmit={save} noValidate className="mt-5 grid gap-4" aria-label={mode === "create" ? "New task" : mode === "edit" ? "Edit task" : "Reassign task"}>
      <h2 className="text-lg font-semibold">{mode === "create" ? "New task" : mode === "edit" ? `Edit ${task?.taskKey}` : `Reassign ${task?.taskKey}`}</h2>
      {mode !== "reassign" && <>{field("title", "Title")}{field("description", "Description")}{field("dueDate", "Due date")}{field("branchName", "Branch (optional)")}
        <fieldset className="grid gap-3"><legend className="mb-2 text-sm font-medium">Acceptance criteria (1–20, in order)</legend>
          {draft.acceptanceCriteria.map((criterion, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="grid gap-2 text-sm">Criterion {index + 1}<textarea name={`criterion-${index}`} value={criterion.description} disabled={disabled} rows={2} className={control} onChange={event => setDraft({ ...draft, acceptanceCriteria: draft.acceptanceCriteria.map((item, i) => i === index ? { ...item, description: event.target.value } : item) })} /></label>
            <button type="button" className={buttonStyle} disabled={disabled || draft.acceptanceCriteria.length <= 1} aria-label={`Remove criterion ${index + 1}`} onClick={() => setDraft({ ...draft, acceptanceCriteria: draft.acceptanceCriteria.filter((_, i) => i !== index) })}>Remove</button>
          </div>)}
          <button type="button" className={buttonStyle} disabled={disabled || draft.acceptanceCriteria.length >= 20} onClick={() => setDraft({ ...draft, acceptanceCriteria: [...draft.acceptanceCriteria, { description: "" }] })}>Add criterion</button>
        </fieldset></>}
      {mode !== "edit" && assignee}
      <div className="flex flex-wrap gap-3"><button type="submit" className={buttonStyle} disabled={disabled || (mode !== "edit" && !choicesAvailable)} aria-busy={pendingAction === "save"}>{busy ? "Saving…" : mode === "create" ? "Create task" : mode === "edit" ? "Save task" : "Save assignment"}{pendingAction === "save" && <LoadingSpinner />}</button><button type="button" className={buttonStyle} disabled={busy} onClick={() => { setMode(null); setDraft(initialDraft(task)); setMessage(""); }}>Cancel</button></div>
    </form>}
    {message && <p role="alert" aria-live="polite" className="mt-4 text-sm text-amber-200">{message}</p>}
    {uncertain && <PendingReloadButton className={`${buttonStyle} mt-3`}>Reload page</PendingReloadButton>}
  </section>;
}
