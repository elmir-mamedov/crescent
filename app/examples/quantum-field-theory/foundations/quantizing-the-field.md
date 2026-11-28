---
title: Particles as quanta of a field
id: 1x8nbgaw6a846
order: 4
tags:
  - quantization
  - fock-space
  - vacuum
labels:
  - Key idea
summary: Quantize each of a field's oscillators and every step up its ladder carries exactly the energy and momentum of one particle.
---
The last two pages gave two facts. A field is a collection of independent oscillators, one for each normal mode ([[id:04t4pd3bd5ihk#a-chain-of-springs]]). And a quantum oscillator's energy comes in equal steps of $\hbar\omega$ ([[id:059wa539q8rd7#energy-in-equal-steps]]). Put them together, and particles fall out.

## One ladder for every wave

Each normal mode of the field is a wave with momentum $\mathbf{p} = \hbar\mathbf{k}$ and frequency $\omega_{\mathbf{p}}$. Quantize it as an oscillator, and it gets a ladder of its own, with its own raising and lowering operators, $a^\dagger_{\mathbf{p}}$ and $a_{\mathbf{p}}$.

Raising mode $\mathbf{p}$ by one rung adds energy $\hbar\omega_{\mathbf{p}}$ and momentum $\mathbf{p}$. For the relativistic field on [[id:04t4pd3bd5ihk#a-relativistic-field]], that energy is

$$
\hbar\omega_{\mathbf{p}} = \sqrt{(pc)^2 + (mc^2)^2},
$$

exactly the energy of a particle of mass $m$ moving with momentum $\mathbf{p}$. So one rung up is not *like* a particle; it **is** one. A particle is a single quantum of excitation of its field. That is why $a^\dagger_{\mathbf{p}}$ is called the **creation operator** and $a_{\mathbf{p}}$ the **annihilation operator**.

## Counting particles

A state of the whole field just says how many rungs each mode is up, which is how many particles have each momentum:

$$
|n_{\mathbf{p}_1}, n_{\mathbf{p}_2}, \dots\rangle
$$

<!-- kb25:note id=v2hq8n5t kind=task at=2026-11-26T10:05:00Z by=crescent
> Fock space

Add a worked example: build the state with one particle of momentum p and one of momentum q from the vacuum, using two creation operators.
-->
The space of all such states is called **Fock space**, and the problem from [[id:04tc4l0zm9l4l]] is gone: states with different numbers of particles live side by side in it, and a creation operator moves between them. The field operator itself, in the units physicists use here ($\hbar = c = 1$), is a sum of both over every momentum:

$$
\phi(x) = \int \frac{d^3p}{(2\pi)^3} \, \frac{1}{\sqrt{2E_{\mathbf{p}}}} \left( a_{\mathbf{p}} \, e^{-i p\cdot x} + a^\dagger_{\mathbf{p}} \, e^{i p\cdot x} \right)
$$

Acting at a point $x$, it can destroy a particle there or create one.

Because every particle is a rung on the same ladders, two particles of the same kind cannot differ at all. Swapping them changes nothing, so they are perfectly identical, as every electron in the universe is.

## The vacuum isn't empty

The state with every mode on its bottom rung is the **vacuum**, $|0\rangle$: no particles at all. But each mode still keeps its zero-point energy $\frac{1}{2}\hbar\omega_{\mathbf{p}}$, and there are infinitely many modes, so the sum is infinite.

Only differences in energy can be measured, so the infinite constant is set aside. Its differences are real, though. Between two uncharged metal plates fewer modes fit than outside, and the plates are pushed together. This Casimir force was measured by Steve Lamoreaux in 1997.

## Bosons and fermions

The field here has particles called bosons, any number of which can share a mode. Electrons are fermions, and their field uses operators with $a_{\mathbf{p}} a^\dagger_{\mathbf{p}} + a^\dagger_{\mathbf{p}} a_{\mathbf{p}} = 1$ instead. Then no mode can hold more than one particle, which is the Pauli exclusion principle, and the reason atoms have their shell structure.

So far the particles pass straight through one another. Making them interact is the subject of [[id:1m8taa8bjcuyw]].

## Sources

- S. K. Lamoreaux, [Demonstration of the Casimir force in the 0.6 to 6 μm range](https://doi.org/10.1103/PhysRevLett.78.5), Physical Review Letters 78, 5 (1997).
