# Spec Delta

## Purpose

Defines the Acceptance Criteria Check: the developer's AI feature, which assesses the commits attached to a task against each of the task's acceptance criteria before the work is submitted, and whose latest result is shown to the product manager during review.

## ADDED Requirements

### Requirement: Developer runs an acceptance criteria check
The system SHALL allow the assigned developer to run an AI check of the task's attached commits against each acceptance criterion. For each criterion the result SHALL give a status of addressed, not addressed, or unclear, with evidence quoted from the diff. The result SHALL also list possible gaps, such as missing tests or unhandled edge cases. The result SHALL NOT contain a numeric score.

#### Scenario: Developer runs the check
- **WHEN** an assigned developer runs the check on a task with attached commits
- **THEN** the developer sees, for every acceptance criterion, a status and the diff evidence for it, plus a list of possible gaps

#### Scenario: No commits attached
- **WHEN** a developer runs the check on a task with no attached commits
- **THEN** the system does not call the LLM and asks the developer to attach commits first

#### Scenario: Developer re-runs after changes
- **WHEN** the developer attaches different commits and runs the check again
- **THEN** a new result is produced for the new set of commits and becomes the latest result

### Requirement: Evidence is verified against the diff
The system SHALL verify that every quoted evidence line appears in the diff that was assessed. A criterion whose evidence cannot be verified SHALL be shown as unclear.

#### Scenario: Model quotes a line that is not in the diff
- **WHEN** the model returns evidence for a criterion that does not appear in the assessed diff
- **THEN** that criterion is shown as unclear and the unverified evidence is not displayed as fact

### Requirement: Check input is limited to what the assessment needs
The system SHALL send the model only the task's acceptance criteria and the filtered diff of the attached commits. Lockfiles, generated files, and binary files SHALL be excluded. When the filtered diff exceeds the input budget, the system SHALL assess what fits and list the files that were not assessed.

#### Scenario: Diff contains excluded files
- **WHEN** the attached commits change a lockfile and source files
- **THEN** only the source file changes are sent to the model

#### Scenario: Diff exceeds the input budget
- **WHEN** the filtered diff is larger than the input budget
- **THEN** the result lists the files that were not assessed

### Requirement: Check results are reused
The system SHALL reuse a stored result, without calling the LLM, when the check is requested again for the same set of commits and the same acceptance criteria.

#### Scenario: Same commits and criteria
- **WHEN** a check is requested for a commit set and criteria that already have a stored result
- **THEN** the stored result is returned and no LLM call is made

### Requirement: Latest check is shown to the product manager
The system SHALL attach the latest check result to a submission so the product manager can see it in review.

#### Scenario: Product manager reviews a submission
- **WHEN** the product manager opens a task in In Review
- **THEN** the latest check result is shown alongside the attached commits

### Requirement: AI check does not decide task completion
The system SHALL NOT use a check result to approve, reject, or change the state of a task.

#### Scenario: Check is generated
- **WHEN** the system generates a check result
- **THEN** the task state is unchanged
