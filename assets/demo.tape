# VHS tape — records the html-share skill demo GIF.
# Run from the repo root:  vhs assets/demo.tape   (writes assets/demo.gif).
# Needs deps installed (cd scripts && bun install) and an EXTEND.md bound to a
# reachable backend. See assets/README.md.

Output assets/demo.gif

Set Shell "bash"
Set FontSize 17
Set Width 880
Set Height 660
Set Padding 28
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

# Hidden setup: clean prompt, a fresh report.html at the repo root, empty screen.
# Re-share fresh so the demo shows the full link + QR + card output.
Hide
Type "export PS1='❯ '" Enter
Type "cp assets/report.html ./report.html" Enter
Type "rm -rf html-share" Enter
Type "clear" Enter
Sleep 400ms
Show

Sleep 600ms
Type "bun scripts/main.ts ./report.html --pretty"
Sleep 700ms
Enter
Sleep 5s
Sleep 1500ms

# Cleanup (hidden).
Hide
Type "rm -f ./report.html && rm -rf html-share" Enter
