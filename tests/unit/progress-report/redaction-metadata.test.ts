import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { prepareReportInput, validateReportStatements, type ReportSnapshot } from '@/server/progress-report';
import { ids, inputText, range, statement } from './generation-fixtures';

const actor = { personId: ids.developer, githubUsername: 'synthetic-developer' };
const secret = 'ghp_' + 'a'.repeat(36);
function snapshot(body: string): ReportSnapshot {
  return { projectId: ids.project, repository: null, tasks: [{ taskId: ids.task, taskKey: 'SYN-1', title: 'Safe title', currentAssignee: actor, status: 'in_progress', dueDate: '2026-11-30', requestChangesCount: 0 }],
    activity: [{ taskId: ids.task, taskKey: 'SYN-1', type: 'progress_update', sourceId: 'synthetic-update', occurredAt: '2026-11-09T01:00:00.000Z', actor, payload: { body } }], attachedCommits: [] };
}
function prepare(value: ReportSnapshot) {
  const result = prepareReportInput({ range, snapshot: value, metadata: { kind: 'available', commits: [] } });
  if (result.kind !== 'ready') throw new Error('Expected synthetic ready input');
  return result;
}
describe('D9 structured-input redaction metadata', () => {
  it('counts the assignee username in its group and both serialized task contexts', () => {
    const value = snapshot('Safe update');
    const assignee = { personId: ids.developer, githubUsername: secret };
    const input: ReportSnapshot = { ...value,
      tasks: [
        { ...value.tasks[0], currentAssignee: assignee },
        { ...value.tasks[0], taskId: ids.otherTask, taskKey: 'SYN-2', currentAssignee: assignee },
      ],
      activity: [{ ...value.activity[0], actor: null }],
    };
    const result = prepare(input);
    expect(result.redaction).toEqual({ occurred: true, replacementCount: 3 });
    expect(result.inputText).not.toContain(secret);
    const groups = JSON.parse(result.inputText).currentTaskContext.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[0].currentAssignee.githubUsername).toBe(groups[0].tasks[0].currentAssignee.githubUsername);
    expect(groups[0].tasks[1].currentAssignee.githubUsername).toBe(groups[0].currentAssignee.githubUsername);
  });
  it('counts each actual replacement before escaping and keeps secrets out of input and metadata', () => {
    const result = prepare(snapshot(`before ${secret} and ${secret} after & <data>`));
    expect(result.redaction).toEqual({ occurred: true, replacementCount: 2 });
    expect(result.inputText).not.toContain(secret);
    expect(result.inputText).not.toContain('<data>');
    expect(JSON.stringify(result.redaction)).not.toContain(secret);
  });
  it('keeps metadata zero when an earlier criteria check merely has a redacted flag', () => {
    const value = snapshot('Safe update');
    const input: ReportSnapshot = { ...value, activity: [{ ...value.activity[0], type: 'criteria_check', payload: { resultId: 'synthetic-check', createdAt: '2026-11-09T01:00:00.000Z', model: 'synthetic-model', anchorSha: 'a'.repeat(40), redacted: true, criteria: [], gapCount: 0, omissionCount: 0 } }] };
    expect(prepare(input).redaction).toEqual({ occurred: false, replacementCount: 0 });
  });
  it('counts a commit message once for each actual serialized task association', () => {
    const value = snapshot('Safe update');
    const sha = 'a'.repeat(40);
    const input: ReportSnapshot = { ...value, attachedCommits: [ids.task, ids.otherTask].map(taskId => ({ taskId, taskKey: taskId === ids.task ? 'SYN-1' : 'SYN-2', sha, attachedAt: '2026-11-09T02:00:00.000Z' })) };
    const result = prepareReportInput({ range, snapshot: input, metadata: { kind: 'available', commits: [{ sha, authoredAt: '2026-11-09T01:00:00.000Z', message: secret, author: { githubUsername: 'synthetic-developer' } }] } });
    expect(result).toMatchObject({ kind: 'ready', redaction: { occurred: true, replacementCount: 2 } });
  });
  it('changes fingerprint when identical sanitized input has a different verified count', () => {
    const first = prepare(snapshot(secret));
    const sanitizedBody = JSON.parse(first.inputText).activity[0].payload.body as string;
    const second = prepare(snapshot(sanitizedBody));
    expect(first.inputText).toBe(second.inputText);
    expect(first.redaction).toEqual({ occurred: true, replacementCount: 1 });
    expect(second.redaction).toEqual({ occurred: false, replacementCount: 0 });
    expect(first.inputFingerprint).not.toBe(second.inputFingerprint);
  });
  it('returns deterministic known zero metadata for empty input without counting unused context', () => {
    const value = snapshot('Unused');
    const input: ReportSnapshot = { ...value, tasks: [{ ...value.tasks[0], title: secret }], activity: [] };
    expect(prepareReportInput({ range, snapshot: input, metadata: { kind: 'available', commits: [] } })).toEqual({ kind: 'empty', range, redaction: { occurred: false, replacementCount: 0 } });
  });
  it('rejects model-supplied metadata through the existing strict output envelope', () => {
    expect(validateReportStatements({ statements: [statement], redaction: { occurred: false, replacementCount: 0 } }, inputText())).toEqual({ ok: false });
    expect(validateReportStatements({ statements: [{ ...statement, redaction: { occurred: true, replacementCount: 2 } }] }, inputText())).toEqual({ ok: false });
  });
});
