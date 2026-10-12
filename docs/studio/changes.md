# Reviewing changes

Studio can set your files now beside an earlier state of them: another branch, a tag, or any commit. It needs your project in git, which it is if you commit `.circuit/` as [the network page](/guide/network#the-circuit-directory) asks.

## Compare

1. Open **Compare** in the top bar.
2. Pick a branch, tag or recent commit, or type a name such as `main` or `HEAD~3`.
3. Studio reads the network as it was there and shows what differs:
    - devices added, removed, and those whose config changes, each with what it would run then and now, line by line;
    - lines of the graph added and gone, layer by layer;
    - what `circuit validate` finds newly, and what it no longer finds.
4. **Show the changes in the graph** draws new lines in green and lines that are gone in red, dashed. **Stop comparing**, on the right, puts the graph back.

Before you merge a pull request, compare its branch with `main` to see what it changes in the network, not only in the files.

Studio reads the other commit in a checkout under `.circuit/cache/`, which git ignores, and removes it once read. It reads that commit with the Circuit installed now, so the comparison shows changes to your files, not changes to Circuit.

## A device's history

A device's **History** page lists the commits that changed its file or its snapshot, newest first, with who made them and when. **compare with now** opens Compare at that commit.

A device whose name is built from parts, such as `` `edge-0${n}` ``, has no file studio can find, so its history comes from its snapshot alone.
