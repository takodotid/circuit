// Lesson: counting like a computer. What a row of eight bits is worth, shared by BitSwitches and BitChallenges.

export class Bits {
    /** What each of the eight switches is worth, from the left. */
    static readonly PLACES = [128, 64, 32, 16, 8, 4, 2, 1];

    /** The eight bits of a number from 0 to 255, from the left. */
    static of(value: number): number[] {
        return Bits.PLACES.map((place) => (value & place ? 1 : 0));
    }

    /** The number a row of eight bits stands for. */
    static value(bits: number[]): number {
        return bits.reduce((sum, bit, index) => sum + bit * Bits.PLACES[index]!, 0);
    }

    /** The bits as text, such as "11000000". */
    static text(value: number): string {
        return Bits.of(value).join("");
    }

    /** The sum that makes the number, such as "128 + 64", or "nothing" for 0. */
    static sum(value: number): string {
        const parts = Bits.PLACES.filter((place) => value & place);
        return parts.length ? parts.join(" + ") : "nothing";
    }
}
