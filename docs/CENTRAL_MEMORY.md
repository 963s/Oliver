# CENTRAL MEMORY — Oliver Roos POS

## Visual Identity Constitution: Warm Minimalism 2.0

This section is the permanent visual constitution for all UI work across platforms.

### Primary Palette (strict)
- Matte Onyx Black: `#1A1A1A`
- Crisp Canvas White: `#FAFAFA`

### Accent Palette (strict)
- Oak Wood / Amber: `#A0522D`
- Brushed Chrome: `#E0E0E0`

### Typography Rules (strict)
- Headings / bold emphasis: `Montserrat`
- Body copy / regular text: `Open Sans`
- Maintain strong hierarchy, clear contrast, and short readable line lengths.

### Wet-Hands Ergonomics (mandatory)
- All interactive elements must be at least `min-h-[48px]`.
- High negative space must be preserved to reduce accidental taps.
- Components must prioritize fast visual parsing in salon operating conditions.

### Structural Directives (mandatory)

**Two layers (do not mix semantics):**

1. **Warm Minimalism 2.0 — operational floor**  
   Day-to-day fiscal and inventory surfaces that must stay calm and legible under stress (e.g. **DailyClosing**, **Inventur**, large parts of **Admin**): **sharp corners** where the Tailwind theme default is `0`, **no decorative gradients**, **palette tokens only**.

2. **Luxury shell — post-login POS chrome (2026+)**  
   After PIN login, the **Dashboard** and shared primitives may use **controlled rounding** (e.g. `rounded-2xl` on **modals**, **custom dropdown panels**, **grouped form sections**), **subtle glass** (`bg-…/95`, `backdrop-blur`), and **Framer Motion** for spatial hierarchy. This does **not** override WM2.0 for the whole app — it marks the **dark operational shell** where fast scanning and overlay stacking matter. **Oak / matte-black / canvas / chrome** definitions still apply; **no random accent colors**.

**Global rule:** Avoid decorative gradients and avoid palette drift outside the defined tokens. Every change must stay auditably consistent with **`docs/PROJECT_MEMORY.md`** for product scope.

### Related implementation notes (pointer)

- Floating help: **`HelpHandbuchModal`**, **`HelpBentoPanel`**, topbar **`?`** — see **PROJECT_MEMORY** section *UX Refinement — Help OS…*.
- Dropdown stacking: **`LuxurySelectMenu`** `DROPDOWN_PANEL_CLASS` (`z-[120]`, opaque panel).
