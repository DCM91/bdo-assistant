# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Send a private report to the BDFL via GitHub's [private vulnerability reporting
feature](https://github.com/DCM91/bdo-assistant/security/advisories/new) (if
enabled) or, failing that, by contacting the maintainer through the GitHub
profile linked in [GOVERNANCE.md](GOVERNANCE.md).

Please include:

- A clear description of the issue
- Steps to reproduce
- The severity you assess (information disclosure / RCE / denial of service / etc.)
- Any suggested fix (optional but appreciated)

You can expect:

- An acknowledgment within **7 days**.
- A status update within **30 days** of acknowledgment.
- A fix or a clear explanation of why the report will not be acted on within
  **90 days** for accepted issues.

## Scope

The following are in scope:

- The Electron app (main process, preload, renderer)
- The scraper, RAG pipeline, and Ollama client
- Scripts in `scripts/` and the build configuration
- Anything that runs on the user's machine with user permissions

The following are **out of scope**:

- Vulnerabilities in **Ollama itself** (please report to the Ollama project)
- Vulnerabilities in **Electron** itself (please report to the Electron project)
- Vulnerabilities in **Google Chrome** (please report to Google)
- Vulnerabilities in user-installed models or system dependencies

## What I will NOT do

- I will not threaten legal action against security researchers acting in good
  faith.
- I will not publish your name without your consent if you ask to remain
  anonymous.
- I will not delay acknowledging a report as a tactic.

## Disclosure policy

This is a small, single-maintainer project. I follow a **coordinated disclosure**
model:

1. You report privately.
2. I acknowledge and triage.
3. We agree on a fix timeline (usually 30–90 days, depending on severity).
4. I release a fix.
5. After the fix is public, I publish a brief advisory in the GitHub
   [Security tab](https://github.com/DCM91/bdo-assistant/security) with:
   - Affected versions
   - Fixed version
   - Brief description
   - Credit to the reporter (unless they prefer anonymity)

If you believe a vulnerability is being actively exploited in the wild, please
say so in the report and I will prioritize accordingly.

## Scope of data the app handles

For context when assessing impact:

- The app is **local-only**. No data is sent to remote servers.
- The app scrapes public web pages (with the user's consent) and stores the
  text locally.
- The app embeds the text via Ollama (running locally) and stores the
  embeddings locally.
- The app sends queries to Ollama (running locally) and renders the
  responses locally.
- The only outbound network calls are:
  - To the scraper's target sites (garmoth.com, naeu.playblackdesert.com) when the user clicks 🔄 Re-scrape
  - To Ollama at `http://localhost:11434` (default)

If you find a vulnerability that bypasses this (e.g., exfiltrating data to a
remote host), that is a critical issue and should be reported immediately.

## Hall of fame

Researchers who have reported valid vulnerabilities will be listed here (with
their permission) once the first one is fixed.