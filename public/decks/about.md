# magpie.md - How it works

How are cards written in a deck file?
---
Each card is:

```
front text
---
back text
===
```

`---` splits front from back, `===` separates cards.
The back supports **bold**, *italic*, `code`, lists and more.
===
Does this app ever show only a *subset* of my cards?
---
**No.** Every study session includes the **entire** deck.

Order can be *weighted* (wrong/unseen cards first), *shuffled*, or *original* -
but you always see all of them.
===
Where is my progress stored?
---
In your browser's **localStorage**, keyed per deck.

It survives reloads. Clearing site data wipes it - so export if you care.
===
How do I move my progress between devices?
---
Use **Export .md + progress**.

Your per-card stats are baked into hidden HTML comments like:

```
<!-- magpie seen=4 correct=3 wrong=1 last=right -->
```

Re-import that file anywhere to restore your stats - even onto a deck you already
have; newer per-card records win, so it merges instead of clobbering.
===
Can I edit cards inside the app?
---
No - editing happens in your **markdown files**.

Edit in any text editor, re-import, and study. The app stays a focused reader.
