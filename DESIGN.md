---
name: Circuit
description: Cobalt fields, white planes, and a highlighter yellow, set in one variable sans-serif, for the docs site and Circuit Studio.
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

The look of the docs site and Circuit Studio. The tokens are in the front matter. Both look like a service manual's numbered parts plate: a cobalt field, flat drawings, and white numbered callouts with a legend. The docs are calm, and Studio is denser. In the dark theme, only paper, ink, lines, and the link color change.

## Rules

1. **Yellow is a highlighter.** It marks the one action in a view, the current item, and the selection. It never fills a decorative panel, except the docs home's close chapter. Text on yellow is navy or ink.
2. **Red means gone.** Red is only for something removed or broken, and for DANGER notes. Studio's warnings are orange.
3. **Color never works alone.** Every color state also has a word, a filled or hollow dot, or a dash pattern.
4. **Code sits on navy** in both themes, with light text and a yellow `$` prompt.
5. **One typeface.** Every word that isn't code is Special Gothic. Change its width and weight, never the typeface.
6. **Uppercase only for short labels**, at width 112% or more and tracking 0.06em or more. Headings and reading text stay in sentence case.
7. **No shadows on cards or panels.** A container gets a 2px ink frame or a change of plane.
8. **Square shapes.** Controls have a 2px radius, and frames have none.
9. **Each numbered callout has a legend entry** with the same number, and the two light up together.
10. **The dotted underline** marks a heading you can read further under. Links are dotted at rest and solid on hover.
11. **Devices are drawn** with the chassis mark, never shown as a photograph.
12. **A marketing page opens on a cobalt field** with white type. Paper and mist planes alternate below it.

## Colors

- `cobalt`: the field (the docs home opening and nav, Studio's rail), pressed buttons, active-tab bars in Studio's tables, step dots, and the chassis mark. In light themes, links and the dotted underline.
- `cobalt-deep`: inline code text in light docs, and hover on brand links.
- `yellow`: the action and the selection (rule 1). `yellow-deep` is its hover, and the outline of VLAN segments.
- `signal-red`: DANGER notes. `removed`: removed diff lines, errors, and error frames and badges.
- `warning`, `warning-strong`: Studio's warnings, dashed one-sided cables, and WARNING notes.
- `added`: added diff lines and cables, the live indicator, and linked ports.
- `paper`: reading planes and Studio's surfaces. `mist`: the alternate docs chapter, Studio's drawing board, and inputs.
- `navy`: code blocks (#060c1a in dark docs) and the docs footer.
- `ink`: text, and every frame and rule that carries structure. `soft-ink`: secondary text, file chips, and captions.
- `line`: hairline dividers and quiet borders. `edge`: Studio's cables and default control borders.
- `head`: a table's head band. Studio's heads are a step stronger: #e1e7f3 light and #26325a dark.
- `on-cobalt-soft`: inactive tabs, placeholder text, and thin rules on cobalt.
- `selected`: a selected graph node, and a row that just flashed into view.

Each `night-` token is the dark theme's value. A hovered Studio row takes 4.5% cobalt, or 5% night link, on the innermost row only.

## Typography

Special Gothic is a variable font: weight 400 to 700, width 75% to 125%. Width does the work of a second typeface: wide for the wordmark and caps labels, normal for reading, and slightly condensed for the hero line. Both surfaces carry the font, in `docs/public/fonts` and `src/studio/app/public`.

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

Docs home, drawn at 1536px wide:

- In the opening, 1px of the drawing is 0.0651vw.
- The side gutter is 3.65vw, or 16px under 760px.
- A chapter has the heading on the left (about 644 of 1536) and the reading on the right (up to about 720 of 1536). Under 760px it has one column.
- Chapters alternate paper, mist, and cobalt, and the page ends on a full yellow field.
- The illustration plate runs edge to edge at 1536:426. Under 760px it keeps a 900px stage and scrolls sideways in its own frame.

Docs pages use VitePress's layout, with a 72px nav. On the home page the nav is 64px to 84px tall, on cobalt.

Studio fills the window: the cobalt rail with 52px tabs, a 38px status rail, a 52px toolbar, then the drawing board with a 390px panel on the right.

- Under 1180px, the search moves under the tabs. Under 760px, the tabs scroll sideways and the panel moves under the graph, at 42% of the height.
- Tables sit in a column padded `clamp(16px, 4vw, 56px)` at the sides.
- Spacing steps are 6px, 8px, 12px, 18px, and 22px.
- The drawing board has a 24px dot grid.
- Graph nodes keep at least 24px between tags side by side, and 96px between the centers of stacked tags.

## Depth

Depth comes from planes and ink frames: 2px around note blocks, tool forms, faceplates, the tested-models table on the docs home, and screenshots, and 1px hairlines between rows. A table's head is a tinted band, not a rule. The only shadow is under Studio's dropdown menus: `box-shadow: 0 8px 20px rgba(10, 26, 54, 0.18)`.

## Motion

Motion shows a change as it travels. Arrivals ease out on `cubic-bezier(0.16, 1, 0.3, 1)`. Routine state changes take 0.2 to 0.3 seconds. Every animation has a reduced-motion path, in which state changes happen at once. A looping part pauses while it is out of view, and nothing in Studio's rails loops.

- A docs page reached from another page fades in and rises 8px. A new Studio view or panel selection fades in and rises 6px.
- A part of the docs home arrives once, as it scrolls into view. A part already in view when the page opens doesn't move.
- The bar under a chosen tab grows from its middle.
- In Studio's graph, devices glide to a new layout over 0.7 seconds, and lighting a part dims the rest over 0.25 seconds. Dots travel along each cable that both ends declare, and turn yellow on a lit cable.
- The live mark beats once in yellow when a changed config arrives.

## Shapes

- **2px radius:** controls, such as buttons, inputs, menus, segmented controls, chips, badges, and inline code.
- **No radius:** note blocks, code blocks, screenshots, table frames, and pager links.
- **Circles:** only numbered dots and status dots.
- **Studio's drawing board:** device tags have an 8px radius and VLAN segments 14px, so they look like tags, not controls.
- **Chassis mark:** a cobalt block 34 by 30, with two rows of three white sockets that turn yellow when the device is selected.

## Components

### Buttons

- **Primary:** yellow with navy text, weight 700, and a drawn arrow. On the docs home it is 50px to 67px tall. In Studio it is 36px tall, with an ink border. On hover it turns yellow-deep on paper and white on the cobalt opening, and the arrow moves 3px to the right.
- **Default (Studio):** paper with a 1.5px edge border, weight 600. On hover, the border and text turn the link color.
- **Pressed or selected:** cobalt with white text. A segmented control has one 1.5px ink frame around the group, and 1.5px line dividers.
- **Focus:** a 3px outline, offset 2px to 3px. It is the link color on paper and mist, yellow on the cobalt nav and Studio rail, and white inside the cobalt opening and Studio chapter.

### Command copy

A mono command on navy, or on translucent navy over cobalt, with a 2px border, a 2px radius, and a drawn copy icon on the right. A click copies it and shows "Copied" in yellow. The close chapter adds a package-manager switch: a 2px navy frame whose selected segment is navy with yellow text.

### Chips

- **File chips:** mono, soft ink, a 1px line border, and 2px 8px padding. They list files, not actions.
- **Studio chips:** small default buttons, 28px tall, that pick a VLAN or a layer item.
- **Badges:** caps label chips. ERROR is red with white text, and WARNING is orange with ink text.

### Containers

Paper with a 2px ink border and 16px to 22px of padding. Note blocks and plates have square corners. Studio's tool forms and faceplates have a 2px radius.

### Notes

A square 2px ink frame, with the note's kind on a caps label chip at the top:

| Kind         | Chip                        | Frame      |
| ------------ | --------------------------- | ---------- |
| NOTE         | Ink, with paper text        | Ink        |
| TIP and INFO | Cobalt                      | Ink        |
| WARNING      | Orange, with white text     | Orange     |
| DANGER       | Signal red, with white text | Signal red |

### Academy lessons

- **Try it:** a 2px ink frame around a widget, with a cobalt TRY IT chip and the task in bold. Widgets draw devices with `SvgDevice` on paper. Cables are edge gray and turn the link color when lit. Packets are yellow dots with a navy outline.
- **Check:** a quiz in a 2px ink frame with an ink CHECK chip. Each choice is a 44px row with a lettered dot. A right choice turns green with a tick. A wrong one turns red and dashed, with a cross. A line under the choices says why.
- **Looked-up word:** a dotted underline in the link color. Hovering, focusing, or tapping it opens its meaning in a small paper note with a 2px navy frame.
- **Lesson end:** a 2px ink frame with the lesson's outcome and the one yellow action, "Mark as done". Once it is done, the frame and its chip turn green, and the lesson gets a green tick in the sidebar and on the Academy page.
- **Entry check and gate:** the check's questions sit in 2px ink frames with 40px answer rows. A wrong answer's frame turns red and dashed, and names the lesson to read again. A closed lesson shows a mist panel with an ink LOCKED chip, and the check as the one yellow action.
- **Feedback line:** a small caps chip, then what the widget just did. The chip is green DELIVERED, red DROPPED, orange CAREFUL, or a word of the widget's own.

### Inputs

36px tall, with a 1.5px edge border, a 2px radius, and a mist ground. The label is on top, in 13px soft ink, weight 600. On focus, the border turns cobalt.

The Studio search sits on cobalt. It has a translucent navy fill and a soft blue border. On focus, the border turns white, with a 3px yellow outline.

### Navigation

- **Docs nav:** the wide caps wordmark, then links in 13px caps, width 112%, tracking 0.06em. The active link is in the link color, with a 2px dotted underline. On the home page, the bar sits on cobalt, with white links that turn yellow on hover.
- **Docs sidebar:** group names in 12px wide caps. The current page has a yellow band behind its text.
- **Studio rail:** the CIRCUIT wordmark and the yellow STUDIO tag on cobalt, linking to the graph. The view tabs follow, in soft blue caps that turn white, with a 4px yellow bar under the active tab.
- **Studio table tabs:** muted text, with a 4px cobalt bar under the active tab.

### Dotted underline

A row of round dots in the link color under a heading, drawn as a repeating radial gradient, 14px to 19px apart. It follows each line of the heading. It marks docs home chapter headings, Studio table titles, and the Studio panel title. Links are dotted 1.5px to 2px at rest. Docs reading pages mark each h2 with a 3px ink rule over it instead.

### Numbered callouts and legend

White dots with cobalt numbers sit over the illustration plate, each joined to its part by a thin white leader line. A legend below repeats the numbers. Hovering or focusing either side lights both: the dot turns yellow and grows to 1.12 times its size. A list of steps uses the same dot, as a cobalt circle with a white number.

### Status rail (Studio)

A white bar of counts, each with a dot: hollow for quiet counts, and filled for errors and warnings. The live indicator on the right is green when connected, and orange otherwise.

### Graph nodes (Studio)

Flat paper tags with a 2px ink frame, the chassis mark, and the device name over its platform and model.

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

### Illustration plates

Flat illustrations with bold outlines in two or three inks, on the cobalt field as transparent WebP. They show software, never hardware. Words in a plate are live type over the image.
