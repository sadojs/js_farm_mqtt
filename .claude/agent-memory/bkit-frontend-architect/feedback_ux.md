---
name: UX Improvement Patterns Validated
description: Patterns used in the phase-3 UX improvement sprint (2026-03-27)
type: feedback
---

EmptyState component was extracted to `frontend/src/components/common/EmptyState.vue` with props: icon (SVG inner HTML string), title, description, actionLabel?, actionFn?. SVG icon passed as inner HTML string via v-html on an svg element.

notification.store was extended to add `centerItems` (NotificationCenterItem[]) alongside the existing toast `notifications`. The `add()` function now dual-writes to both. NotificationCenter.vue is a self-contained dropdown component.

**Why:** These patterns were implemented during the phase-3-mockup UX improvement task.
**How to apply:** Use EmptyState instead of raw empty-state divs. Extend notification.store (not create a new store) for bell/center functionality.
