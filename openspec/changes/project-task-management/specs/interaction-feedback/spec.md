# Spec Delta

## Purpose

Defines consistent loading feedback for actions and navigation across the application.

## ADDED Requirements

### Requirement: Pending actions show a trailing loading indicator
Every application control that starts an asynchronous request or navigation SHALL show an animated loading indicator to the right of its label while that work is in progress.

#### Scenario: An asynchronous action is pending
- **WHEN** a person starts an action that waits for a request to complete
- **THEN** the action shows a loading indicator after its text until the request resolves or fails
- **AND** existing pending-state behavior continues to prevent duplicate submissions

#### Scenario: An internal navigation begins
- **WHEN** a person follows an internal application link
- **THEN** the link shows a loading indicator after its text until the destination route is rendered
- **AND** opening the link in a new tab does not show a loading indicator on the current page

#### Scenario: A control acts immediately
- **WHEN** a person opens or closes a menu or dialog, edits local form state, or cancels an action without waiting for a request or navigation
- **THEN** the control does not show a loading indicator

### Requirement: Loading feedback respects accessibility preferences
The loading indicator SHALL not replace or obscure the action label, and its animation SHALL respect reduced-motion preferences.

#### Scenario: Reduced motion is enabled
- **WHEN** a person has requested reduced motion
- **THEN** the loading indicator remains visible without continuous animation
