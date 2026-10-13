// Lesson: counting like a computer. What a row of eight bits is worth, shared by BitSwitches and BitChallenges.

/** What each of the eight switches is worth, from the left. */
export const placeValues = [128, 64, 32, 16, 8, 4, 2, 1];

/** The eight bits of a number from 0 to 255, from the left. */
export function bitsOf(value: number): number[] {
    return placeValues.map((place) => (value & place ? 1 : 0));
}

/** The number a row of eight bits stands for. */
export function valueOf(bits: number[]): number {
    return bits.reduce((sum, bit, index) => sum + bit * placeValues[index]!, 0);
}

/** The bits as text, such as "11000000". */
export function bitText(value: number): string {
    return bitsOf(value).join("");
}

/** The sum that makes the number, such as "128 + 64", or "nothing" for 0. */
export function sumText(value: number): string {
    const parts = placeValues.filter((place) => value & place);
    return parts.length ? parts.join(" + ") : "nothing";
}
