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

The v2 REST API exposes comments as two lists, `/pages/{id}/footer-comments` and `/pages/{id}/inline-comments` (cursor-paged through `_links.next`, up to 100 per page). Each list returns top-level comments only. Replies come from `/footer-comments/{id}/children` or `/inline-comments/{id}/children`, one call per comment, and a reply can itself have children. Authors arrive as account ids, resolved to display names through `POST /users-bulk`, which accepts at most 250 ids per call. A comment's `version` is its latest edit, so an edited comment reports its last editor and edit date. The original author and date come from `/{location}-comments/{id}/versions/1`.

The v1 API's `/content/{id}/child/comment` with `depth=all` returns footer and inline comments, their replies, author display names, resolution status, and the inline selection in one paged response. It is deprecated. Live responses on 2026-09-22 carried `deprecation: Wed, 1 Mar 2023` and `warning: 299 - "Deprecated API, will be removed on Mon, 31 Mar 2025"`, with a link to changelog CHANGE-864. The removal date has passed and the endpoint still answers, but it can be withdrawn at any time.

Reading in v2 costs more calls than v1. A page with T top-level comments, R replies, E edited comments and U distinct authors takes 2 list calls (more when a list exceeds 100), T + R `children` calls, E `versions/1` calls, and ⌈U / 250⌉ `users-bulk` calls. v1 takes one call. On the reference page (6 footer and 17 inline top-level comments, one reply, two edited) that is 29 calls against 1.

## Decision

Two operations on `manage_confluence_page`, following the operation-dispatch surface of ADR-101. Comment reads and writes both use the v2 API.

- **`get_comments`** lists footer and inline comments through v2, walks reply threads breadth-first through the `children` endpoints until no new replies appear, fetches `versions/1` for any comment whose version number is above 1 so the author and date are the original poster's, and resolves every distinct author id in one `users-bulk` call per 250 ids. The per-comment calls (`children`, `versions/1`) run at most 5 in flight to stay clear of rate limits. A list walk stops on an empty page even if `_links.next` is set, so a bad cursor cannot loop. If `users-bulk` fails, authors show as account ids and the read still succeeds. The client maps each result to a `PageComment` with a `location` (replies inherit their thread's), an optional `parentId` from `parentCommentId`, the author's display name, the parsed ADF body, the resolution status, and the inline selection from the `inlineOriginalSelection` property. The handler renders bodies through the content layer and the rendering facade (ADR-500) prints footer and inline sections, each threaded with numbered labels and indented replies. Inline comments quote their original selection and show a non-open resolution status.
- **`add_comment`** takes a markdown `body`, runs it through the same directive parser and ADF serializer that page submit uses, and posts to the v2 `/footer-comments` endpoint. With a `parentCommentId` the handler first reads the page's comments to find the parent's location and posts to the matching v2 endpoint, so replies to inline comments stay on their inline thread.

The extra read calls are accepted over a single call to a v1 endpoint past its announced removal date. The fan-out grows with thread count, and comment volume on a page is small next to the rate limit. If v1 is withdrawn, a v1 read would fail outright.

## Consequences

- Comment authoring takes a plain `body` string. The scratchpad (ADR-301, ADR-304) is for line-addressed editing of a page body, and a comment is short enough to arrive whole.
- A reply costs a full comment read to locate its parent, which under v2 is the fan-out described above. That read also validates the parent exists on the page.
- Author names on `add_comment` responses are account ids, since v2 returns no display name. The handler reports only the new comment id.
- Resolving or deleting comments is out of scope. Both are v2 operations that can be added on the same `PageComment` model.
