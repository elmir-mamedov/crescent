---
title: The Schrödinger equation
id: 0rmiavdb9vpd6
order: 3
tags:
  - schrodinger-equation
  - energy-levels
labels:
  - Needs review
summary: The equation that moves a wavefunction forward in time, and why it only allows certain energies.
---
The Schrödinger equation does for the wavefunction what Newton's second law does for a ball: given the state now, it gives the state at every later time. For one particle of mass $m$ moving in a potential $V(x)$:

$$
i\hbar \frac{\partial \psi}{\partial t} = \hat{H}\psi = -\frac{\hbar^2}{2m}\frac{\partial^2 \psi}{\partial x^2} + V(x)\,\psi
$$

## Stationary states

When the potential doesn't change with time, there are solutions of the form $\psi(x, t) = \phi(x)\,e^{-iEt/\hbar}$. Their probability density $|\psi|^2$ doesn't change at all, which is why they're called stationary. Substituting this form gives the time-independent equation

$$
-\frac{\hbar^2}{2m}\frac{d^2 \phi}{dx^2} + V(x)\,\phi = E\,\phi
$$

which has acceptable solutions only for particular energies $E$. This is where quantization comes from: not from an extra rule, but from asking that $\phi$ stay finite and fit the boundary conditions.

## A particle in a box

The simplest case is a particle held between $x = 0$ and $x = L$ by walls it can't pass: $V = 0$ inside and $V = \infty$ outside. The wavefunction must vanish at both walls, which leaves room only for whole numbers of half-wavelengths:

$$
\phi_n(x) = \sqrt{\frac{2}{L}} \sin\frac{n\pi x}{L}, \qquad E_n = \frac{n^2 \pi^2 \hbar^2}{2 m L^2}, \qquad n = 1, 2, 3, \dots
$$

<!-- kb25:note id=1xqqz0x4 kind=remark at=2026-11-08T10:20:00Z by=admin
> is not zero

This is the zero-point energy the uncertainty principle page derives; keep the two explanations consistent.
-->
The lowest energy, $E_1$, is not zero: a particle that is confined can never be completely at rest. [[id:2yq61leljl3l6#zero-point-energy|The uncertainty principle]] says why.

For an electron in a box 1 nm wide, the first four levels are:

```python
from scipy.constants import hbar, m_e, eV, pi

L = 1e-9  # box width in metres
for n in range(1, 5):
    E = n**2 * pi**2 * hbar**2 / (2 * m_e * L**2)
    print(f"E_{n} = {E / eV:.3f} eV")
```

```text
E_1 = 0.376 eV
E_2 = 1.504 eV
E_3 = 3.384 eV
E_4 = 6.016 eV
```

The levels grow as $n^2$ and shrink as the box widens. In a box the size of a room they are so close together that the energy looks continuous, which is why everyday objects show no sign of quantization.
