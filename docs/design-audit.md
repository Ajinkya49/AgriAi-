# Agri AI — design audit against the rural-first brief

Audited at **390 × 844** (the phone width this audience actually uses), on the
running app, with the brief's numbers **measured in the DOM** rather than judged
from screenshots.

Screens covered: Home (`/dashboard`), Crop photo (`/upload`), Diagnosis result,
Assistant, Community, Profile, Settings.

> **Two things are unresolved before any of this can be implemented.** See
> *Open questions* at the end — one of them changes every colour value below.

---

## 1. Measured compliance

| Screen | Targets | < 48dp | < 44px | Body text | Sticky CTA | Lang toggle | Timestamp |
|---|---|---|---|---|---|---|---|
| Home | 13 | 0 | **0** | **14px** | no | no | no |
| Crop photo | 7 | 1 | 0 | 16px | no | no | no |
| Community | 56 | 26 | 0 | 16px | no | no | no |
| Assistant | 12 | 3 | 0 | **14px** | no | yes | no |
| Profile | 7 | 2 | 0 | 16px | no | no | no |
| Settings | 20 | 14 | 0 | 16px | no | no | no |

**Good news first:** nothing is below 44px. The tap-target floor held. The
loading / empty / error states exist on every route. The diagnosis screen already
shows an absolute timestamp and the model version — better provenance than the
brief asks for.

**The gap:** the brief specifies **48dp** and the app uses **44px**. Every one of
the 46 sub-48 targets is exactly 44. This is a single token, not 46 fixes.

```css
/* frontend/app/globals.css */
--spacing-tap: 44px;   /* → 48px */
```

That one line moves the whole app into compliance. It will also change
`ui-audit.mjs`'s assertion, which currently pins 44px.

---

## 2. 🔴 Critical — these block the task

### 2.1 Home has no primary action

The main job is "photograph a sick plant and find out what it is". Home shows a
list of *past* results and **no way to start**. The only entry point is the
`Upload` tab.

Two problems compound:

- A farmer must infer that "Upload" is how you take a photo. **"Upload" is
  jargon** — the brief's own rule is फसल डॉक्टर, not Disease Classification.
- Nothing on Home is in the thumb zone for a one-handed grip.

**Fix.** A full-width, sticky primary action at the bottom of Home:

```html
<!-- above the bottom nav, sticky, safe-area aware -->
<button class="cta-primary">
  <Camera /> फोटो लें / Take a photo
</button>
```

```css
.cta-primary {
  position: sticky;
  bottom: var(--app-nav-height);
  width: 100%;
  min-height: 56px;              /* above the 48dp floor, it is THE action */
  border-radius: 16px;
  background: #2E7D32;           /* or the violet accent, depending on §5 */
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  display: flex; align-items: center; justify-content: center; gap: 10px;
}
```

### 2.2 The crop picker offers 12 crops; the model can diagnose 3

This is the most serious finding in the audit, and it is worse than it first looks.

`frontend/lib/validation/auth.ts` offers these twelve options in onboarding and
settings:

```
Tomato · Wheat · Potato · Rice · Maize · Onion · Brinjal · Chilli · Cotton ·
Sugarcane · Groundnut · Soybean
```

`backend/app/models/labels.py` has ten classes across **three** crops:

```
Tomato · Potato · Pepper
```

So:

- **Nine of the twelve offered crops cannot be diagnosed at all.** A farmer who
  selects Rice photographs a rice leaf and the model returns one of its ten
  trained classes — a tomato, potato or pepper disease. Confidently wrong.
- **Pepper — which *is* supported — is not in the list.** A chilli/pepper grower
  cannot select their own crop. (`Chilli` is offered, but the model's class is
  `Pepper`; whether those are meant to be the same thing is a product question.)
- Home then displays the chosen crops in the header — *"Maharashtra · Tomato,
  Wheat"* — so **the UI actively advertises capability the model does not have.**

For this audience that is the worst class of bug: not a crash, but a plausible
wrong answer about a crop the app was never able to help with. It is already
recorded as a known limitation (`DECISIONS.md` §4.1 — PlantVillage has no wheat
imagery); what is new is that the UI invites it.

**Fix.** Drive the picker from the model's own class list rather than a hand-kept
array, so the two cannot drift:

```ts
// lib/crops.ts — one source of truth, mirrored from app/models/labels.py
export const SUPPORTED_CROPS = ["Tomato", "Potato", "Pepper"] as const;

/** Shown but not selectable, so a farmer is not left guessing why. */
export const COMING_SOON_CROPS = [
  "Wheat", "Rice", "Maize", "Onion", "Brinjal", "Chilli", "Cotton",
  "Sugarcane", "Groundnut", "Soybean",
] as const;
```

In the picker, render supported crops as normal chips and the rest disabled with
a short reason:

```html
<label class="chip chip--disabled" aria-disabled="true">
  🌾 Wheat <span class="chip-note">जल्द आएगा · coming soon</span>
</label>
```

```css
.chip--disabled { opacity: .45; cursor: not-allowed; }
.chip-note { font-size: 13px; color: #6B6B66; }
```

And filter any already-stored unsupported crop out of the Home header, so nobody
is shown a crop the app cannot help with.

> **Worth a separate decision:** is `Chilli` meant to map to the `Pepper` class?
> If yes, the label needs changing on one side or the other. If no, chilli growers
> are currently unsupported and should be told so.

### 2.3 No offline behaviour

The brief requires cached data and a *"Data from last sync"* banner. On 2G/3G or
patchy rural networks the app currently has retryable error states — which is
half the requirement — but no cache and no staleness banner.

**Fix.** Cache the last successful payload per screen (localStorage is enough at
this scale), render it immediately, and show a banner:

```html
<div class="sync-banner">⚠️ पिछली बार का डेटा · Data from last sync, 2 h ago</div>
```

```css
.sync-banner {
  background: #FFF8E1; color: #7A4A12;
  border: 1px solid #F0C36D; border-radius: 12px;
  padding: 10px 14px; font-size: 15px; margin: 0 16px 12px;
}
```

### 2.4 The language toggle exists on one screen out of six

The brief asks for it on **every** screen. It is currently only in the Assistant.

**Fix.** Put it in the app header (`app/(app)/layout.tsx`), which is already
sticky and on every signed-in screen:

```html
<header class="app-header">
  <Logo /> <span>Agri AI</span>
  <button class="lang-toggle" aria-label="भाषा बदलें">EN | हिं</button>
</header>
```

```css
.lang-toggle { min-height: 48px; min-width: 64px; border-radius: 999px; font-weight: 700; }
```

---

## 3. 🟡 Important — real friction, not blockers

### 3.1 Body text is 14px on Home and Assistant

The brief's floor is 16–18sp. Home's confidence labels and dates, and the
Assistant's footnote, render at 14px. For an audience reading outdoors on a
budget panel, 14px is the wrong place to save space.

```css
/* raise the small-text floor app-wide */
.text-sm { font-size: 16px; line-height: 1.5; }
```

If that feels heavy for dense areas, keep 16px for anything a farmer must *read
to act* (confidence, dates, source names) and reserve 14px for metadata that is
purely decorative.

### 3.2 The Crop-photo screen puts guidance above the action

The "For a better result" tips card sits **above** the primary button, pushing it
out of the thumb zone. The tips are genuinely useful — they are also the wrong
thing to lead with.

**Fix.** Action first, tips collapsed below it:

```
[ 📷 Take a photo of the leaf ]   ← primary, sticky, 56px
[ Choose from gallery ]
▸ Tips for a better photo          ← collapsible, closed by default
```

### 3.3 Jargon on the diagnosis result

Two strings a farmer will not understand:

| Current | Better |
|---|---|
| `model v1.0.0-head` | move behind an ⓘ "How this works" affordance |
| `Back to dashboard` | `← Back` / `← वापस` |

The model version is good provenance — it just doesn't belong in the primary
reading path. Keep it in the API response and surface it on the ⓘ sheet.

### 3.4 Home cards have no image

The brief asks for **image + title + one-line takeaway**. The current cards are
title + crop + confidence bar + date — no thumbnail. A farmer recognises a leaf
photo far faster than the string "Tomato - Late Blight".

```css
.result-card { display: grid; grid-template-columns: 72px 1fr; gap: 12px; }
.result-card img { width: 72px; height: 72px; border-radius: 12px; object-fit: cover; }
```

The image is already stored and signed URLs are already issued for the diagnosis
screen, so this is a query change, not new infrastructure.

### 3.5 No voice input anywhere

The brief asks for voice above the keyboard. Nothing has it. This is the single
biggest lever for a low-literacy audience — typing Devanagari on a budget Android
keyboard is slow and error-prone.

**Fix.** A mic button beside the Assistant composer and above the keyboard on the
photo-caption field, using the Web Speech API with `lang="hi-IN"` / `"en-IN"`:

```js
const rec = new webkitSpeechRecognition();
rec.lang = language === "hi" ? "hi-IN" : "en-IN";
```

The Assistant already answers in the language of the question, so voice feeds
straight into a path that works.

### 3.6 Repeated results are not grouped

Home lists five near-identical "Tomato - Late Blight, 99%" rows — an artefact of
repeated test uploads, but it reveals there is no grouping. A farmer who checks
the same plant weekly will see the same wall.

**Fix.** Group by disease + crop, show the most recent, and add *"3 checks"* with
the earlier ones behind a disclosure.

### 3.7 Community is very dense

56 interactive targets on one screen, 26 of them under 48dp — by far the busiest
screen in the app. At 390px this is a wall of controls.

**Fix.** One idea per card: image (if any) + title + one-line takeaway + a single
primary action. Push "Joined" / "Join" state into a secondary chip row.

---

## 4. 🟢 Nice-to-have

- **Two font families** (Inter for body, Sora for headings). The brief says one.
  Sora is used only for large headings, so this is defensible — but if you want
  strict compliance, drop Sora and set headings in Inter 700.
- **No government scheme badges.** The brief asks for them. There is no data
  source wired for this; it is a content task before it is a design one.
- **Confidence bar** is a bare bar. A short label under it — *"High — the model is
  reliable here"* — reads better for low-literacy users than a percentage alone.
  (The diagnosis screen already does this; Home does not.)

---

## 5. ⚠️ Open questions — these change everything above

### 5.1 The palette contradicts what we shipped two days ago

Your brief specifies **deep leaf green `#2E7D32` on off-white `#FAFAF5`**. On your
instruction two days ago I rebuilt the entire UI in the **dark violet** style from
your reference video (`#08070F` canvas, `#A78BFA` / `#7C3AED`).

These are opposite directions. I have **not** repainted anything, because guessing
wrong wastes a full restyle.

Worth saying plainly: **the brief's light palette is the better call for this
audience.** The original UI/UX Design Brief chose light mode for exactly one
reason — *better outdoor/sunlight readability on mobile* — and that reason has not
gone away. Dark violet looks better on a designer's monitor; high-contrast dark
text on off-white is more legible under a 50,000-lux sun.

**My recommendation:** light green for the farmer-facing app, keep dark violet for
the public landing page where it reads as premium and nobody is standing in a
field.

### 5.2 The nav spec removes features

Your brief lists **Home · Crops/Advisory · Weather · Market · Profile**. The app
has **Dashboard · Assistant · Upload · Community · Profile**.

Adopting the brief's five would **remove** Assistant, Upload and Community from
the bottom bar — which contradicts *"do not remove any existing features"* — and
**add** Weather and Market, which do not exist. That is new product scope, not a
redesign.

Options, in the order I would rank them:

1. **Keep the existing five, restyle only.** Rename `Dashboard → Home`. Nothing
   is lost, nothing is invented. `Upload` becomes the sticky CTA from §2.1 rather
   than a tab.
2. **Adopt the brief's five**, moving Assistant / Upload / Community onto Home.
   Weather and Market stay unbuilt until there is a data source (IMD, mandi).
3. **Build Weather and Market** — a genuinely good idea for this audience, but it
   is two new features with two new data integrations, not a design task.

---

## 6. What I would do first

If you want the highest impact per hour, in order:

1. **§5.1 palette decision** — it gates every other colour value.
2. **§2.2 wheat** — a correctness bug wearing a UI costume; cheapest real harm
   reduction on this list.
3. **§2.1 sticky "Take a photo" on Home** — the main task currently has no door.
4. **`--spacing-tap: 48px`** — one line, whole-app compliance.
5. **§2.4 language toggle in the header** — one component, five screens fixed.
6. **§3.4 thumbnails on Home cards** — biggest recognition win for the cost.

Everything else can follow.
