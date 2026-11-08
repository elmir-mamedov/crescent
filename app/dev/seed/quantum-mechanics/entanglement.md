---
title: Entanglement
id: 1oye7a74fnmnb
order: 3
tags:
  - entanglement
  - bell-inequality
  - epr
labels:
  - Draft
summary: Two particles can share one quantum state, with correlations that no local theory can reproduce.
---
Two particles can be in a state that can't be split into one state for each. Such particles are *entangled*: neither has a definite spin of its own, yet measuring both always gives correlated results, however far apart they are.

## A Bell state

The simplest example is two spins in the singlet state:

$$
|\Psi^-\rangle = \frac{1}{\sqrt{2}} \left( |{\uparrow\downarrow}\rangle - |{\downarrow\uparrow}\rangle \right)
$$

Measure both along the same axis, any axis, and they always come out opposite. Each result on its own is a coin toss: half up, half down.

## EPR and hidden variables

In 1935 Einstein, Podolsky and Rosen argued that this makes quantum mechanics incomplete. If measuring one particle tells you the other's result at once and for certain, they reasoned, that result must have been settled all along, by some "hidden variable" the theory leaves out.

## Bell's theorem

In 1964 John Bell showed that experiments can settle the question. Measure particle A along one of two axes, $a$ or $a'$, and particle B along $b$ or $b'$. Score each result as $+1$ or $-1$, and write $E(a, b)$ for the average product of the two scores. Any theory in which the results are settled in advance and nothing travels faster than light obeys the CHSH inequality:

$$
S = \left| E(a, b) - E(a, b') + E(a', b) + E(a', b') \right| \le 2
$$

For the singlet, quantum mechanics predicts $E(a, b) = -\cos\theta_{ab}$, where $\theta_{ab}$ is the angle between the two axes. With the axes at 0° and 90° for A and 45° and 135° for B, it reaches $S = 2\sqrt{2} \approx 2.83$.

Experiments find the quantum value, which rules out local hidden variables: see [[id:1jsq9b2ynumqz]]. Entanglement still can't carry a message. Each side on its own sees random results, and the correlation only shows up when the two lists are compared, which needs an ordinary signal.
