---
title: The uncertainty principle
id: 2yq61leljl3l6
order: 1
tags:
  - heisenberg
  - commutators
summary: Why a particle can't have both a sharp position and a sharp momentum, and what that has to do with zero-point energy.
---
In 1927 Heisenberg showed that the more precisely a particle's position is fixed, the less precisely its momentum can be, and the other way round. In its exact form:

$$
\sigma_x \, \sigma_p \ge \frac{\hbar}{2}
$$

Here $\sigma_x$ and $\sigma_p$ are the spreads (standard deviations) of position and momentum over many measurements on identically prepared particles.

<!-- kb25:note id=28y1xyqb kind=highlight at=2026-11-08T10:25:00Z by=admin
> This is not a limit of our instruments.
-->
This is not a limit of our instruments. It follows from the wavefunction itself: a wave squeezed into a small region has to be built from many wavelengths, and by de Broglie's relation $p = h / \lambda$, many wavelengths means a wide spread of momenta. A wave with a single wavelength, and so a single momentum, fills all of space.

## Commutators

The same reasoning applies to any two measurable quantities $A$ and $B$ whose operators don't commute, meaning that applying them in one order gives a different result from the other. The commutator measures the difference, $[\hat{A}, \hat{B}] = \hat{A}\hat{B} - \hat{B}\hat{A}$, and bounds the product of the two spreads:

$$
\sigma_A \, \sigma_B \ge \frac{1}{2} \left| \langle [\hat{A}, \hat{B}] \rangle \right|
$$

For position and momentum, $[\hat{x}, \hat{p}] = i\hbar$, which gives back Heisenberg's $\hbar / 2$.

## Zero-point energy

The relation explains why a [[id:0rmiavdb9vpd6#a-particle-in-a-box|particle in a box]] can't have zero energy. Held in a box of width $L$, its position spread is at most about $L$, so its momentum spread is at least about $\hbar / L$, and that momentum carries a kinetic energy of about $\hbar^2 / m L^2$. The exact ground state, $E_1 = \pi^2 \hbar^2 / 2 m L^2$, has the same form.

## Energy and time

Energy and time obey a similar relation, $\Delta E \, \Delta t \gtrsim \hbar / 2$, but it means something different, because time is not a quantity measured on the system. Here $\Delta t$ is how long the system takes to change noticeably. A state that lasts only briefly has a spread-out energy, which is why light from short-lived excited atoms has a measurable spread of colours rather than one exact wavelength.
