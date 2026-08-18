# Governance

This document describes how decisions are made in this project, who has authority
over what, and how the project can be transferred or forked if the maintainer
steps down.

## Status

**Active maintainer (BDFL):** [DCM91](https://github.com/DCM91)
**Model:** Benevolent Dictator For Life (BDFL)
**Last updated:** 2026

## Decision-making authority

### What the maintainer decides alone

The active maintainer has the final say on:

- Code merged into the `main` branch
- Releases and versioning
- License interpretation (the project is MIT-licensed; this document cannot change that, but the maintainer enforces it)
- Issue triage, feature prioritization, and roadmap
- Addition or removal of co-maintainers
- Enforcement of the [Code of Conduct](CODE_OF_CONDUCT.md)
- Response to takedown requests, legal inquiries, or abuse reports

### What requires community input

Major decisions that affect project direction or scope are opened for public
discussion via GitHub Issues before the maintainer takes a final decision:

- Breaking changes to the public API (e.g., `index.json` / `embeddings.bin` format versions)
- Removal of a major feature
- Changes to supported platforms or models
- Changes to the project's stated scope (BDO-only → multi-game, etc.)

Vocal minority veto power is **not** recognized. The maintainer weighs
feedback but is not bound by a vote.

## Co-maintainers

Co-maintainers are trusted contributors who have:

- **Merge rights** on `main` (via PR review-and-merge)
- **Triage rights** on issues
- **No unilateral authority** to release or change project scope

### How to become a co-maintainer

1. You submit regular, high-quality PRs over time (rule of thumb: 6+ months of
   consistent, substantive contributions, code or docs).
2. The active maintainer nominates you.
3. You explicitly accept the role.
4. You are added to the GitHub team with the appropriate permissions.

There is no application process. Co-maintainership is based on demonstrated
trust, not self-nomination.

### How co-maintainership ends

- Voluntary resignation (just let the BDFL know)
- Inactivity for 6+ months (the BDFL may ask if you want to stay)
- Removal by the BDFL for cause (e.g., Code of Conduct violation)

The BDFL is **not** required to publish reasons for removing a co-maintainer,
but typically will.

## Branch protection

The `main` branch is protected. The maintainer enforces (via GitHub settings):

- Pull requests are required for all changes.
- Direct pushes to `main` are rejected.
- At least one review approval is required (which may be the BDFL's own review
  for small changes they authored).
- Stale approvals are dismissed on new commits.
- Force pushes are rejected.
- The branch is the default branch.

## If the BDFL disappears

This is a real risk for single-maintainer projects. The policy:

1. **If the BDFL is inactive for 6+ months**, a co-maintainer (if any) may
   request a transfer of ownership through GitHub support.
2. **If no co-maintainers exist**, the project is effectively dead. Anyone is
   free to fork it under the MIT license; the fork is not "official" but is
   legally permitted.
3. **The BDFL may explicitly name a successor** by updating this file and
   transferring the GitHub repository.

There is no "automatic" succession. The MIT license makes forking trivial, so
project continuity does not depend on the BDFL's availability.

## Scope

This project is intentionally limited to:

- Being a **local-first** RAG chatbot for Black Desert Online.
- Scraping **publicly available** information from community / official sites.
- Running **entirely on the user's machine** (no servers, no telemetry, no
  accounts).

The project will **not** grow into:

- A hosted SaaS.
- A commercial product.
- A multi-game platform.
- A scraping service for other people's use.

If you want to build one of those, fork it under MIT — that's the deal.

## Changes to this document

The BDFL may update this document at any time. Substantive changes will be
mentioned in a release note.