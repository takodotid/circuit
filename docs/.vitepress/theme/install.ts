// The command that installs Circuit on each system, and which system the visitor is on, for the tabs on the home page and the install page.

export type System = "windows" | "unix";

export class Install {
    static readonly UNIX = "curl -fsSL https://circuit.tako.id/install | sh";
    static readonly WINDOWS = "irm https://circuit.tako.id/install.ps1 | iex";

    /** One tab per system, in this order. macOS and Linux take the same command. */
    static readonly SYSTEMS: readonly { id: System; name: string; shell: string; command: string }[] = [
        { id: "windows", name: "Windows", shell: "PowerShell", command: Install.WINDOWS },
        { id: "unix", name: "macOS & Linux", shell: "a terminal", command: Install.UNIX },
    ];

    /** The visitor's system, from the browser. macOS & Linux when it can't tell, and on the server, where the page is built. */
    static detect(): System {
        if (typeof navigator === "undefined") return "unix";

        const platform =
            (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";

        return /^win/i.test(platform) || /windows/i.test(navigator.userAgent) ? "windows" : "unix";
    }
}
