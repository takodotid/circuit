// Everyone who passed the Circuit Academy certification, newest last. The graduates page lists them, and anyone can check a certificate by its ID there.
// A graduate is added here by the maintainers once their case is reviewed, with their consent to be listed.

export type Graduate = {
    /** The ID printed on the certificate. */
    id: string;
    /** The name as the graduate wants it shown. */
    name: string;
    /** The day the certificate was given, as YYYY-MM-DD. */
    date: string;
    /** A page of the graduate's own, such as a GitHub or LinkedIn profile. */
    link?: string;
};

export const graduates: Graduate[] = [];
