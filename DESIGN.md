---
name: Circuit
description: Cobalt fields, white planes and a highlighter yellow, set in one variable grotesk, for the docs site and Circuit Studio.
colors:
    cobalt: "#0a47b8"
    cobalt-deep: "#08337f"
    navy: "#0a1a36"
    yellow: "#f8e347"
    yellow-deep: "#e8cd1c"
    signal-red: "#d42a2f"
    on-cobalt: "#ffffff"
    on-cobalt-soft: "#c9d7f5"
    paper: "#ffffff"
    mist: "#eff2f9"
    ink: "#11141b"
    soft-ink: "#49536a"
    line: "#d3d9e7"
    edge: "#7b86a0"
    code-text: "#e6ecfa"
    removed: "#c0262c"
    added: "#11733b"
    warning: "#b35a00"
    warning-strong: "#f0a030"
    selected: "#fff7c2"
    night-paper: "#0b1122"
    night-mist: "#121a30"
    night-ink: "#f1f4fb"
    night-soft-ink: "#a9b4cc"
    night-line: "#26314d"
    night-link: "#9cb9ff"
    night-removed: "#ff8086"
    night-added: "#5fd38f"
    night-warning: "#ffad4f"
    night-selected: "#3a3510"
typography:
    display:
        fontFamily: "Special Gothic, Segoe UI, system-ui, sans-serif"
        fontSize: "8.07vw"
        fontWeight: 700
        lineHeight: 0.94
        letterSpacing: "-0.035em"
        fontVariation: "'wdth' 94"
    headline:
        fontFamily: "Special Gothic, Segoe UI, system-ui, sans-serif"
        fontSize: "6.25vw"
        fontWeight: 700
        lineHeight: 1.08
        letterSpacing: "-0.04em"
    title:
        fontFamily: "Special Gothic, Segoe UI, system-ui, sans-serif"
        fontSize: "clamp(30px, 3.2vw, 44px)"
        fontWeight: 700
        lineHeight: 1.2
        letterSpacing: "-0.03em"
    body:
        fontFamily: "Special Gothic, Segoe UI, system-ui, sans-serif"
        fontSize: "16.5px"
        fontWeight: 400
        lineHeight: 1.75
    body-studio:
        fontFamily: "Special Gothic, Segoe UI, system-ui, sans-serif"
        fontSize: "15px"
        fontWeight: 400
        lineHeight: 1.5
    label:
        fontFamily: "Special Gothic, Segoe UI, system-ui, sans-serif"
        fontSize: "12px"
        fontWeight: 700
        letterSpacing: "0.08em"
        fontVariation: "'wdth' 115"
    wordmark:
        fontFamily: "Special Gothic, Segoe UI, system-ui, sans-serif"
        fontSize: "24px"
        fontWeight: 700
        letterSpacing: "0.04em"
        fontVariation: "'wdth' 125"
    mono:
        fontFamily: "ui-monospace, Cascadia Code, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize: "12.5px"
        fontWeight: 400
        lineHeight: 1.55
rounded:
    none: "0px"
    control: "2px"
    node: "8px"
    segment: "14px"
    dot: "50%"
spacing:
    xs: "6px"
    sm: "8px"
    md: "12px"
    lg: "18px"
    xl: "22px"
    gutter: "3.65vw"
    gutter-narrow: "16px"
components:
    button-primary:
        backgroundColor: "{colors.yellow}"
        textColor: "{colors.navy}"
        rounded: "{rounded.control}"
        padding: "0 28px"
        height: "50px"
    button-primary-hover:
        backgroundColor: "{colors.yellow-deep}"
        textColor: "{colors.navy}"
    button-default:
        backgroundColor: "{colors.paper}"
        textColor: "{colors.ink}"
        rounded: "{rounded.control}"
        padding: "6px 12px"
        height: "36px"
    button-pressed:
        backgroundColor: "{colors.cobalt}"
        textColor: "{colors.on-cobalt}"
        rounded: "{rounded.control}"
    command-copy:
        backgroundColor: "{colors.navy}"
        textColor: "{colors.on-cobalt}"
        typography: "{typography.mono}"
        rounded: "{rounded.control}"
        padding: "0 26px"
    input-field:
        backgroundColor: "{colors.mist}"
        textColor: "{colors.ink}"
        rounded: "{rounded.control}"
        padding: "5px 9px"
        height: "36px"
    label-chip:
        backgroundColor: "{colors.ink}"
        textColor: "{colors.paper}"
        typography: "{typography.label}"
        rounded: "{rounded.none}"
        padding: "2px 8px"
    label-chip-caution:
        backgroundColor: "{colors.signal-red}"
        textColor: "{colors.on-cobalt}"
    studio-tag:
        backgroundColor: "{colors.yellow}"
        textColor: "{colors.navy}"
        rounded: "{rounded.control}"
        padding: "2px 7px"
    callout-dot:
        backgroundColor: "{colors.on-cobalt}"
        textColor: "{colors.cobalt}"
        rounded: "{rounded.dot}"
    callout-dot-lit:
        backgroundColor: "{colors.yellow}"
        textColor: "{colors.navy}"
    step-dot:
        backgroundColor: "{colors.cobalt}"
        textColor: "{colors.on-cobalt}"
        rounded: "{rounded.dot}"
    file-chip:
        textColor: "{colors.soft-ink}"
        typography: "{typography.mono}"
        rounded: "{rounded.control}"
        padding: "2px 8px"
---

# Design System: Circuit

## Overview

**Creative North Star: "The Numbered Parts Plate"**

Circuit is drawn the way a service manual draws a carburetor: a cobalt field, a flat illustration of the workflow, white numbered callouts with thin leader lines, and a legend underneath that names each part in Circuit's own terms. The two references that pinned the world are a cobalt exploded-parts plate (numbered callouts paired with a parts list) and a yellow storybook page (dotted underlines under words that can be looked up, labels pinned to a drawing). The docs site and Circuit Studio share one palette, one variable typeface and one signature, the dotted cobalt underline.

The page alternates cobalt fields with clean white and mist planes. Near-black ink frames carry structure: 2px rules under table heads, 2px frames around notes, tools and screenshots. Yellow is a highlighter, not a decoration: it marks the one action to take, the current thing, and selected text. Red is held back for removal, errors and the alpha caution; Studio adds orange for warnings and green for added. Code sits on navy in both themes, like the editor drawn in the home plate. The density is calm on the docs and working-tight in Studio, but both read as the same manual.

Both surfaces have a dark theme. The cobalt field, the navy code ground and the yellow highlighter stay the same in both; only the paper, ink, lines and link colour change.

**Key Characteristics:**

- Cobalt fields and white or mist planes, never a grey dashboard.
- One typeface, Special Gothic, used across its width axis: wide caps for the wordmark and labels, normal width for reading, slightly condensed for the hero line. Monospace only for config and commands.
- The dotted cobalt underline marks headings you can read further under, and links (dotted at rest, solid on hover).
- Numbered white circle callouts with leader lines, paired one to one with a legend.
- Square controls (2px radius), square note frames (0 radius), flat surfaces.
- Yellow for action and selection, red for removal and caution, each paired with a second cue such as a word, a mark or a dash pattern.

## Colors

A two-field palette: saturated cobalt and white, with a yellow highlighter and a few signal colours that always travel with a word or a mark.

### Primary

- **Plate Cobalt** (cobalt): the field colour. The docs home opening and Studio chapter, the docs nav on the home page, the Studio header rail, pressed segmented buttons, the active tab bar under Studio tables, step number dots, the chassis mark on graph nodes, and the dotted heading underline in light themes. Also the link colour in light themes.
- **Deep Cobalt** (cobalt-deep): inline code text in light docs and the hover tint for brand links.

### Secondary

- **Highlighter Yellow** (yellow): the one action colour and the selection colour. The Get started button, the yellow close chapter, the Studio tag beside the wordmark, the active bar under Studio view tabs, problem counts, lit callout dots, the current sidebar page (a highlighter band behind the text), text selection, search hit highlights and trunk ports on a device faceplate. Text on yellow is always navy or ink.
- **Pressed Yellow** (yellow-deep): hover for yellow buttons and the outline of VLAN segment nodes.

### Tertiary

- **Signal Red** (signal-red): the docs caution frame and its label chip (the alpha caution and DANGER blocks).
- **Removal Red** (removed / night-removed): removed diff lines, errors, error node frames and the error badge in Studio.
- **Warning Orange** (warning, warning-strong / night-warning): Studio warning text and node frames (dashed), one-sided cables (dashed) and the WARNING badge; on the docs, the frame and label chip of WARNING notes.
- **Added Green** (added / night-added): added diff lines, added cables, the live indicator and linked ports.

### Neutral

- **Paper** (paper / night-paper): reading planes and Studio surfaces (panel, toolbar, status rail, tables).
- **Mist** (mist / night-mist): the alternate docs chapter (How) and Studio's drawing board background and field inputs.
- **Navy** (navy): code blocks in both themes, the docs footer, and the dark selected button in the close chapter's package switch.
- **Ink** (ink / night-ink): text and every structural frame and rule.
- **Soft Ink** (soft-ink / night-soft-ink): secondary text, file chips, captions.
- **Line** (line / night-line): hairline row dividers and quiet borders.
- **Edge** (edge): graph cable strokes and default control borders in Studio.
- **On-Cobalt Soft** (on-cobalt-soft): inactive tabs, placeholder text and thin rules on cobalt.
- **Selected Wash** (selected / night-selected): the fill of a selected graph node and a row that just flashed into view.

### Named Rules

**The Highlighter Rule.** Yellow marks what to do or what is chosen: one primary action per view, the current item, the selection. It never fills a decorative panel except the single close chapter on the docs home, and text on it is always navy or ink.

**The Red Means Gone Rule.** Red appears only for something removed, broken, or the alpha caution. Warnings in Studio are orange, never red, and every colour state carries a second cue (a word, a filled or hollow dot, a dash pattern).

**The Navy Code Rule.** Code blocks and commands sit on navy (#0a1a36, or #060c1a in dark docs) in both themes, with light text and a yellow `$` prompt.

## Typography

**Display Font:** Special Gothic, variable weight 400 to 700 and width 75% to 125% (with Segoe UI, system-ui, sans-serif)
**Body Font:** Special Gothic (same stack)
**Label/Mono Font:** Special Gothic in wide caps for labels; ui-monospace, Cascadia Code, SFMono-Regular, Menlo, Consolas for config and commands

**Character:** one heavy, tight grotesk carries everything. Width does the work other systems give to a second family: widen it for the wordmark and caps labels, keep it normal for reading, condense it slightly for the hero line. Self-hosted in both surfaces (docs/public/fonts and src/studio/public) so Studio works offline and falls back to system fonts.

### Hierarchy

- **Display** (700, about 124px at 1536 wide, scaled with the window; clamp(44px, 13.6vw, 72px) under 760px; 0.94; -0.035em; width 94%): the docs home title line only.
- **Headline** (700, about 96px at 1536 wide, 52px narrow; 1.08; -0.04em): docs home chapter headings, each carrying the dotted underline.
- **Title** (700; 46px docs page h1, 30px docs h2, clamp(30px, 3.2vw, 44px) Studio table heading, 26px Studio panel heading; -0.015em to -0.03em): page and panel titles.
- **Body** (400; 16.5px / 1.75 on docs pages, 17px to 19px / 1.6 on the docs home, 15px / 1.5 in Studio; reading measure about 60ch to 720px): all reading text.
- **Label** (700, 11px to 13px, letter-spacing 0.06em to 0.1em, width 112% to 120%, uppercase): nav links, Studio view tabs, sidebar group names, table heads, note chips, badges, panel section heads.
- **Wordmark** (700, width 125%, uppercase, 0.02em to 0.05em): CIRCUIT in the docs nav and Studio rail.
- **Mono** (400, 12px to 22px): code, commands, file names, VLAN segment labels, model numbers.

### Named Rules

**The One Family Rule.** Every non-code word is Special Gothic. Change width and weight, not family.

**The Wide Caps Label Rule.** Uppercase is reserved for short labels set wide (width 112% or more) and tracked (0.06em or more). Headings and reading text stay in sentence case.

## Layout

The docs home is laid out against a 1536px drawing: lengths in the opening scale with the window (1px of the drawing is 0.0651vw), with a 3.65vw side gutter that becomes 16px under 760px. Chapters are a two-column grid: the heavy heading on the left (about 644 of 1536) and reading on the right (up to about 720 of 1536), collapsing to one column under 760px. Chapter planes alternate paper, mist, cobalt and finish on a full yellow field. The illustration plate runs edge to edge at 1536:426; under 760px it keeps a 900px stage and scrolls sideways in its own frame.

Docs reading pages use VitePress's layout with a 72px nav (64px to 84px on the home page, on cobalt).

Studio is a full-height column: the cobalt rail (52px tabs), a 38px white status rail, a 52px toolbar, then the drawing board with a 390px panel at the right. The search drops under the tabs below 1180px; below 760px tabs scroll sideways and the panel moves under the graph at 42% height. Tables sit in a padded column (clamp(16px, 4vw, 56px) sides). Studio's working rhythm steps 6px, 8px, 12px, 18px, 22px. The drawing board carries a 24px dot grid. Graph nodes keep at least 24px between tags horizontally and 96px between centres vertically.

## Elevation & Depth

Flat. Depth comes from planes (cobalt against paper against mist) and from ink frames: 2px around note blocks, tool forms, faceplates, the proved-models table and screenshots; 2px under table heads; 1px hairlines between rows. The single shadow in the system is the dropdown under Studio's Save image menu.

### Shadow Vocabulary

- **Menu lift** (`box-shadow: 0 8px 20px rgba(10, 26, 54, 0.18)`): Studio dropdown menus only.

### Named Rules

**The Ink Frame Rule.** A container that needs separation gets a 2px ink frame or a plane change, not a shadow.

## Shapes

Square by default. Controls (buttons, inputs, menus, segmented controls, chips, badges, inline code) use a 2px radius. Note blocks, code blocks, screenshots, table frames and pager links have 0 radius. Circles appear only as numbered dots (callouts, legend, steps) and status dots. On Studio's drawing board, device tags have an 8px radius and VLAN segments 14px, so drawn parts read as labelled tags rather than controls. A device tag carries a drawn chassis mark: a 34 by 30 cobalt block with two rows of three white sockets (yellow when selected), never a photograph.

## Components

### Buttons

- **Shape:** square, 2px radius.
- **Primary:** highlighter yellow with navy text, 700 weight, with a drawn arrow. On the docs home it is 50px to 67px tall; in Studio it is the same 36px as other buttons with an ink border.
- **Hover / Focus:** yellow-deep on paper; on the cobalt opening it turns white. The arrow nudges 3px right. Focus is a 3px outline offset 2px to 3px: the link colour on paper and mist, yellow on the cobalt nav and Studio rail, white inside the cobalt opening and Studio chapter.
- **Default (Studio):** paper with a 1.5px edge border, 600 weight; hover turns border and text cobalt (or the night link colour).
- **Pressed / Selected:** cobalt fill, white text. In segmented controls the group has one 1.5px ink frame and 1.5px line dividers.

### Command copy

- **Style:** navy ground (or translucent navy on cobalt), mono command, a drawn copy icon at the right, 2px radius, 2px border. Click copies, and "Copied" appears in yellow. On the close chapter a package-manager switch sits beside it: a 2px navy frame whose selected segment is navy with yellow text.

### Chips

- **File chips:** mono, soft ink, 1px line border, 2px radius, 2px 8px padding. They list files, not actions.
- **Studio chips:** small default buttons (28px tall) for picking a VLAN or layer item.
- **Badges:** caps label chips, red with white for ERROR, orange with ink for WARNING.

### Cards / Containers

- **Corner Style:** 0 for note blocks and plates, 2px for Studio tool forms and faceplates.
- **Background:** paper.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 2px ink.
- **Internal Padding:** 16px to 22px.

### Notes and cautions

A square 2px ink frame with its kind on a caps label chip at the top (ink chip with paper text for NOTE, cobalt for TIP and INFO, orange with white text for WARNING, signal red for DANGER and the alpha caution; WARNING and DANGER frames take their chip's colour).

### Inputs / Fields

- **Style:** 36px tall, 1.5px edge border, 2px radius, mist ground, label above in 13px 600 soft ink.
- **Focus:** border turns cobalt. The Studio search sits on cobalt with translucent navy fill and a soft-blue border; on focus the border goes white with a 3px yellow outline.

### Navigation

- **Docs nav:** wide caps wordmark; links in 13px caps, width 112%, 0.06em. Active link is link-coloured with a 2px dotted underline. On the home page the bar sits on cobalt with white links that turn yellow on hover.
- **Docs sidebar:** group names in 12px wide caps; the current page carries a yellow highlighter band behind its text.
- **Studio rail:** cobalt, CIRCUIT wordmark with the yellow STUDIO tag, nine caps view tabs in soft blue that go white, with a 4px yellow bar under the active one.
- **Studio table tabs:** muted text, 4px cobalt bar under the active tab.

### Dotted underline (signature)

A row of round cobalt dots under a heading, drawn as a repeating radial gradient (dots spaced 14px to 19px) that follows each line of the heading. It marks headings you can read further under: docs home chapter headings, Studio table titles and the Studio panel title. In dark themes the dots use the night link colour. Links use the same idea as a text underline: dotted 1.5px to 2px at rest, solid on hover. Docs reading pages mark h2 with a 3px ink rule above instead.

### Numbered callouts and legend (signature)

White circle dots with cobalt numerals sit over the illustration plate, each joined by a thin white leader line ending in a small white dot at its part. A legend below a thin soft-blue rule repeats the same numbers as white dots beside the part names. Hovering or focusing either side lights both: the dot turns yellow and grows to 1.12, the legend entry gets a dotted underline, and the callout shows a white tag with a navy frame. On arrival, leaders draw in and dots pop in legend order (0.09s apart, cubic-bezier(0.16, 1, 0.3, 1)); reduced motion turns this off. Steps lists reuse the dot as a cobalt circle with a white numeral.

### Status rail (Studio)

A white bar of counts, each with a small dot: hollow for quiet counts, filled for errors and warnings, a square for differs-from-snapshot, and a live indicator at the right (green when connected, orange otherwise).

### Graph nodes (Studio)

Flat paper tags with a 2px ink frame, a drawn chassis mark and name over platform and model. Error frames are 4px red; warning frames 4px orange dashed; selected nodes take the selected wash with a 4px cobalt frame; VLAN segments are yellow-tinted with a yellow-deep outline and mono labels; outside nodes are dotted. Cables are 2px edge strokes, lit cables 4px in the link colour, added cables green, removed cables red and dashed.

### Identity marks

The docs favicon is a white page with two navy lines over a cobalt dotted underline, on a cobalt square. The Studio favicon is a cobalt chassis with six ports, one lit yellow, on a yellow square: the same chassis mark the graph nodes carry. They share the palette and tell reading from operating apart at a glance. In Studio the CIRCUIT wordmark and its yellow tag are a link back to the graph.

### Illustration plates

Flat illustration with bold outlines in two or three inks, depicting software (editor, plan sheet, network board, snapshot card, git history) rather than hardware, shipped as transparent WebP plates on the cobalt field. Words in the plate are set in live type over the raster; the editor's code is bent onto the editor's four corners with a perspective transform, so it leans with the drawing.

## Do's and Don'ts

### Do:

- **Do** put the opening of a marketing surface on a cobalt field with white type, and alternate paper and mist planes below it.
- **Do** use yellow for the single primary action and for selection, with navy or ink text on it.
- **Do** pair every numbered callout with a legend entry that has the same number, and light both together.
- **Do** mark headings you can read further under with the dotted cobalt underline, and set links as dotted underlines that go solid on hover.
- **Do** set code and commands on navy in both themes, with a yellow `$` prompt.
- **Do** frame notes and cautions as square 2px boxes with a caps label chip.
- **Do** keep controls square at 2px radius and give state a second cue beyond colour (a word, a dot shape, a dash pattern).
- **Do** keep Special Gothic self-hosted beside each surface so Studio works offline.

### Don't:

- **Don't** use red for anything but removal, errors and the alpha caution; Studio warnings are orange.
- **Don't** add shadows to cards or panels; separate with a plane or a 2px ink frame.
- **Don't** introduce a second display or body family; vary Special Gothic's width and weight instead.
- **Don't** use a product photograph or hardware picture for a device; draw the chassis mark.
- **Don't** use em-dashes in any copy.
