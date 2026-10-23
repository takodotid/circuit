// The drawing in the home page's opening: three plates, the words set into them, the numbered callouts over them, and the changes it goes through.

export type Plate = "editor" | "plan" | "network";

export class HomeDrawing {
    // The drawing is laid out on a 1536-pixel-wide frame whose band starts 230 pixels down; everything in it scales with the band's width.
    private static readonly FRAME = 15.36;
    private static readonly TOP = 230;

    // Each plate is a 1536 by 1024 drawing fitted whole into its box on the frame.
    private static readonly PLATES: Record<Plate, { x: number; y: number; w: number; h: number }> = {
        editor: { x: 0, y: 236, w: 600, h: 420 },
        plan: { x: 430, y: 250, w: 620, h: 406 },
        network: { x: 960, y: 272, w: 576, h: 384 },
    };

    // Each plate as drawn.
    static readonly ARTS = [
        { plate: "editor", src: "/illustrations/home/plate-editor.webp" },
        { plate: "plan", src: "/illustrations/home/plate-plan.webp" },
        { plate: "network", src: "/illustrations/home/plate-network.webp" },
    ] as const;

    // The editor in the drawing leans away to the right. Its words are set flat on a window of this size, then bent onto the
    // editor's four corners in the drawing, so they lean with it.
    private static readonly WINDOW = { width: 870, height: 760 };
    private static readonly EDITOR = [
        [580, 92],
        [1450, 150],
        [1450, 850],
        [580, 855],
    ];

    /** The parts of the drawing, each a numbered callout pointing at its place and an entry in the legend under it. */
    static readonly PARTS = [
        {
            name: "Device file",
            link: "/guide/devices",
            meaning: "One TypeScript file for each router or switch. Your editor checks every name as you type.",
            callout: [117, 255],
            target: [178, 290],
        },
        {
            name: "Check",
            link: "/guide/network#checks",
            meaning: "A rule about your network that every change must pass, run on all devices together.",
            callout: [1219, 267],
            target: [1165, 312],
        },
        {
            name: "Plan",
            link: "/guide/convergence#making-the-plan",
            meaning: "Every command that would be sent, in the device's own language, before anything is sent.",
            callout: [830, 266],
            target: [778, 320],
        },
        {
            name: "Apply",
            link: "/guide/convergence",
            meaning: "Sends the plan only when you confirm it, the safest way the device allows.",
            callout: [1006, 303],
            target: [968, 352],
        },
        {
            name: "Snapshot",
            link: "/guide/glossary",
            meaning: "What a device ran when Circuit last read it, kept in .circuit/state/.",
            callout: [1452, 296],
            target: [1424, 355],
        },
        {
            name: "Git history",
            link: "/studio/changes",
            meaning: "Every change, with its author and its reason, in your own repository.",
            callout: [1405, 567],
            target: [1319, 612],
        },
    ].map((part, index) => {
        const [x, y] = part.callout;
        const [tx, ty] = part.target;

        return {
            ...part,
            number: index + 1,
            style: {
                "--x": HomeDrawing.cq(x),
                "--y": HomeDrawing.cq(y - HomeDrawing.TOP),
                "--length": HomeDrawing.cq(Math.hypot(tx - x, ty - y)),
                "--angle": `${((Math.atan2(ty - y, tx - x) * 180) / Math.PI).toFixed(1)}deg`,
                "--order": index,
            },
        };
    });

    static readonly NODES = [
        { name: "core-a1", x: 710, y: 240 },
        { name: "edge-b1", x: 455, y: 408, changed: true },
        { name: "edge-a1", x: 915, y: 403 },
        { name: "agg-b1", x: 478, y: 597 },
        { name: "tor-b1", x: 855, y: 612 },
    ];

    // The git history under the drawing: a commit at each station, the newest the change in the plan.
    static readonly STATIONS = [155, 432, 708, 957];

    /**
     * The changes the drawing goes through, one after another: what is written in the editor, the plan Circuit makes of it against
     * the snapshot, and the commit it ends in. Each plan is what the RouterOS adapter prints for that change, its long lines wrapped.
     */
    static readonly CHANGES = [
        {
            code: [
                "export default defineDevice({",
                '  name: "edge-b1",',
                '  platform: "routeros",',
                "  vlans: { sirius: { id: 1012 } },",
                "  interfaces: {",
                "    sirius: {",
                '      type: "vlan",',
                '      vlan: "sirius",',
                '      addresses: ["198.51.100.169/29"],',
                "    },",
                "  },",
                "});",
            ],
            plan: "edge-b1: 3 commands in 3 steps",
            lines: [
                "/interface vlan",
                "+ add interface=bridge",
                "+   name=sirius vlan-id=1012",
                "/interface bridge vlan",
                "+ add bridge=bridge",
                "+   tagged=bridge vlan-ids=1012",
                "/ip address",
                "+ add address=198.51.100.169/29",
                "+   interface=sirius",
            ],
            commit: { hash: "c03a8e5", message: "add sirius" },
        },
        {
            code: [
                "export default defineDevice({",
                '  name: "edge-b1",',
                '  platform: "routeros",',
                "  ports: {",
                '    "25g-12": {',
                '      description: "edge-a2",',
                "      mtu: 9000,",
                '      addresses: ["10.254.0.3/31"],',
                "    },",
                "  },",
                "});",
            ],
            plan: "edge-b1: 2 commands in 2 steps",
            lines: [
                "/interface ethernet",
                "~ set [ find",
                "~     default-name=sfp28-12 ]",
                "~   comment=edge-a2 mtu=9000",
                "~   disabled=no",
                "/ip address",
                "+ add address=10.254.0.3/31",
                "+   comment=edge-a2",
                "+   interface=sfp28-12",
            ],
            commit: { hash: "7d19b42", message: "wave to edge-a2" },
        },
        {
            code: [
                "export default defineDevice({",
                '  name: "edge-b1",',
                '  platform: "routeros",',
                "  routing: {",
                "    static: [",
                "      {",
                '        prefix: "0.0.0.0/0",',
                '        via: "203.0.113.9",',
                "      },",
                "    ],",
                "  },",
                "});",
            ],
            plan: "edge-b1: 1 command in 1 step",
            lines: ["/ip route", "- add comment=Lab", "-   dst-address=10.9.0.0/16", "-   gateway=10.1.50.254"],
            commit: { hash: "2ea06f1", message: "drop lab route" },
        },
        {
            code: [
                "export default defineDevice({",
                '  name: "edge-b1",',
                '  platform: "routeros",',
                "  system: {",
                "    dns: {",
                "      servers: [",
                '        "10.0.20.53",',
                '        "10.0.20.54",',
                "      ],",
                "    },",
                '    ntp: { servers: ["10.0.20.123"] },',
                "  },",
                "});",
            ],
            plan: "edge-b1: 3 commands in 3 steps",
            lines: [
                "/ip dns",
                "~ set servers=10.0.20.53,",
                "~   10.0.20.54",
                "/system ntp client",
                "~ set enabled=yes",
                "/system ntp client servers",
                "+ add address=10.0.20.123",
            ],
            commit: { hash: "b58c3d9", message: "dns and ntp" },
        },
    ];

    /** The git history under the drawing as the page opens: three older commits, then the first change's. */
    static readonly HISTORY = [
        { hash: "4f2c1a0", message: "add tor-b1" },
        { hash: "9be71d3", message: "fix mtu" },
        { hash: "e05b6c8", message: "tor-a2 ports" },
        HomeDrawing.CHANGES[0]!.commit,
    ];

    /** A length on the frame, as a share of the band's width. */
    private static cq(pixels: number) {
        return `${(pixels / HomeDrawing.FRAME).toFixed(3)}cqw`;
    }

    /** A label set into the drawing, at its place on the frame. */
    private static at(x: number, y: number) {
        return { left: HomeDrawing.cq(x), top: HomeDrawing.cq(y - HomeDrawing.TOP) };
    }

    /** A label set into a plate, at a point of the plate's own drawing. */
    static on(plate: Plate, x: number, y: number) {
        const box = HomeDrawing.PLATES[plate];
        const scale = Math.min(box.w / 1536, box.h / 1024);

        return HomeDrawing.at(box.x + (box.w - 1536 * scale) / 2 + x * scale, box.y + (box.h - 1024 * scale) / 2 + y * scale);
    }

    /** A plate's box on the frame. */
    static box(plate: Plate) {
        const { x, y, w, h } = HomeDrawing.PLATES[plate];
        return { left: HomeDrawing.cq(x), top: HomeDrawing.cq(y - HomeDrawing.TOP), width: HomeDrawing.cq(w), height: HomeDrawing.cq(h) };
    }

    /** The CSS transform that bends a flat box of the window's size onto four corners, given clockwise from the top left. */
    private static bend(corners: number[][]) {
        const { WINDOW } = HomeDrawing;
        const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = corners as [number, number][];
        const dx1 = x1 - x2;
        const dx2 = x3 - x2;
        const dx3 = x0 - x1 + x2 - x3;
        const dy1 = y1 - y2;
        const dy2 = y3 - y2;
        const dy3 = y0 - y1 + y2 - y3;
        const denominator = dx1 * dy2 - dx2 * dy1;
        const g = (dx3 * dy2 - dx2 * dy3) / denominator;
        const h = (dx1 * dy3 - dx3 * dy1) / denominator;

        const a = (x1 - x0 + g * x1) / WINDOW.width;
        const b = (x3 - x0 + h * x3) / WINDOW.height;
        const d = (y1 - y0 + g * y1) / WINDOW.width;
        const e = (y3 - y0 + h * y3) / WINDOW.height;

        return `matrix3d(${[a, d, 0, g / WINDOW.width, b, e, 0, h / WINDOW.height, 0, 0, 1, 0, x0, y0, 0, 1].join(",")})`;
    }

    /** The style that bends the editor's words onto the drawing, for a drawing this many pixels wide. */
    static editorStyle(width: number): Record<string, string> {
        const box = HomeDrawing.PLATES.editor;
        const scale = Math.min(box.w / 1536, box.h / 1024);
        const left = box.x + (box.w - 1536 * scale) / 2;
        const top = box.y - HomeDrawing.TOP + (box.h - 1024 * scale) / 2;
        const pixels = width / 1536;

        const corners = HomeDrawing.EDITOR.map(([x, y]) => [(left + x * scale) * pixels, (top + y * scale) * pixels]);

        return {
            width: `${HomeDrawing.WINDOW.width}px`,
            height: `${HomeDrawing.WINDOW.height}px`,
            transform: HomeDrawing.bend(corners),
        };
    }

    /** A line of the editor's code, split into the parts its colours mark. */
    static tokens(line: string) {
        return line
            .split(/("[^"]*"|export default|defineDevice|\b\d+\b)/)
            .filter(Boolean)
            .map((text) => ({
                text,
                kind: text.startsWith('"')
                    ? "s"
                    : text === "export default"
                      ? "k"
                      : text === "defineDevice"
                        ? "f"
                        : /^\d+$/.test(text)
                          ? "n"
                          : "",
            }));
    }

    /** A line of the plan, marked by what it does: added, removed, changed, or the section it is in. */
    static planLine(line: string) {
        const kind = { "+": "added", "-": "removed", "~": "changed" }[line[0] ?? ""];
        const text = kind && line[1] === " " && line[2] === " " ? `  ${line.slice(3)}` : line;
        return { text, kind };
    }
}
