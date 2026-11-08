---
title: The wavefunction
id: 2m0eeje0u87ok
order: 2
tags:
  - wavefunction
  - born-rule
  - superposition
labels:
  - Verified
summary: A quantum state is a complex-valued function, and its squared size gives the odds of each measurement result.
---
Everything that can be known about a particle is in its wavefunction $\psi(x, t)$: a complex number for each position $x$ and time $t$. The wavefunction itself can't be measured. What can be measured follows from it.

## The Born rule

The probability of finding the particle between $x$ and $x + dx$ is

$$
P(x)\,dx = |\psi(x, t)|^2\,dx
$$

The particle must be somewhere, so the probabilities add up to one:

$$
\int_{-\infty}^{\infty} |\psi(x, t)|^2\,dx = 1
$$

A wavefunction scaled so that this holds is called *normalized*.

## Superposition

If $\psi_1$ and $\psi_2$ are possible states of a system, so is any combination of them:

$$
\psi = c_1 \psi_1 + c_2 \psi_2
$$

<!-- kb25:note id=2l4lbmbg kind=task at=2026-11-08T10:15:00Z by=admin
> two distinct outcomes of the same measurement

Add a worked example: a particle in an equal superposition of the two lowest box states, and the odds it gives.
-->
When $\psi_1$ and $\psi_2$ are two distinct outcomes of the same measurement, a measurement finds $\psi_1$ with probability $|c_1|^2$ and $\psi_2$ with probability $|c_2|^2$, so $|c_1|^2 + |c_2|^2 = 1$. Before the measurement the system is not secretly in one of them: the two parts can interfere, which is what the bands in the double-slit experiment show.

## Expectation values

Repeat a measurement on many identically prepared systems and the results average to the expectation value. Each measurable quantity has an operator $\hat{A}$, and its expectation value is

$$
\langle A \rangle = \int_{-\infty}^{\infty} \psi^*\, \hat{A}\, \psi \, dx
$$

| Quantity | Operator |
| --- | --- |
| Position | $\hat{x} = x$ |
| Momentum | $\hat{p} = -i\hbar \, \partial / \partial x$ |
| Energy | $\hat{H} = \hat{p}^2 / 2m + V(x)$ |

How the wavefunction changes in time is the subject of [[id:0rmiavdb9vpd6]].
