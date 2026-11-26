---
title: Writing pages
id: 06pd8prq12aoq
order: 2
summary: Edit a page's Markdown, link pages together, and add images, formulas and diagrams.
---
Open a page and press **Edit** (or ⌘/Ctrl + E) to change it. You write in Markdown, and **Save** (⌘/Ctrl + S) shows the page as it reads.

## Markdown in a minute

| You write | You get |
| --- | --- |
| `# Heading` | a heading |
| `**bold**` and `*italic*` | **bold** and *italic* |
| `- item` | a bulleted list |
| `1. item` | a numbered list |
| `` `code` `` | `code` |

## Links between pages

Write `[[space/page]]` to link to another page, as this one links back to the [[id:2yutx4ynk2rby|start of the guide]]. Links keep working when a page is moved or renamed. To link to one section, add its heading's anchor: hover a heading and click the **#** that appears to copy one.

## Images

The **Gallery** button, beside the chat, shows every image in the space and uploads new ones. To show an image on a page, write `![](_assets/name.png)`, with the image's name.

## Formulas

Put a formula between dollar signs, `$E = mc^2$`, to get $E = mc^2$ in a sentence. Put it between double dollar signs, on lines of their own, to give it a line of its own:

$$
\frac{n}{V} = \frac{p}{RT}
$$

Chemical equations work too: `$\ce{2H2 + O2 -> 2H2O}$` gives $\ce{2H2 + O2 -> 2H2O}$.

## Diagrams

A code block marked `mermaid` becomes a diagram. This one:

````text
```mermaid
flowchart LR
  Question --> Page --> Answer
```
````

draws this:

```mermaid
flowchart LR
  Question --> Page --> Answer
```
