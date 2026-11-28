---
title: Feynman diagrams
id: 1m8taa8bjcuyw
order: 1
tags:
  - perturbation-theory
  - virtual-particles
summary: Interactions are worked out as a series of ever smaller corrections, and each term of the series can be drawn as a picture.
---
The fields on [[id:1x8nbgaw6a846]] are free: their particles fly through one another as if the others weren't there. Real particles collide, scatter and decay, and for that the fields have to be coupled.

## Coupling fields together

In quantum electrodynamics, the theory of electrons and light, the coupling is one extra term in the theory's Lagrangian, the expression its equations of motion come from. It ties the electron field $\psi$ to the electromagnetic field $A_\mu$:

$$
\mathcal{L}_{\text{int}} = -e \, \bar\psi \gamma^\mu \psi \, A_\mu
$$

Read it as: at a single point, an electron can absorb or emit a photon, with a strength set by the electron's charge $e$. Nothing can be solved exactly with this term in place. But the strength is small: it is measured by the fine-structure constant,

$$
\alpha = \frac{e^2}{4\pi\varepsilon_0 \hbar c} \approx \frac{1}{137},
$$

so physicists work out each process as a series, $A = A_1 + A_2 + A_3 + \dots$, in which each term is hundreds of times smaller than the one before.

## A picture for each term

Richard Feynman found that each term of the series can be drawn, and that the drawing tells you exactly what to calculate. Here is the first term for two electrons scattering off each other:

![Two electrons come in from the left, exchange one photon, drawn as a wavy line between them, and leave to the right](_assets/electron-scattering.svg =520x)

Time runs from left to right. The electrons come in, one emits a photon at a point, the other absorbs it, and both fly off with changed momenta. Every part of the picture stands for one factor in the formula:

| In the picture | In the calculation |
| --- | --- |
| A line coming in or going out | The particle's wave, with its momentum and spin |
| A line between two points | A **propagator**: the field carrying a disturbance from one point to the other |
| A point where three lines meet | A **vertex**, one power of $e$, so one factor of $\sqrt{\alpha}$ |
| A closed loop of lines | An integral over every momentum that could run around it |

Diagrams with more vertices are the smaller terms. Add up every diagram with the same particles going in and out, and you have the answer.

## Virtual particles

The photon in the middle is called a *virtual* photon. It is not a particle anyone could catch: its energy and momentum don't satisfy $E = pc$ as a real photon's must. It is a picture of one term in a calculation, and the honest summary is that the electromagnetic field carries momentum from one electron to the other.

Two things come next: how astonishingly well these sums agree with experiment, on [[id:2mm217t2bow3t]], and the infinities that the loops produced at first, on [[id:0sdfzcgnhed5x]].
