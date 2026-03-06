# Design Review: lovable.sammasak.dev

## Overview

This document captures the design review methodology applied to lovable.sammasak.dev and the specific decisions that came from it. It serves as a living reference so future contributors understand *why* the UI looks the way it does, and how to apply the same rigour when evolving it.

---

## Review Methodology

### The Skeptical Reviewer Model

A subagent was dispatched to evaluate the live site at `https://lovable.sammasak.dev` using Playwright. The reviewer's mandate was adversarial: assume nothing is good until proven otherwise. The reviewer applied the **frontend-design** skill criteria and compared the site against a curated set of premium developer-tool reference sites.

**Reference sites used as the design bar:**

| Site | Why it's the bar |
|------|-----------------|
| [Linear.app](https://linear.app) | Best-in-class typography, spatial rhythm, purposeful motion |
| [Vercel.com](https://vercel.com) | Ultra-clean dark theme, exceptional color restraint |
| [Raycast.com](https://raycast.com) | Strong visual personality, consistent design language |
| [Arc browser](https://arc.net) | Playful but premium, distinctive without being loud |
| [Liveblocks.io](https://liveblocks.io) | Developer-tool aesthetic, real polish at every detail level |

### Evaluation Categories

The reviewer assessed five dimensions:

1. **Typography distinctiveness** — Does the type feel considered? Is there a system?
2. **Color commitment** — Is there a real palette or just gray defaults?
3. **Motion craft** — Does anything move? Is the motion intentional?
4. **Spatial composition** — Does the layout breathe? Is there rhythm?
5. **Visual personality** — Would you recognize this product if the logo was removed?

---

## Findings: Before the Redesign

### Verdict

> "2017 Bootstrap admin panel with dark theme applied."

### Typography

**Finding:** `font-mono` applied globally to `body`. Monospace on prose text is illegible and signals that no typographic system was designed — a developer reached for the most "code-y" font available and stopped there.

**Specific issues:**
- Headings and body text in Courier-equivalent — zero hierarchy
- No letter-spacing on headings (missed −0.03em to −0.04em which creates premium feel)
- No font weight variation to create contrast between labels and values

### Color

**Finding:** Tailwind's default `gray-900` / `gray-800` / `gray-700` palette with `blue-600` as the single accent. This is the exact palette every developer's first dark-mode side project uses.

**Specific issues:**
- `blue-600` (#2563EB) is Tailwind's default blue — has zero distinctiveness, instantly recognizable as "unconfigured Tailwind"
- No palette *system* — colors chosen component-by-component with no governing logic
- `text-gray-600` used for body text fails WCAG AA contrast (3.5:1 vs required 4.5:1)
- Status badges were rounded pills with no character

### Motion

**Finding:** Zero motion. Nothing fades in, nothing slides, no hover transitions beyond color changes. The UI feels static and cheap.

**Specific issues:**
- Project cards appear instantly with no entrance animation
- Modal appears/disappears with no transition — jarring
- Status indicators are static colored dots — no pulse to suggest "alive"
- No micro-interactions on interactive elements

### Spatial Composition

**Finding:** Acceptable but unremarkable. Cards had insufficient internal padding. The home page had no focal point.

**Specific issues:**
- `px-4 py-3` card padding creates cramped content
- No gradient or visual hierarchy on the page background
- Header had no visual depth (no blur, no separation)

### Visual Personality

**Finding:** None. Remove the logo and you cannot identify what this product is or what tier it belongs to.

---

## Changes Made: After the Redesign

### Typography

**Solution:** Geist (sans) + Geist Mono (mono) from Google Fonts.

- Geist is Vercel's typeface — immediately signals "serious developer tooling"
- Body, headings, UI labels: `var(--font-sans)` (Geist)
- Code blocks, activity feed, status badges, form inputs: `var(--font-mono)` (Geist Mono)
- Heading `letter-spacing: -0.03em` to `-0.04em` — the hallmark of premium SaaS typography
- Font weight axis used deliberately: 300 (light) → 700 (bold) for hierarchy

```html
<!-- In app.html <head> -->
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

```css
/* In app.css */
:root {
  --font-sans: 'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'ui-monospace', monospace;
}
body { font-family: var(--font-sans); }
code, pre, .badge, input, textarea { font-family: var(--font-mono); }
```

### Color

**Solution:** A committed palette replacing all Tailwind gray defaults.

| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#080B14` | Page background |
| `--color-surface` | `#0E1422` | Cards, sidebars |
| `--color-surface-2` | `#141927` | Hover state, modals |
| `--color-border` | `rgba(255,255,255,0.07)` | All borders |
| `--color-border-accent` | `rgba(99,102,241,0.3)` | Focused/active borders |
| `--color-text-primary` | `#F0F2FF` | Headings, primary text |
| `--color-text-secondary` | `#8B91A8` | Labels, subtitles |
| `--color-text-muted` | `#4A5068` | Timestamps, metadata |
| `--color-accent` | `#6366F1` | CTAs, highlights (indigo) |
| `--color-accent-glow` | `rgba(99,102,241,0.15)` | Glow effects |
| `--color-success` | `#10B981` | Running status |
| `--color-success-dim` | `rgba(16,185,129,0.12)` | Badge backgrounds |

**Why indigo (`#6366F1`) over blue (`#2563EB`):** Indigo sits between blue and purple — it reads as technical but warmer than pure blue. It's distinctive from Tailwind's default blue while remaining recognizable as a "cool" developer accent.

**Home page gradient mesh:**
```css
background-image:
  radial-gradient(ellipse 800px 600px at 20% -10%, rgba(99,102,241,0.08) 0%, transparent 60%),
  radial-gradient(ellipse 600px 400px at 80% 110%, rgba(16,185,129,0.05) 0%, transparent 50%);
```
This creates a subtle atmospheric depth — indigo bleeds in from top-left, emerald from bottom-right. The eye perceives "considered design" even if it can't articulate why.

### Motion

**Solution:** Three targeted animations, each with a specific job.

**1. `fadeSlideUp` — Project card entrance**
```css
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
```
Cards stagger via `animation-delay: calc(var(--i, 0) * 50ms)` — first card appears, then second, then third. Creates the perception of the UI "loading in" rather than snapping.

**2. `modalIn` — Modal entrance**
```css
@keyframes modalIn {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
```
The 4% scale + 8px translate creates a "surfacing" motion that feels physical without being overdone.

**3. `pulse` — Status dot heartbeat**
```css
@keyframes pulse {
  0%, 100% { opacity: 0; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(1.8); }
}
```
Applied via `::before` pseudo-element on `.status-badge .dot`. The dot for a running VM literally pulses, communicating liveness.

**4. Animated gradient border on project cards (premium effect)**
```css
@property --angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
@keyframes spin { to { --angle: 360deg; } }

.project-card::before {
  background: conic-gradient(from var(--angle), transparent 0%, #6366F1 30%, transparent 60%);
  animation: spin 4s linear infinite;
  opacity: 0;
  transition: opacity 0.3s;
}
.project-card:hover::before { opacity: 1; }
```
On hover, an indigo glow rotates around the card border using `@property` for animated CSS custom properties. This is a CSS-only technique that reads as premium without JS.

### Spatial Composition

**Header:** `backdrop-filter: blur(12px) saturate(180%)` with `rgba(8,11,20,0.7)` background. As content scrolls under, the header glass-blurs it — creates depth and separation. Used as `position: sticky` so it stays visible.

**Cards:** `padding: 16px 20px` (up from `px-4 py-3`), `border-radius: 12px` for a modern feel without looking bubbly.

### Visual Personality

The combined effect of the indigo accent, Geist typeface, gradient mesh background, and animated card borders creates a recognizable design language: **dense, technical, indigo-forward**. It shares a visual family with Linear and Vercel without copying either.

---

## How to Run a Design Review in the Future

### Step 1: Dispatch the skeptical reviewer

Use the **frontend-design** skill. Prompt:

```
Use the frontend-design skill to review https://<your-app>.sammasak.dev.
Compare it against Linear.app, Vercel.com, Raycast.com, Raycast.com, and Liveblocks.io.
Evaluate: typography distinctiveness, color commitment, motion craft, spatial composition, visual personality.
Be adversarial — assume nothing is good until proven otherwise.
Produce a concrete redesign prescription with exact font names, color hex values, animation keyframe specs, and component-level instructions.
Do not produce vague guidance. Every suggestion must be implementable.
```

### Step 2: Turn the prescription into a goal

Post the prescription as a goal to the claude-worker VM:

```bash
curl -X POST http://<vm-ip>:4200/goals \
  -H 'Content-Type: application/json' \
  -d '{"goal": "<paste the prescription here>"}'
```

### Step 3: Verify with Playwright

After the redesign is deployed:

```
Use the e2e-testing skill and Playwright to verify https://<your-app>.sammasak.dev.
Check: (1) Geist fonts are loaded, (2) CSS stylesheet is present and >10kB, (3) dark background color is applied, (4) the New Project button is visible and styled.
```

### Design Review Checklist

Before shipping any significant UI change, run through:

- [ ] **Typography:** Is there a distinct typeface? Is monospace confined to code/labels?
- [ ] **Heading letter-spacing:** Are headings using `letter-spacing: -0.02em` to `-0.04em`?
- [ ] **Color:** Has the palette been defined as CSS custom properties? No raw Tailwind gray defaults?
- [ ] **Accent distinctiveness:** Is the accent color something other than `blue-600`?
- [ ] **Motion:** Do list items fade in? Does the modal animate? Do status indicators pulse?
- [ ] **Contrast:** Does all body text pass WCAG AA (4.5:1)?
- [ ] **Hover states:** Do interactive elements have transitions, not just color snaps?
- [ ] **Background depth:** Is the page background flat or does it have gradient depth?
- [ ] **Empty states:** Are loading and empty states designed, not just text?
- [ ] **Personality test:** Remove the logo. Can you still tell what kind of product this is?

---

## Design Token Reference

All tokens live in `src/app.css` under `:root`. Modify here to retheme the entire app:

```css
:root {
  /* Typography */
  --font-sans: 'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'ui-monospace', monospace;

  /* Backgrounds */
  --color-bg:        #080B14;   /* page background */
  --color-surface:   #0E1422;   /* cards, panels */
  --color-surface-2: #141927;   /* hover state, modals */

  /* Borders */
  --color-border:        rgba(255,255,255,0.07);
  --color-border-accent: rgba(99,102,241,0.3);

  /* Text */
  --color-text-primary:   #F0F2FF;
  --color-text-secondary: #8B91A8;
  --color-text-muted:     #4A5068;

  /* Accent (indigo) */
  --color-accent:      #6366F1;
  --color-accent-glow: rgba(99,102,241,0.15);

  /* Success (emerald) */
  --color-success:     #10B981;
  --color-success-dim: rgba(16,185,129,0.12);
}
```

To switch accent color (e.g. to violet): change `--color-accent` to `#7C3AED` and update the glow/border-accent rgba values proportionally.

---

*Generated by claude-worker-agent — 2026-03-05*
