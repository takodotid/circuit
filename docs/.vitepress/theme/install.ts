// The command that installs Circuit on each system, and which system the visitor is on, for the tabs on the home page and the install page.

export type System = "windows" | "macos" | "linux";

export class Install {
    static readonly UNIX = "curl -fsSL https://circuit.tako.id/install | sh";
    static readonly WINDOWS = "irm https://circuit.tako.id/install.ps1 | iex";

    /** One tab per system, in this order. */
    static readonly SYSTEMS: readonly { id: System; name: string; shell: string; command: string }[] = [
        { id: "windows", name: "Windows", shell: "PowerShell", command: Install.WINDOWS },
        { id: "macos", name: "macOS", shell: "Terminal", command: Install.UNIX },
        { id: "linux", name: "Linux", shell: "a terminal", command: Install.UNIX },
    ];

    /** The visitor's system, from the browser. Linux when it can't tell, and on the server, where the page is built. */
    static detect(): System {
        if (typeof navigator === "undefined") return "linux";

        const platform =
            (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
        const text = `${platform} ${navigator.userAgent}`.toLowerCase();

        if (/mac|iphone|ipad/.test(text)) return "macos";
        if (/\bwin/.test(text)) return "windows";
        return "linux";
    }
}
