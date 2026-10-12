// @ts-check
/// <reference lib="dom" />
// Saving what Studio shows: a table as CSV, and the graph as SVG or PNG, drawn the way it looks on screen.

/** The properties that make the drawing look as it does, copied onto each element, since a saved SVG has no stylesheet. */
const DRAWN = [
    "fill",
    "stroke",
    "stroke-width",
    "stroke-dasharray",
    "stroke-linejoin",
    "paint-order",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "text-anchor",
    "dominant-baseline",
    "display",
];

/**
 * Hand the browser a file to save.
 *
 * @param {string} name
 * @param {Blob} blob
 */
export function save(name, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A table as CSV: its header, then each row, every cell as the text it shows.
 *
 * @param {HTMLTableElement} table
 */
export function csvOf(table) {
    /** @param {string} text */
    const field = (text) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const rows = [...table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr")];

    return rows.map((row) => [...row.children].map((cell) => field(cell.textContent?.trim() ?? "")).join(",")).join("\n") + "\n";
}

/**
 * The drawing as an SVG file of its own: the drawn parts, framed around what is drawn, with each element's look written onto it.
 *
 * @param {SVGElement} svg
 * @param {SVGGraphicsElement} viewport
 * @returns {{ text: string, width: number, height: number }}
 */
export function svgOf(svg, viewport) {
    const box = viewport.getBBox();
    const margin = 24;
    const width = Math.ceil(box.width + margin * 2);
    const height = Math.ceil(box.height + margin * 2);

    const copy = /** @type {SVGElement} */ (svg.cloneNode(true));
    const originals = [svg, ...svg.querySelectorAll("*")];
    const copies = [copy, ...copy.querySelectorAll("*")];

    for (const [index, original] of originals.entries()) {
        const target = copies[index];
        if (!(target instanceof SVGElement)) continue;

        const look = getComputedStyle(original);
        target.setAttribute("style", DRAWN.map((name) => `${name}:${look.getPropertyValue(name)}`).join(";"));
        target.removeAttribute("class");
    }

    // The drawing's own place on screen is left out: the file is framed around what is drawn.
    copy.querySelector("#viewport")?.removeAttribute("transform");
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.setAttribute("viewBox", `${box.x - margin} ${box.y - margin} ${width} ${height}`);
    copy.setAttribute("width", String(width));
    copy.setAttribute("height", String(height));

    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("x", String(box.x - margin));
    background.setAttribute("y", String(box.y - margin));
    background.setAttribute("width", String(width));
    background.setAttribute("height", String(height));
    background.setAttribute("fill", getComputedStyle(document.body).backgroundColor);
    copy.prepend(background);

    return { text: new XMLSerializer().serializeToString(copy), width, height };
}

/**
 * An SVG drawn into a PNG, at twice its size so it stays sharp.
 *
 * @param {{ text: string, width: number, height: number }} drawing
 * @returns {Promise<Blob>}
 */
export function pngOf(drawing) {
    const scale = 2;
    const image = new Image();
    const url = URL.createObjectURL(new Blob([drawing.text], { type: "image/svg+xml" }));

    return new Promise((done, fail) => {
        image.addEventListener("load", () => {
            const canvas = document.createElement("canvas");
            canvas.width = drawing.width * scale;
            canvas.height = drawing.height * scale;

            const context = canvas.getContext("2d");
            if (!context) return fail(new Error("this browser cannot draw a PNG"));

            context.scale(scale, scale);
            context.drawImage(image, 0, 0);
            URL.revokeObjectURL(url);
            canvas.toBlob((blob) => (blob ? done(blob) : fail(new Error("the PNG could not be made"))), "image/png");
        });
        image.addEventListener("error", () => fail(new Error("the drawing could not be read back")));
        image.src = url;
    });
}
