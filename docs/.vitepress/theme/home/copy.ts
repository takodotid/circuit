// Copying a command from the home page. The opening and the close share the last one copied, so a button showing the same command says so too.

import { ref } from "vue";

// The command last copied, which says so for a moment.
const copied = ref("");

export function useCopy() {
    async function copy(command: string) {
        await navigator.clipboard.writeText(command);
        copied.value = command;
        setTimeout(() => (copied.value = ""), 1500);
    }

    return { copied, copy };
}
