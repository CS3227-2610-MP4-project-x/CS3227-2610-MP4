# Spec Delta

## Purpose

Defines the product manager's daily view of project progress using developer-submitted task updates and GitHub activity within the agreed shared Singapore Time reporting window.

## ADDED Requirements

### Requirement: Daily report summarizes project activity
The system SHALL provide the project's product manager a daily report summarizing developer-submitted task updates and GitHub activity for the project.

#### Scenario: Product manager views the daily report
- **WHEN** the product manager requests a daily report for a project
- **THEN** the report summarizes that project's developer-submitted task updates and GitHub activity for the reporting window

### Requirement: Daily report uses the shared SGT window
The system SHALL define each daily report's activity window as 8:00am through 6:00pm Singapore Time (SGT, UTC+08:00), using the same timezone for all projects.

#### Scenario: Activity falls within the reporting window
- **WHEN** task-update or GitHub activity occurs during the project's reporting date between 8:00am and 6:00pm SGT
- **THEN** the activity is eligible for that date's daily report

#### Scenario: Activity falls outside the reporting window
- **WHEN** task-update or GitHub activity occurs outside the project's reporting date window
- **THEN** the activity is not included in that date's daily report
