# UI Specs

## Overview

Design a desktop-first Software Engineering task management dashboard UI inspired by premium dark-mode software version control apps or fintech apps. The interface should feel calm, tactile, minimal, and slightly futuristic without looking flashy. Prioritise soft contrast, rounded geometry, restrained color use, and dense but readable information layout.

## Visual Style
- Use a nearly-black charcoal background, not pure black. Main surfaces should sit in a tight tonal range with subtle separation between page background, cards, and controls.
- Create depth with soft inner and outer shadows rather than strong borders. Components should feel gently embossed or inset, similar to neumorphism but more refined and realistic.
- Use large rounded corners throughout. Most cards should feel pill-like or capsule-inspired, with rounded bottoms tabs and segmented controls echoing the same geometry.
- Keep the interface monochromatic except for one success accent, a vivid green used for performance numbers and progress bars. Any additional category colors should appear only in tiny chart legends.

## Color System
- Background: deep charcoal.
- Surface: slightly lighter charcoal.
- Elevated surface: one step lighter than surface.
- Stroke: ultra-low-contrast gray, only when needed.
- Primary text: off-white.
- Secondary text: medium gray.
- Tertiary text: dim gray.
- Accent positive: bright green.
- Data accents: blue, yellow, pink, gray for allocation labels only.

Example palette:
- `bg`: `#1A1A1A`
- `surface`: `#222222`
- `surface-2`: `#2A2A2A`
- `stroke`: `rgba(255,255,255,0.06)`
- `text`: `#F3F3F3`
- `text-muted`: `#A1A1A1`
- `text-faint`: `#6F6F6F`
- `green`: `#22C55E`
- `blue`: `#2F7CF6`
- `yellow`: `#F4B400`
- `pink`: `#FF2D7A`
- `gray-dot`: `#BDBDBD`

## Typography
- Use a clean modern sans-serif such as Inter, SF Pro, Geist, or Satoshi.
- Emphasize hierarchy through size and weight, not color.
- Large progress numbers should be bold and prominent.
- Section labels should be medium weight.
- Supporting metadata should be smaller and muted.
- Avoid decorative fonts, wide tracking, or oversized headlines.

Suggested type scale:
- Greeting title: `32-36px`, semibold
- Progress subtitle: `14-16px`, regular
- Progress value: `48-56px`, bold
- Primary button label: `16-18px`, medium
- Card heading: `14-16px`, medium
- Main card metric: `20-24px`, semibold
- Tiny chip text: `12-14px`, medium
- Tab bar label: `11-12px`, medium

## Layout Rules
- Frame the UI inside a desktop-sized canvas with generous outer padding.
- Stack sections vertically with consistent spacing.
- Use full-width cards with compact internal padding.
- Group related actions in 3-up button rows.
- Use segmented pills for filters like `To Do / In Progress / Done`
- Anchor navigation in a rounded floating bottom tab bar.

Recommended spacing:
- Outer screen padding: `20-24px`
- Gap between sections: `20-28px`
- Card padding: `16-20px`
- Chip/button gap: `10-12px`
- Bottom nav inset: `12-16px`

## Components

### Header
- Show a circular avatar on the left.
- Greeting and account label stack vertically.
- Place a circular settings button on the right.
- Keep this row compact and balanced.

### Portfolio Hero
- Present a small muted label like "Project Progress".
- Make the progress percentage the dominant focal point on the screen.
- Keep surrounding UI quiet so the progress stands out.

### Action Buttons
- Use three equally sized rounded cards for actions like Create, Delegate, Review.
- Each action should have a small monochrome icon above the label.
- Buttons should look slightly raised with subtle inner edge highlights.

### Task Summary Card
- Use a medium-sized card with:
    - title row
    - secondary CTA pill like "View all"
    - large progress amount
    - thin rounded progress bar
    - horizontal chips for team members and completed tasks

### Task Allocation Section
- Include a title and positive performance indicator aligned opposite each other.
- Use a segmented filter below the title row.
- Present category rows with a colored dot, label, and right-aligned percentage.
- Keep rows airy and minimal, with no visible dividers unless extremely subtle.

### Bottom Tab Bar
- Use a floating dock with rounded full-width capsule styling.
- Active tab gets a brighter icon/text treatment and a soft filled indicator.
- Inactive tabs should remain visible but subdued.

## Shape Language
- Prefer border radii between `18px` and `28px`.
- Use full pill radii for chips, segmented controls, and nav containers.
- Icons should be simple line icons with slight softness, not sharp enterprise-style icons.
- Avoid sharp corners anywhere in the interface.

## Shadows and Depth
Use depth very subtly:
- Outer shadow: soft, dark, low blur.
- Inner highlight: faint top-edge lightening.
- Optional inset shadow for pressed or recessed surfaces.
- Avoid glow effects, harsh drop shadows, and bright outlines.

Example CSS direction:
```css
background: #222;
border: 1px solid rgba(255,255,255,0.04);
box-shadow:
  inset 0 1px 0 rgba(255,255,255,0.03),
  0 8px 24px rgba(0,0,0,0.28);
```

## Interaction Style
- Animations should feel smooth and expensive.
- Use quick fades, subtle scale shifts, and soft pressed states.
- Segmented controls should slide gently rather than snap.
- Progress bars can animate horizontally on load.
- Avoid bouncy motion or playful overshoot. 

## Data Visualization Style
- Prefer tiny, clean indicators over full charts.
- Allocation legend should use small color bullets with text labels.
- Performance emphasis should come from green text and compact numeric summaries.
- Progress bars should be thin, rounded, and bright against a dim track.

## Tone
- Premium
- Quiet
- Technical
- Trustworthy
- Minimal
- Tactile
- Mobile-native

## Avoid
- Bright gradients
- Glassmorphism
- Overly colorful cards
- Hard borders
- White backgrounds
- Large illustrations
- Marketing-style hero copy
- Excessive chart clutter
- Generic SaaS dashboard spacing
