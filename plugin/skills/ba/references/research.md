# `.verid/research.md` format

What the project is and why, before the spec says what it must do. Keep each section
short; write "none" rather than leave one out. Cite a source for each fact: a file in
`.verid/docs/` (with section or page), a Clarification, or code as `path:line`.

# Research: <project>

## Problem

Who has which problem today, and what it costs them. One paragraph.

## Users

Each kind of user, what they need from the product, and how many there are if known.

## Goals and completion signals

What success looks like, as signals someone can check: "a clerk closes an order in
under a minute", not "fast checkout".

## Evidence

The documents, code and conversations this research rests on, one line each, with what
each one settled.

## Scope

In scope and out of scope, as two short lists. Anything unclear goes to Open questions.

## Constraints and assumptions

Technical, legal, budget and time limits, then assumptions with how to check each one.

## Risks

| Risk | Impact | Likelihood | Mitigation |
| :--- | :----- | :--------- | :--------- |

## Screens

The screens users see, one line each (name: purpose). The plan draws the changed ones.

## Suggested modules

A first cut of the work in delivery slices, one line each; verid:design settles them.

## Glossary

The domain terms the team and the code share, one line each.

## Decisions

Each decision the developer made, with the date and the reason.

## Open questions

`[NEEDS CLARIFICATION: <question>]` lines still to ask, one at a time.

## Clarifications

Each question asked and the developer's answer, as `Q<n>: … → A: …`, never rewritten.
