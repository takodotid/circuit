---
name: Circuit
description: Cobalt fields, white planes and a highlighter yellow, set in one variable sans-serif, for the docs site and Circuit Studio.
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
    head: "#e4e9f4"
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
    night-head: "#18223d"
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

# Circuit's design

The look of the docs site and Circuit Studio. The tokens are in the front matter of this file.

## Overview

The idea is "the numbered parts plate". Circuit is drawn the way a service manual draws a carburetor: a cobalt field, a flat drawing of the workflow, and white numbered callouts with thin leader lines. A legend below gives each part its name in Circuit's own words. Two references set the look:

- a cobalt exploded-parts plate, whose numbered callouts pair with a parts list;
- a yellow storybook page, with dotted underlines under words you can look up, and labels pinned to a drawing.

The docs site and Studio share one palette, one variable typeface, and one signature: the dotted cobalt underline. The docs are calm. Studio is denser, because people work in it. Both read as the same manual.

Both surfaces have a dark theme. Cobalt, the navy behind code, and yellow stay the same in both. Only the paper, ink, lines, and link color change.

## Rules

1. **Yellow is a highlighter.** It marks the one action to take in a view, the current item, and the selection. It never fills a decorative panel, except the close chapter on the docs home. Text on yellow is always navy or ink.
2. **Red means gone.** Red is only for something removed or broken, and for DANGER notes. Studio's warnings are orange, never red.
3. **Color never works alone.** Every color state also has a second cue: a word, a filled or hollow dot, or a dash pattern.
4. **Code sits on navy** in both themes, with light text and a yellow `$` prompt.
5. **One typeface.** Every word that isn't code is Special Gothic. Change its width and weight, never the typeface.
6. **Uppercase only for short labels**, set wide (width 112% or more) and tracked (0.06em or more). Headings and reading text stay in sentence case.
7. **No shadows on cards or panels.** A container that needs separation gets a 2px ink frame or a change of plane.
8. **Square shapes.** Controls have a 2px radius, and frames have none.
9. **Each numbered callout has a legend entry** with the same number, and the two light up together.
10. **The dotted underline** marks a heading you can read further under. Links are dotted at rest and solid on hover.
11. **Devices are drawn** with the chassis mark, never shown as a photograph.
12. **A marketing page opens on a cobalt field** with white type. Paper and mist planes alternate below it.

## Colors

### Primary

- **Plate Cobalt** (`cobalt`): the field color. On the docs home, it fills the opening, the Studio chapter, and the nav. In Studio, it fills the header rail, pressed segmented buttons, the bar under the active table tab, and the chassis mark on graph nodes. Step number dots are cobalt too. In light themes, links and the dotted heading underline are cobalt.
- **Deep Cobalt** (`cobalt-deep`): inline code text in light docs, and the hover tint for brand links.

### Secondary

- **Highlighter Yellow** (`yellow`): the action color and the selection color. It marks the Get started button, the close chapter on the docs home, the STUDIO tag beside the wordmark, and the bar under the active Studio view tab. It also marks problem counts, lit callout dots, the current sidebar page (a band behind the text), selected text, search hits, and trunk ports on a device faceplate.
- **Pressed Yellow** (`yellow-deep`): hover on yellow buttons, and the outline of VLAN segment nodes.

### Signal colors

- **Signal Red** (`signal-red`): the frame and label chip of DANGER notes on the docs.
- **Removal Red** (`removed`, `night-removed`): removed diff lines, errors, error node frames, and the error badge in Studio.
- **Warning Orange** (`warning`, `warning-strong`, `night-warning`): in Studio, warning text, dashed warning node frames, dashed one-sided cables, and the WARNING badge. On the docs, the frame and label chip of WARNING notes.
- **Added Green** (`added`, `night-added`): added diff lines, added cables, the live indicator, and linked ports.

### Neutrals

- **Paper** (`paper`, `night-paper`): reading planes, and Studio's surfaces (panel, toolbar, status rail, tables).
- **Mist** (`mist`, `night-mist`): the alternate docs chapter (How), Studio's drawing board, and field inputs.
- **Navy** (`navy`): code blocks in both themes (#060c1a in dark docs), the docs footer, and the selected button of the package switch in the close chapter.
- **Ink** (`ink`, `night-ink`): text, and every frame and rule that carries structure.
- **Soft Ink** (`soft-ink`, `night-soft-ink`): secondary text, file chips, and captions.
- **Line** (`line`, `night-line`): hairline row dividers and quiet borders.
- **Head** (`head`, `night-head`): the band behind a table's head row. The docs and Studio both use it. Studio's heads are a step stronger, #e1e7f3 light and #26325a dark. This keeps them apart from the row hover and from the raised night surface under the tables.
- **Edge** (`edge`): graph cable strokes and default control borders in Studio.
- **On-Cobalt Soft** (`on-cobalt-soft`): inactive tabs, placeholder text, and thin rules on cobalt.
- **Selected Wash** (`selected`, `night-selected`): the fill of a selected graph node, and of a row that just flashed into view.

A hovered Studio row takes a faint wash of the link color: 4.5% cobalt, or 5% night link. Only the innermost row under the pointer takes it, so it never looks like a head.

## Typography

Special Gothic carries every word that isn't code. It is a variable font: weight 400 to 700, width 75% to 125%. Its fallbacks are Segoe UI, system-ui, and sans-serif. Width does the work that a second typeface does elsewhere: wide for the wordmark and caps labels, normal for reading, and slightly condensed for the hero line.

Code and commands use ui-monospace, Cascadia Code, SFMono-Regular, Menlo, and Consolas.

Both surfaces carry the font themselves, in `docs/public/fonts` and `src/studio/app/public`, so Studio works offline. Without it, they fall back to system fonts.

| Style    | Weight | Size                                                                                                   | Line height                           | Tracking and width                  | Used for                                                                                               |
| -------- | ------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Display  | 700    | About 124px at 1536px wide, scaled with the window. `clamp(44px, 13.6vw, 72px)` under 760px.           | 0.94                                  | -0.035em, width 94%                 | The docs home title line only                                                                          |
| Headline | 700    | About 96px at 1536px wide, 52px narrow                                                                 | 1.08                                  | -0.04em                             | Docs home chapter headings, each with the dotted underline                                             |
| Title    | 700    | 46px docs h1, 30px docs h2, `clamp(30px, 3.2vw, 44px)` Studio table heading, 26px Studio panel heading | -                                     | -0.015em to -0.03em                 | Page and panel titles                                                                                  |
| Body     | 400    | 16.5px on docs pages, 17px to 19px on the docs home, 15px in Studio                                    | 1.75 docs pages, 1.6 home, 1.5 Studio | -                                   | All reading text, about 60ch to 720px wide                                                             |
| Label    | 700    | 11px to 13px, uppercase                                                                                | -                                     | 0.06em to 0.1em, width 112% to 120% | Nav links, Studio view tabs, sidebar group names, table heads, note chips, badges, panel section heads |
| Wordmark | 700    | Uppercase                                                                                              | -                                     | 0.02em to 0.05em, width 125%        | CIRCUIT in the docs nav and the Studio rail                                                            |
| Mono     | 400    | 12px to 22px                                                                                           | -                                     | -                                   | Code, commands, file names, VLAN segment labels, model numbers                                         |

## Layout

### Docs home

The home page is laid out on a drawing 1536px wide.

- Lengths in the opening scale with the window: 1px of the drawing is 0.0651vw.
- The side gutter is 3.65vw, or 16px under 760px.
- Each chapter has two columns: the heavy heading on the left (about 644 of 1536) and the reading on the right (up to about 720 of 1536). Under 760px it has one column.
- Chapters alternate paper, mist, and cobalt, and the page ends on a full yellow field.
- The illustration plate runs edge to edge at 1536:426. Under 760px it keeps a 900px stage and scrolls sideways in its own frame.

### Docs pages

Reading pages use VitePress's layout, with a 72px nav. On the home page the nav is 64px to 84px tall, on cobalt.

### Studio

Studio fills the window from top to bottom with:

1. the cobalt rail, with 52px tabs;
2. a 38px white status rail;
3. a 52px toolbar;
4. the drawing board, with a 390px panel on the right.

The rest of Studio's layout:

- Under 1180px, the search moves under the tabs. Under 760px, the tabs scroll sideways and the panel moves under the graph, at 42% of the height.
- Tables sit in a column padded `clamp(16px, 4vw, 56px)` at the sides.
- Spacing steps are 6px, 8px, 12px, 18px, and 22px.
- The drawing board has a 24px dot grid.
- Graph nodes keep at least 24px between tags side by side, and 96px between the centers of stacked tags.

## Elevation and depth

Surfaces are flat. Depth comes from planes (cobalt, paper, mist) and from ink frames:

- 2px around note blocks, tool forms, faceplates, the table of tested models on the docs home, and screenshots;
- 1px hairlines between rows.

A table's head is a tinted band, not a rule. The only shadow is under Studio's dropdown menus, such as Save image: `box-shadow: 0 8px 20px rgba(10, 26, 54, 0.18)`.

## Motion

Motion shows a change as it travels, the way the plate does: written, planned, applied, drawn. Arrivals ease out on `cubic-bezier(0.16, 1, 0.3, 1)`. Routine state changes take 0.2 to 0.3 seconds. Every animation has a reduced-motion path: nothing moves for show, and state changes happen at once.

### Docs home opening

1. The title line wipes on from left to right, behind a yellow caret that blinks three times and leaves.
2. The plates rise in the order a change travels. The editor's code and the plan sheet print line by line, and the commits appear from left to right.
3. The callouts draw in.

Then, every 7.5 seconds, the drawing makes another change to edge-b1:

1. The editor writes the change.
2. The plan prints what the RouterOS adapter sends for it, with changed lines on the selected wash.
3. Apply is pressed, and the commit joins the history as the oldest one leaves.

The editor's caret keeps blinking, and a white ring keeps leaving the changed device. It all pauses when the opening is out of view. With reduced motion, the drawing stays on the first change.

### Docs home chapters

Each part arrives once, as it scrolls into view, in a way that shows what it holds. Headings rise from below a line. The ledger shows each cause, then its effect. Steps and patterns arrive in order. The Studio screenshot slides in from the edge it runs off. A part that is already in view when the page opens doesn't move.

### Docs pages

A page reached from another page fades in and rises 8px.

### Studio graph

The first view draws the network from its busiest device outward, one ring of neighbors at a time. Each cable draws in from its nearer end.

Each layer has its own layout. On a new layer, the devices glide to their places over 0.7 seconds while its lines draw in. The view goes back to where the reader left that layer, or glides to frame it the first time.

Dots travel along every cable that both ends declare, in the link color. They turn yellow on a lit cable. A one-sided or removed cable has no dots. Lighting a part dims the rest over 0.25 seconds.

### Studio presenting

Press P, or choose Present. The panel steps aside, lines and dots get heavier, and the lit device gets a pulsing ring. The drawing drifts slowly, and the tour waits while a device is pointed at or dragged.

1. Every 6 seconds the tour moves on: first the whole layer, then its four busiest devices, one at a time.
2. The view glides over 1.1 seconds to frame each device with its neighbors. It eases in and out, and zooms evenly.
3. The lit device takes the highlighter fill, a navy frame, and lit sockets. A device with a warning or an error keeps its own frame.
4. The view zooms back out to the whole layer.
5. After 2.6 seconds, the tour moves on to the next layer that has lines. That layer draws in and gets its full 6 seconds.

A caption in a 2px ink frame says what is shown.

### Studio feedback

- The bar under a chosen view or tab grows from its middle.
- A new view fades in and rises 6px. So does a new selection in the panel.
- The live mark beats once in yellow when a changed config arrives.
- Nothing in the rails loops.

## Shapes

- **2px radius:** controls, such as buttons, inputs, menus, segmented controls, chips, badges, and inline code.
- **No radius:** note blocks, code blocks, screenshots, table frames, and pager links.
- **Circles:** only numbered dots (callouts, legend, steps) and status dots.
- **Studio's drawing board:** device tags have an 8px radius and VLAN segments 14px, so drawn parts look like labeled tags, not controls.

A device tag carries a drawn chassis mark: a cobalt block 34 by 30, with two rows of three white sockets. The sockets turn yellow when the device is selected.

## Components

### Buttons

- **Primary:** highlighter yellow with navy text, weight 700, and a drawn arrow. On the docs home it is 50px to 67px tall. In Studio it is 36px tall, like the other buttons, with an ink border.
- **Hover:** yellow-deep on paper, and white on the cobalt opening. The arrow moves 3px to the right.
- **Focus:** a 3px outline, offset 2px to 3px. It is the link color on paper and mist, yellow on the cobalt nav and Studio rail, and white inside the cobalt opening and Studio chapter.
- **Default (Studio):** paper with a 1.5px edge border, weight 600. On hover, the border and text turn cobalt, or the night link color.
- **Pressed or selected:** cobalt fill and white text. A segmented control has one 1.5px ink frame around the group, and 1.5px line dividers.

### Command copy

A mono command on navy, or on translucent navy over cobalt, with a 2px border, a 2px radius, and a drawn copy icon on the right. A click copies the command, and "Copied" appears in yellow. On the close chapter, a package-manager switch sits beside it: a 2px navy frame whose selected segment is navy with yellow text.

### Chips

- **File chips:** mono, soft ink, a 1px line border, and 2px 8px padding. They list files, not actions.
- **Studio chips:** small default buttons, 28px tall. They pick a VLAN or a layer item.
- **Badges:** caps label chips. ERROR is red with white text, and WARNING is orange with ink text.

### Cards and containers

Paper, with a 2px ink border and 16px to 22px of padding inside. Note blocks and plates have square corners. Studio's tool forms and faceplates have a 2px radius.

### Notes

A square 2px ink frame, with the note's kind on a caps label chip at the top:

| Kind         | Chip                        | Frame      |
| ------------ | --------------------------- | ---------- |
| NOTE         | Ink, with paper text        | Ink        |
| TIP and INFO | Cobalt                      | Ink        |
| WARNING      | Orange, with white text     | Orange     |
| DANGER       | Signal red, with white text | Signal red |

### Academy lessons

- **Try it:** a square 2px ink frame around a widget, with a cobalt TRY IT chip and the task in bold. Widgets draw devices with the same flat cobalt shapes on a paper ground (`SvgDevice`). Cables are edge gray and turn the link color when lit. Packets are yellow dots with a navy outline.
- **Check:** a quiz in a 2px ink frame with an ink CHECK chip. Each choice is a 44px row with a lettered dot. A right choice turns green with a tick, and a wrong one turns red and dashed with a cross. A line under the choices says why, in words.
- **Looked-up word:** a word with the dotted underline in the link color, from the storybook reference. Hovering, focusing, or tapping it opens its meaning in a small paper note with a 2px navy frame.
- **Lesson end:** a 2px ink frame with the lesson's outcome and the one yellow action, "mark it done". Once it is done, the frame and its chip turn green. A finished lesson has a green tick in the sidebar and on the Academy page.
- **Entry check and gate:** each level after the first opens with a check. Its questions sit in 2px ink frames with 40px answer rows. A wrong answer's frame turns red and dashed, and says which lesson to read again. A closed lesson shows a mist panel instead, with an ink LOCKED chip and the one yellow action: the check.
- **Feedback line:** what a widget just did, in words, after a small caps chip: green DELIVERED, red DROPPED, orange CAREFUL, or a word of the widget's own.

### Inputs

Inputs are 36px tall, with a 1.5px edge border, a 2px radius, and a mist ground. The label is on top, in 13px soft ink, weight 600. On focus, the border turns cobalt.

The Studio search sits on cobalt. It has a translucent navy fill and a soft blue border. On focus, the border turns white, with a 3px yellow outline.

### Navigation

- **Docs nav:** the wide caps wordmark, then links in 13px caps, width 112%, tracking 0.06em. The active link is in the link color, with a 2px dotted underline. On the home page, the bar sits on cobalt, with white links that turn yellow on hover.
- **Docs sidebar:** group names in 12px wide caps. The current page has a yellow highlighter band behind its text.
- **Studio rail:** the CIRCUIT wordmark and the yellow STUDIO tag, on cobalt. Ten view tabs follow, in soft blue caps that turn white. A 4px yellow bar sits under the active tab.
- **Studio table tabs:** muted text, with a 4px cobalt bar under the active tab.

### Dotted underline

The signature. A row of round cobalt dots under a heading, drawn as a repeating radial gradient, with the dots 14px to 19px apart. It follows each line of the heading. It marks docs home chapter headings, Studio table titles, and the Studio panel title. In dark themes the dots take the night link color.

Links use the same idea as a text underline: dotted, 1.5px to 2px, at rest, and solid on hover. Docs reading pages mark each h2 with a 3px ink rule over it instead.

### Numbered callouts and legend

The other signature. White dots with cobalt numbers sit over the illustration plate. A thin white leader line joins each dot to a small white dot on its part. Below a thin soft-blue rule, a legend repeats the numbers as white dots beside the part names.

- Hovering or focusing either side lights both. The dot turns yellow and grows to 1.12 times its size, the legend entry gets a dotted underline, and the callout shows a white tag with a navy frame.
- Once the drawing is in, the leaders draw in and the dots pop in, in legend order, 0.09 seconds apart, on `cubic-bezier(0.16, 1, 0.3, 1)`. Reduced motion turns this off.
- A list of steps uses the same dot, as a cobalt circle with a white number.

### Status rail (Studio)

A white bar of counts, each with a small dot. The dot is hollow for quiet counts, and filled for errors and warnings. A live indicator sits on the right. It is green when connected, and orange otherwise.

### Graph nodes (Studio)

Flat paper tags with a 2px ink frame, a drawn chassis mark, and the device name over its platform and model.

| Node or cable | Look                                                 |
| ------------- | ---------------------------------------------------- |
| Error         | 4px red frame                                        |
| Warning       | 4px orange frame, dashed                             |
| Selected      | Selected wash, with a 4px cobalt frame               |
| VLAN segment  | Yellow tint, a yellow-deep outline, and a mono label |
| Outside node  | Dotted frame                                         |
| Cable         | 2px edge stroke                                      |
| Lit cable     | 4px, in the link color                               |
| Added cable   | Green                                                |
| Removed cable | Red, dashed                                          |

### Identity marks

- **Docs favicon:** a white page with two navy lines over a cobalt dotted underline, on a cobalt square.
- **Studio favicon:** a cobalt chassis with six ports, one lit yellow, on a yellow square. It is the same chassis mark that graph nodes carry.

The two share the palette, and at a glance tell reading apart from operating. In Studio, the CIRCUIT wordmark and its yellow tag link back to the graph.

### Illustration plates

Flat illustrations with bold outlines in two or three inks. They show software (the editor, the plan sheet, the network board, the live-read card, the git history), not hardware. Each plate is a transparent WebP on the cobalt field. Words in a plate are live type over the image. The editor's code is fitted to the editor's four corners with a perspective transform, so it leans with the drawing.
