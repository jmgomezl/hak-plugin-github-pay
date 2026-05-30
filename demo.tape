# github-pay — demo recording (vhs).  Run:  vhs demo.tape
# Requires the active `node` to be >= 20 (the Hedera SDK needs it).
Output demo.gif

Set Shell "zsh"
Set FontSize 13
Set Width 1080
Set Height 760
Set Theme "Dracula"
Set Padding 22
Set PlaybackSpeed 1.6

Hide
Type "clear"
Enter
Show

Sleep 1s
Type "node scripts/demo.mjs"
Sleep 500ms
Enter

# Let the live on-chain flow play out fully (create + writes + mirror wait + transfer + idempotency).
Sleep 34s
