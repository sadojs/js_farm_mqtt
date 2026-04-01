---
name: Smart Farm MQTT Frontend Architecture
description: Vue 3 + TypeScript SPA structure, design system, and key patterns
type: project
---

Stack: Vue 3 (Composition API) + TypeScript + Vite + Pinia + Vue Router

Design system uses CSS custom properties (var(--accent), var(--danger), var(--bg-card) etc.) defined in App.vue global `<style>`. Dark mode via `.theme-dark` class on `#app`.

Font size scaling: `--content-scale` variable with `.content-size-sm/md/lg` classes on `#app`.

Sidebar layout: desktop fixed sidebar (260px) + mobile drawer with hamburger. `.has-sidebar` class on `#app`.

Key stores: auth.store, device.store, group.store, automation.store, notification.store, sensor.store.

API layer: `frontend/src/api/client.ts` (axios wrapper) + domain-specific api files.

**Why:** Understanding this architecture is essential for any frontend changes.
**How to apply:** Always use existing CSS variables, follow store patterns, respect the sidebar/mobile layout structure.
