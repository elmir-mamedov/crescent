---
title: The quantum harmonic oscillator
id: 059wa539q8rd7
order: 3
tags:
  - oscillator
  - ladder-operators
  - zero-point-energy
labels:
  - Key idea
summary: A quantum oscillator's energy comes in equal steps of ħω, and two operators climb up and down them.
---
A mass on a spring is a harmonic oscillator: pull it from the middle and the spring pulls back in proportion. In classical physics it can swing with any energy at all. In quantum mechanics it can't.

## Energy in equal steps

The oscillator's energy is the energy of its motion plus the energy stored in the spring:

$$
H = \frac{p^2}{2m} + \frac{1}{2} m \omega^2 x^2
$$

Solving the Schrödinger equation for it gives a ladder of allowed energies,

$$
E_n = \hbar\omega\left(n + \frac{1}{2}\right), \qquad n = 0, 1, 2, \dots
$$

![The potential energy of a harmonic oscillator, a parabola, with its first five energy levels evenly spaced inside it](_assets/oscillator-levels.svg =480x)

<!-- kb25:note id=q7f3k9m2 kind=remark at=2026-11-26T10:00:00Z by=crescent
> evenly spaced

This even spacing is the fact the whole of quantum field theory leans on: on the next page, each step becomes one more particle.
-->
Two things stand out. The steps are **evenly spaced**: going up one rung always costs exactly $\hbar\omega$, whatever rung you start on. And the lowest rung is not zero: even at rest, the oscillator keeps a **zero-point energy** of $\frac{1}{2}\hbar\omega$, because a mass sitting perfectly still at the bottom would have both a sharp position and a sharp momentum, which the uncertainty principle forbids.

## Climbing the ladder

There is a neat way to move between rungs without solving any equations. Define two operators, $a$ and its partner $a^\dagger$, out of position and momentum:

$$
a = \sqrt{\frac{m\omega}{2\hbar}}\left(x + \frac{i p}{m\omega}\right), \qquad a^\dagger = \sqrt{\frac{m\omega}{2\hbar}}\left(x - \frac{i p}{m\omega}\right)
$$

From $x p - p x = i\hbar$ it follows that $a a^\dagger - a^\dagger a = 1$, and the energy becomes

$$
H = \hbar\omega\left(a^\dagger a + \frac{1}{2}\right).
$$

$a^\dagger$ is the **raising operator**: it takes the state $|n\rangle$ one rung up, to $|n+1\rangle$, adding $\hbar\omega$. $a$, the **lowering operator**, takes it one rung down, and on the bottom rung it gives zero. The operator $a^\dagger a$ simply counts which rung you are on:

$$
a^\dagger a \, |n\rangle = n \, |n\rangle
$$

Keep these two operators in mind. On [[id:1x8nbgaw6a846]] they get new names: $a^\dagger$ becomes "create a particle", and $a$ becomes "destroy one".
