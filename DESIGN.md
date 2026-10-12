---
name: Circuit
description: A clear, vendor-neutral visual system for writing and operating networks.
colors:
  limewash: "#f6f5ea"
  sheet: "#ffffff"
  charcoal: "#181a1e"
  soft-ink: "#59646c"
  rule: "#c7c6bb"
  sunlight: "#e3ad32"
  sunlight-ink: "#805300"
  error: "#b4232c"
  warning: "#9a5700"
  up: "#167a45"
typography:
  display:
    fontFamily: "Carlito, Aptos, Segoe UI, sans-serif"
    fontSize: "clamp(3rem, 7vw, 6.6rem)"
    fontWeight: 700
    lineHeight: 0.94
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Carlito, Aptos, Segoe UI, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.625rem)"
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: "Carlito, Aptos, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Carlito, Aptos, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.1em"
  mono:
    fontFamily: "ui-monospace, Cascadia Code, SFMono-Regular, Menlo, Consolas, monospace"
rounded:
  square: "0"
  control: "2px"
spacing:
  hairline: "1px"
  compact: "8px"
  control: "12px"
  section: "32px"
  chapter: "64px"
components:
  button:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
  button-active:
    backgroundColor: "{colors.sunlight}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.square}"
    padding: "4px 10px"
  field:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.charcoal}"
    rounded: "{rounded.square}"
    padding: "5px 8px"
---

# Design System: Circuit

## Overview

**Creative North Star: "Daylight Section"**

Circuit looks like a building section opened to daylight. Large, calm planes make the system understandable before detail arrives. Charcoal carries structure, limewash holds the page, and sunlight marks the active plane. The home page uses generous chapters and a physical cutaway illustration. Studio compresses the same materials into a working instrument for an engineer beside an editor.

The documentation and Studio share their color and type families. They differ by density, not identity. The system rejects the old gray VitePress neutrality, terracotta, serif headings, outlined pills and trace decoration. It also rejects neon terminals, monitoring dashboards and vendor palettes.

**Key Characteristics:**

- Strong horizontal and vertical section lines.
- One sunlight accent over limewash and charcoal.
- Bold sans-serif names with compact labels and monospace data.
- Square controls and structural frames without decorative elevation.
- Redundant state cues that do not depend on color alone.
- Designed light and dark themes with the same hierarchy.

## Colors

The palette is architectural and warm. Most of a surface is limewash or charcoal. Sunlight is rare enough to remain directional.

- **Limewash** (`#f6f5ea`): the light page and graph ground.
- **Sheet** (`#ffffff`): tables, panels and controls in light mode.
- **Charcoal** (`#181a1e`): light-theme ink and the dark-theme ground.
- **Soft Ink** (`#59646c`): supporting text and secondary data.
- **Rule** (`#c7c6bb`): dividers and quiet boundaries.
- **Sunlight** (`#e3ad32`): brand rail, active underline and selected-plane emphasis.
- **Sunlight Ink** (`#805300`): readable links and small accents on light backgrounds.
- **Error, Warning and Up**: semantic colors only. Dark mode uses `#ff7180`, `#ffad42` and `#45cf82`.

**The Daylight Rule.** Sunlight shows the active layer or a single structural emphasis. It is not a category palette.

**The Meaning Rule.** Red means error, orange means warning or unlike a snapshot, and green means up or added. Pair each with line style, pattern, weight or text.

## Typography

**Display and Body Font:** Carlito, with Aptos and Segoe UI fallbacks.

**Label and Data Font:** the system monospace stack.

Carlito is direct and familiar without borrowing a vendor voice. Heavy headings provide the section structure. Body text stays open and readable. Monospace is reserved for config, identifiers and device output.

- **Display:** weight 700, tight tracking, used for the home statement.
- **Headline:** weight 700, used for page, device and chapter names.
- **Body:** weight 400, 1.6 to 1.75 line height for reading.
- **Label:** weight 700, small uppercase text with `0.1em` tracking for table headers and panel groups.
- **Mono:** config, plans, ports, addresses and error output.

## Layout

The home page is a sequence of full-width chapters separated by long rules. Its first screen is a two-column section at desktop width and a single column on a phone. Studio uses a fixed header rail, a compact action band, a flexible graph stage and a 390px side panel. Below 760px, the panel moves below the graph, view navigation scrolls horizontally and wide device elements scroll inside their own frame.

Docs pages retain VitePress structure, but the shared tokens, square code blocks, active rules and sidebar treatment prevent them from becoming a separate visual world.

## Elevation & Depth

Surfaces are flat. Depth comes from overlapping planes, thick boundaries, scale and contrast. Selected nodes and faceplates stay in the same plane as the working surface. Do not use decorative shadows, glow, blur or glass.

## Shapes

Controls are square or have a 2px practical radius. Tables, code blocks, panels and fields are square. Borders are 1px for separation, 2px for working frames and 4px to 5px for active or semantic emphasis. Hatching marks a shut port. Dashes mark a warning, a LAG, a one-sided connection or something outside the network according to context.

## Components

### Navigation

The Circuit Studio wordmark sits on a sunlight block. Views use quiet text and a 4px sunlight underline for the active item. A full-width status rail separates network health from navigation, with outlined quiet counts, filled semantic counts and Live at the far edge. On narrow screens the navigation row scrolls and the status counts wrap.

### Buttons and Fields

Buttons are compact, square and bordered. Active layer buttons fill with sunlight. Every interactive element uses a 3px visible focus outline. Fields use the sheet color and an edge-color border.

### Graph

Nodes pair a device illustration with a name and supporting data on a calm ground. A warning or snapshot difference uses a thick orange dashed border. An error uses a thick red border. Outside nodes use a fine dotted border. Selection uses a thick sunlight outline. Added and removed edges use color plus weight or dashes.

### Side Panel

The panel is a solid sheet separated by a 2px charcoal boundary and a sunlight edge. Its title ends in a 4px sunlight rule. Small uppercase labels divide dense working information.

### Identity Marks

The docs favicon is a configuration sheet crossed by sunlight. The Studio favicon is a front-facing network device with an up light. They share the charcoal, limewash and sunlight palette but identify reading and operating at a glance.

### Tables and Faceplate

Tables have square frames, strong header rules and subtle alternate rows. The faceplate has a 2px structural frame. Port state combines fill, line style, border weight, hatching and a link dot so no state relies on color alone.

## Do's and Don'ts

### Do:

- **Do** keep docs and Studio on the same color and font tokens.
- **Do** design every semantic color separately for light and dark.
- **Do** use thick section rules and full planes to establish hierarchy.
- **Do** keep Studio dense and scannable while docs remain comfortable to read.
- **Do** pair status color with a second cue such as a dash, hatch, weight or label.
- **Do** preserve a visible keyboard focus on every control.
- **Do** respect reduced motion.

### Don't:

- **Don't** restore terracotta, serif headings, rounded pill controls or trace decoration.
- **Don't** use neon text, glowing consoles, scanlines, gauges or colored dashboard tiles.
- **Don't** borrow a network vendor's palette or visual language.
- **Don't** use soft shadows, blur or glass.
- **Don't** use sunlight for unrelated categories.
- **Don't** hide dense content on a phone when it can scroll inside its own frame.
