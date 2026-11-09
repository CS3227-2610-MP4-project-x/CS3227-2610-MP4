/** Browser form values only; the existing server contract remains authoritative. */
export type TaskDraft = {
  title: string; description: string; dueDate: string; branchName: string;
  acceptanceCriteria: { id?: string; description: string }[];
};
function length(value: string): number { return [...value.trim()].length; }
export function validateTaskDraft(draft: TaskDraft): string {
  if (length(draft.title) < 1 || length(draft.title) > 200 || /[\r\n]/.test(draft.title.trim())) return "Enter a title of 1–200 characters without line breaks.";
  if (length(draft.description) < 1 || length(draft.description) > 5000) return "Enter a description of 1–5,000 characters.";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.dueDate);
  if (!match) return "Choose a real due date.";
  const [year, month, day] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (!year || month < 1 || month > 12 || day < 1 || day > days) return "Choose a real due date.";
  const branch = draft.branchName.trim();
  if (branch && (length(branch) > 255 || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..") || branch.includes("//") || /^[/-]/.test(branch) || /(?:\/|\.|\.lock)$/.test(branch))) return "Enter a valid branch name, or leave it blank.";
  if (draft.acceptanceCriteria.length < 1 || draft.acceptanceCriteria.length > 20) return "Provide 1–20 acceptance criteria.";
  if (draft.acceptanceCriteria.some(c => length(c.description) < 1 || length(c.description) > 500)) return "Each acceptance criterion needs 1–500 characters.";
  return "";
}
