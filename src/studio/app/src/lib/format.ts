// A value of the model as text, the way Studio's tables show it.

export class Format {
    static isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    /** `secret("NAME")` or `secretFile("path")` in the model: shown as the project writes it, never as a value. */
    static isSecret(value: unknown): value is { secret: string } | { secret_file: string } {
        return (
            Format.isObject(value) &&
            Object.keys(value).length === 1 &&
            (typeof value.secret === "string" || typeof value.secret_file === "string")
        );
    }

    /** A value in one line of text. */
    static compact(value: unknown): string {
        if (value === undefined || value === null) return "";
        if (Format.isSecret(value)) return "secret" in value ? `secret("${value.secret}")` : `secretFile("${value.secret_file}")`;
        if (Array.isArray(value)) return value.map(Format.compact).join(value.every((item) => !Format.isObject(item)) ? ", " : " / ");

        // A field written as `{}`, such as `ssh: {}`, is on with its defaults.
        if (Format.isObject(value) && !Object.keys(value).length) return "on";
        if (Format.isObject(value)) {
            return Object.entries(value)
                .map(([key, inner]) => (inner === true ? key : `${key} ${Format.compact(inner)}`))
                .join(", ");
        }

        return String(value);
    }

    /** "1 error", "2 errors". */
    static count(count: number, one: string, many = `${one}s`): string {
        return `${count} ${count === 1 ? one : many}`;
    }
}
