/** Minutes east of UTC an IANA zone is at now, for platforms that take an offset rather than a zone. */
export function offset(zone: string): number {
    const name = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "longOffset",
    })
        .formatToParts(new Date())
        .find((entry) => entry.type === "timeZoneName")!.value;
    const found = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (!found) return 0;

    const [, sign, hours, minutes] = found;
    const sizeInMinutes = Number(hours) * 60 + Number(minutes);
    return sign === "-" ? -sizeInMinutes : sizeInMinutes;
}
