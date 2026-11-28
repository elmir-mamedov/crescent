---
title: Fields before quantum mechanics
id: 04t4pd3bd5ihk
order: 2
tags:
  - waves
  - normal-modes
  - klein-gordon
summary: A field behaves like a chain of masses on springs, and its motion splits into independent waves, each an oscillator of its own.
---
Before any quantum mechanics, a field is just a quantity spread through space that can wave. The easiest way to see how it behaves is to build one out of something familiar.

## A chain of springs

Take a row of identical masses, each tied to its neighbours by identical springs, with the two ends held fixed. Pull one mass sideways and let go: the disturbance spreads, bounces off the ends, and the whole chain jiggles in what looks like a mess.

The mess has a hidden order. Every motion of the chain is a sum of a few special patterns, its **normal modes**. In a normal mode, every mass moves in step at one frequency, and each mode carries on by itself, as if the others weren't there. With $N$ masses there are $N$ modes, and mode $k$ swings at

$$
\omega_k = 2\,\omega_0 \sin\frac{k\pi}{2(N+1)}, \qquad \omega_0 = \sqrt{\frac{\kappa}{m}},
$$

where $\kappa$ is the springs' stiffness and $m$ each mass. Pick a mode below and watch it: the higher the mode, the more wiggles, and the faster it swings.

![A chain of 12 masses on springs, moving in one normal mode at a time](_assets/chain-of-springs.html =x380)

This is the idea the rest of the space rests on: **a field is a collection of independent oscillators, one for each normal mode.**

## From a chain to a field

Now make the masses smaller and closer together while keeping the chain's total mass and stiffness the same. In the limit, the row of masses becomes a continuous string, and the sideways displacement becomes a field $\phi(x, t)$, a number at every point $x$. Newton's law for each little piece of string becomes the wave equation:

$$
\frac{\partial^2 \phi}{\partial t^2} = v^2 \, \frac{\partial^2 \phi}{\partial x^2}
$$

Its normal modes are sine waves with wavenumber $k$ and frequency $\omega = v k$, and there is still one independent oscillator for each of them, only now infinitely many.

## A relativistic field

A field that obeys special relativity needs an equation that treats space and time alike. The simplest one is the Klein–Gordon equation:

$$
\frac{1}{c^2}\frac{\partial^2 \phi}{\partial t^2} - \nabla^2 \phi + \left(\frac{m c}{\hbar}\right)^2 \phi = 0
$$

It is the wave equation with one extra term. Put in a wave $\phi = \cos(\mathbf{k}\cdot\mathbf{x} - \omega t)$ and it works only when

$$
\omega^2 = c^2 |\mathbf{k}|^2 + \left(\frac{m c^2}{\hbar}\right)^2 .
$$

Multiply both sides by $\hbar^2$ and call $E = \hbar\omega$ and $p = \hbar |\mathbf{k}|$. The result is $E^2 = (pc)^2 + (mc^2)^2$, the relation between energy, momentum and mass for a particle in special relativity. The waves of this field already know about particles of mass $m$; [[id:1x8nbgaw6a846]] shows how they become them.

First, though, each normal mode is an oscillator, and quantum oscillators behave in one very particular way: [[id:059wa539q8rd7]].
