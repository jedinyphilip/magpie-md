'use strict';
// sample decks, embedded so they show offline / on file://

const SAMPLE_DECKS = [
  {
    "title": "Capital Cities",
    "description": "World capitals - a quick demo deck",
    "source": "# Capital Cities\n\nWhat is the capital of **France**?\n---\nParis\n===\nWhat is the capital of **Japan**?\n---\nTokyo\n===\nWhat is the capital of **Australia**?\n---\nCanberra\n\n(Not Sydney - a common trap!)\n===\nWhat is the capital of **Canada**?\n---\nOttawa\n===\nWhat is the capital of **Brazil**?\n---\nBrasília\n===\nWhat is the capital of **Egypt**?\n---\nCairo\n===\nWhat is the capital of **Norway**?\n---\nOslo\n===\nWhat is the capital of **South Korea**?\n---\nSeoul\n"
  },
  {
    "title": "Math & Physics",
    "description": "Demonstrates LaTeX equation rendering ($ and $$)",
    "source": "# Math & Physics\n\nState the **quadratic formula** for $ax^2 + bx + c = 0$.\n---\n$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n===\nWhat is the derivative of $\\sin(x)$?\n---\n$\\cos(x)$\n===\nWrite the definition of the **derivative** as a limit.\n---\n$$f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$$\n===\nState **Euler's identity**.\n---\n$$e^{i\\pi} + 1 = 0$$\n\nIt links $e$, $i$, $\\pi$, $1$ and $0$ in a single equation.\n===\nWhat is the **Pythagorean theorem**?\n---\nFor a right triangle with legs $a$, $b$ and hypotenuse $c$:\n$$a^2 + b^2 = c^2$$\n===\nGive the **mass-energy equivalence** relation.\n---\n$$E = mc^2$$\n"
  },
  {
    "title": "Multiple Choice Demo",
    "description": "Single- and multi-answer a/b/c questions",
    "source": "# Multiple Choice Demo\n\nWhat is the capital of France?\na) London\nb) Paris\nc) Berlin\nd) Madrid\n---\nb\nParis has been France's capital since 987 AD.\n===\nWhich of these are prime numbers?\na) 4\nb) 5\nc) 7\nd) 9\n---\nb, c\n4 = 2 x 2 and 9 = 3 x 3, so both are composite.\n===\nWhich planet is known as the Red Planet?\na) Venus\nb) Mars\nc) Jupiter\nd) Saturn\n---\nb\n===\nSelect the **even** numbers.\na) 3\nb) 6\nc) 8\nd) 11\n---\nb, c\nEven numbers are divisible by 2.\n===\nSolve for $x$: which value satisfies $2x = 10$?\na) 3\nb) 4\nc) 5\nd) 6\n---\nc\n"
  },
  {
    "title": "Cloze deletions",
    "description": "Fill-in-the-blank cards with {{...}} and ::hints",
    "source": "# Cloze deletions\n\n{{This}} word is hidden - flip the card to reveal it.\n---\nThat is a cloze deletion.\n===\nThe {{mitochondria}} is the powerhouse of the cell.\n===\nWater's chemical formula is {{H2O}}.\n===\nAdd a hint after :: - the SI unit of force is the {{newton::named after a physicist}}.\n===\nOne card can hide several words: in 1969 {{Neil Armstrong}} became the first person to walk on the {{Moon}}.\n===\nThe capital of Australia is {{Canberra::not Sydney}}.\n---\nSydney is the largest city, but Canberra is the capital.\n===\nHow do you write a cloze deletion in your own decks?\n---\nWrap the answer in double braces, and add an optional hint after `::`\n\n```\nThe {{powerhouse}} of the cell is the mitochondria.\nThe SI unit of force is the {{newton::named after a physicist}}.\n```\n\nIn *Type answer* mode you type the missing word. Otherwise reveal and self-grade.\n"
  },
  {
    "title": "Images & inline SVG",
    "description": "Embedded base64 images and inline SVG drawings",
    "source": "# Images & inline SVG\n\nInline SVG is drawn right on the card. What shape is this?\n\n<svg width='120' height='120' viewBox='0 0 120 120'><circle cx='60' cy='60' r='48' fill='#5b8cff'/></svg>\n---\nA **circle**.\n===\nSVG can draw quick diagrams. Which bar is tallest - A, B or C?\n\n<svg width='220' height='134' viewBox='0 0 220 134'><rect x='20' y='70' width='40' height='40' fill='#5b8cff'/><rect x='90' y='45' width='40' height='65' fill='#3fbf7f'/><rect x='160' y='20' width='40' height='90' fill='#ffcb47'/><text x='40' y='128' font-size='12' fill='#9aa4b2' text-anchor='middle'>A</text><text x='110' y='128' font-size='12' fill='#9aa4b2' text-anchor='middle'>B</text><text x='180' y='128' font-size='12' fill='#9aa4b2' text-anchor='middle'>C</text></svg>\n---\n**C** is the tallest.\n===\nThis picture is embedded as base64 right inside the .md, so it needs no external file and works offline. What two shapes does it show?\n\n![embedded shapes](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNDAiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgMTQwIDEwMCI+PHJlY3Qgd2lkdGg9IjE0MCIgaGVpZ2h0PSIxMDAiIHJ4PSIxMiIgZmlsbD0iIzFiMjMzMCIvPjxjaXJjbGUgY3g9IjQyIiBjeT0iNTAiIHI9IjI2IiBmaWxsPSIjZmZjYjQ3Ii8+PHBvbHlnb24gcG9pbnRzPSI5MiwyNCAxMjIsNzYgNjIsNzYiIGZpbGw9IiM1YjhjZmYiLz48L3N2Zz4=)\n---\nA **circle** and a **triangle**.\n===\nHow do I add a picture or drawing to a card?\n---\nLink it, embed it as base64, or paste raw inline SVG:\n\n```\n![alt](https://example.com/pic.png)\n![alt](data:image/png;base64,iVBORw0K...)\n<svg width='60' height='60'><circle cx='30' cy='30' r='24' fill='#5b8cff'/></svg>\n```\n\nLinks need a network. Base64 and SVG travel inside the file.\n"
  },
  {
    "title": "magpie.md - How it works",
    "description": "Learn the format and features using the app itself",
    "source": "# magpie.md - How it works\n\nHow are cards written in a deck file?\n---\nEach card is:\n\n```\nfront text\n---\nback text\n===\n```\n\n`---` splits front from back, `===` separates cards.\nThe back supports **bold**, *italic*, `code`, lists and more.\n===\nDoes this app ever show only a *subset* of my cards?\n---\n**No.** Every study session includes the **entire** deck.\n\nOrder can be *weighted* (wrong/unseen cards first), *shuffled*, or *original* -\nbut you always see all of them.\n===\nWhere is my progress stored?\n---\nIn your browser's **localStorage**, keyed per deck.\n\nIt survives reloads. Clearing site data wipes it - so export if you care.\n===\nHow do I move my progress between devices?\n---\nUse **Export .md + progress**.\n\nYour per-card stats are baked into hidden HTML comments like:\n\n```\n<!-- magpie seen=4 correct=3 wrong=1 last=right -->\n```\n\nRe-import that file anywhere to restore your stats - even onto a deck you already\nhave. Newer per-card records win, so it merges instead of clobbering.\n===\nCan I edit cards inside the app?\n---\nYes - open a deck and hit **Edit** to change its markdown in place (pasting an image embeds it as base64).\n\nYou can also edit the **.md** file in any text editor and re-import. Either way, decks stay plain markdown.\n"
  }
];

