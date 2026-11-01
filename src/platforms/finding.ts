/** Something wrong with a config, as `circuit validate` reports it. */
export type Finding = {
    /** An error stops `diff` and `apply`; a warning is reported only. */
    level: "error" | "warning";
    /** The device it is about, when it is about one. */
    device?: string;
    /** What is wrong, in a sentence. */
    message: string;
};
