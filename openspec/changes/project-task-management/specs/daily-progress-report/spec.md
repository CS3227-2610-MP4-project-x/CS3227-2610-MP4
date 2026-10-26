# Spec Delta

## Purpose

Defines the Progress Report: the product manager's AI feature, which summarizes a project's activity for a chosen date range (by default, the current day) from structured task activity and commit metadata.

## ADDED Requirements

### Requirement: Product manager generates a progress report
The system SHALL allow a project's product manager to generate a progress report for a date range. The range SHALL default to the current day, 00:00 to 23:59 Singapore Time (SGT, UTC+08:00), and SGT SHALL be used for every project. The report SHALL summarize, per developer, the tasks completed, submitted for review, and in progress, and SHALL list tasks that are overdue or have had changes requested more than once.

#### Scenario: Product manager views today's report
- **WHEN** the product manager generates a report without choosing a range
- **THEN** the report covers the current SGT day

#### Scenario: Product manager chooses a range
- **WHEN** the product manager generates a report for a chosen date range
- **THEN** only activity within that range is included

#### Scenario: Activity late in the day
- **WHEN** a developer pushes a commit at 11:30pm SGT
- **THEN** the commit is included in that day's report

### Requirement: Report statements cite tasks
Every statement in the report SHALL cite the IDs of the tasks it is based on, and every cited ID SHALL belong to the project.

#### Scenario: Report cites its sources
- **WHEN** a report is generated
- **THEN** each statement shows the task IDs it is based on

#### Scenario: Model cites an unknown task
- **WHEN** the model output cites a task ID that is not in the project
- **THEN** the statement is not shown as fact

### Requirement: Report input is structured activity
The system SHALL build the report from structured activity only: task state changes, progress updates, submissions, criteria check results, review feedback, and commit metadata such as messages and timestamps. The system SHALL NOT send source code diffs to the model for the report.

#### Scenario: Report input excludes diffs
- **WHEN** the system prepares the report input
- **THEN** the input contains no diff content

#### Scenario: No activity in range
- **WHEN** there is no activity in the selected range
- **THEN** the system reports that there was no activity without calling the LLM

### Requirement: Report size is limited
The system SHALL refuse a report range longer than 7 days. When the activity in a range exceeds the report input budget, the system SHALL refuse to generate the report without calling the LLM and SHALL ask the product manager to choose a shorter range. The system SHALL NOT silently drop activity to fit the budget.

#### Scenario: Range longer than 7 days
- **WHEN** the product manager requests a report for a range longer than 7 days
- **THEN** the system refuses the request and states the 7-day limit

#### Scenario: Activity exceeds the input budget
- **WHEN** the activity in the chosen range is larger than the report input budget
- **THEN** no LLM call is made and the product manager is asked to choose a shorter range

### Requirement: Reports are reused until new activity arrives
The system SHALL reuse a stored report for the same project and date range, without calling the LLM, until new activity in that range is recorded.

#### Scenario: Report requested again
- **WHEN** the product manager requests a report for a project and range with no new activity since the stored report
- **THEN** the stored report is returned and no LLM call is made

### Requirement: Report access is limited to the product manager
The system SHALL allow only the project's product manager to generate or view its progress reports.

#### Scenario: Developer requests a report
- **WHEN** a developer requests a progress report
- **THEN** the system refuses the request

### Requirement: Unavailable evidence is shown in the report
The system SHALL state in the report when GitHub evidence for the range was unavailable, rather than implying no work occurred.

#### Scenario: GitHub unavailable during report generation
- **WHEN** commit metadata cannot be retrieved for the range
- **THEN** the report states that GitHub evidence was unavailable
