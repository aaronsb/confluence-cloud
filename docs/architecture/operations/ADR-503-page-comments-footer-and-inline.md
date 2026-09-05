---
status: Draft
date: 2026-09-04
deciders:
  - aaronsb
related:
  - ADR-101
  - ADR-200
  - ADR-500
  - ADR-501
---

# ADR-503: Page Comments — Footer and Inline

## Context

The server had no way to read or write comments. A page's discussion lives in two places on Confluence Cloud: footer comments under the body, and inline comments anchored to a text selection. Both thread through replies, and inline comments carry a resolution status. An agent asked to summarise review feedback or answer a reviewer could see the page but none of the conversation around it.

The v2 REST API exposes comments as two lists, `/pages/{id}/footer-comments` and `/pages/{id}/inline-comments`. Each list returns top-level comments only, replies come from a further call per thread, and authors arrive as account ids that need a separate user lookup. Reading one page's discussion is therefore three or more round trips before names resolve.

The v1 API's `/content/{id}/child/comment` with `depth=all` returns footer and inline comments, their replies, author display names, resolution status, and the inline selection in a single paged response.

## Decision

Two operations on `manage_confluence_page`, following the operation-dispatch surface of ADR-101:

- **`get_comments`** reads every comment on a page through the v1 endpoint. The client maps each result to a `PageComment` with a `location`, an optional `parentId` taken from the last ancestor, the author's display name, and the parsed ADF body. The handler renders bodies through the content layer and the rendering facade (ADR-500) prints footer and inline sections, each threaded with numbered labels and indented replies. Inline comments quote their original selection and show a non-open resolution status.
- **`add_comment`** takes a markdown `body`, runs it through the same directive parser and ADF serializer that page submit uses, and posts to the v2 `/footer-comments` endpoint. With a `parentCommentId` the handler first reads the page's comments to find the parent's location and posts to the matching v2 endpoint, so replies to inline comments stay on their inline thread.

Reads go to v1 and writes to v2 for the same reason labels split the other way in ADR-501: each API is used where it answers in one call.

## Consequences

- Comment authoring takes a plain `body` string. The scratchpad (ADR-301, ADR-304) is for line-addressed editing of a page body, and a comment is short enough to arrive whole.
- A reply costs one extra read to locate its parent. That read also validates the parent exists on the page.
- Author names on `add_comment` responses are account ids, since v2 returns no display name. The handler reports only the new comment id.
- Resolving or deleting comments is out of scope. Both are v2 operations that can be added on the same `PageComment` model.
