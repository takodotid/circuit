// Saving what Studio shows: a table as CSV, and the graph as an image.

export class Export {
    /** How long the browser keeps a saved file's address, long enough to start the download. */
    private static readonly KEEP_URL = 1000;

    /** A table's rows as CSV, each cell quoted when it needs to be. */
    static csv(head: readonly string[], rows: readonly (readonly string[])[]): string {
        const cell = (text: string) => (/[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
        return `${[head, ...rows].map((row) => row.map(cell).join(",")).join("\n")}\n`;
    }

    /** Hand a file to the browser to save. */
    static save(name: string, blob: Blob): void {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), Export.KEEP_URL);
    }
}
