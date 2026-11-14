# Game dev cheatsheet

A DSH bundle that installs the **gamedev-cheatsheet** Agent Skill: a lookup table
from "this feels wrong" to the specific concept, parameter and code pattern that
fixes it.

AI-written games rarely fail because the code does not run. They fail because
nobody asked for the thing that makes a game feel right: coyote time, input
buffering, hit stop, a fixed timestep, object pooling. Each of those is a known
named problem with known numbers, and an agent that does not know the name will
not implement it.

This skill gives the agent the names, the numbers and the recipes.

## What you get

34 concepts across four layers, each with a definition, when to use it, when
**not** to use it, a paste-ready English prompt, engine-neutral pseudocode, the
common mistakes, and its tuning values:

| Layer | Concepts |
|---|---|
| 3D & rendering | raycasting, normals, level of detail, frustum culling, fragment shader, billboarding, quaternions, z-fighting |
| Game feel | delta time, coyote time, easing, screen shake, squash and stretch, camera deadzone, input buffering, acceleration and friction, hit stop, invincibility frames |
| Systems | object pooling, finite state machine, hitbox/hurtbox, A\* pathfinding, particle system, fixed timestep, steering behaviors, tunneling, seeded noise |
| Performance | frame budget, draw calls, spatial partitioning, overdraw, time slicing, texture atlas, chunk streaming |

Plus:

- a task/symptom → concept routing table, so "the jump feels stiff" resolves to
  coyote time plus input buffering instead of a guess;
- a default-values table (coyote 0.10–0.15 s, input buffer ~0.10 s, hit stop
  50–100 ms, dt clamp 0.05 s, physics accumulator cap 0.25 s, …);
- the twelve mistakes AI-written games make most often, as a review checklist;
- a pre-ship checklist covering frame-rate independence, lifecycle, boundaries
  and tunability;
- engine mapping for Unity, Godot 4, three.js and Phaser 3.

## Install

```sh
dsh plugin --profile <profile> add dsh-gamedev-cheatsheet
```

Or, while unpublished, from a local checkout:

```sh
dsh plugin --profile <profile> add /absolute/path/to/dsh-gamedev-cheatsheet
```

Restart the host, then start a new session. The skill is delivered to
`<DSH_AGENTS_HOME or ~/.agents>/skills/gamedev-cheatsheet` during activation, and
DSH lists it in the session skill catalog from the next session onward.

## Use it

It triggers on its own once the agent sees a game task — "make a platformer",
"the jump feels stiff", "it stutters after 10 minutes", "enemies walk through
walls". You can also call it directly: `/gamedev-cheatsheet`, or "use the
gamedev-cheatsheet skill to review this game code".

## Delivery and updates

The skill is copied out of the package into the skills folder, stamped with the
package version in `.installed-version`. Activating the same version again does
nothing. Installing a newer version replaces the folder, so **local edits inside
the installed copy are overwritten on upgrade** — edit the package's `skill/`
folder if you want to keep changes.

Set the row config to `{ "installSkill": false }` if you want the package
registered without touching the skills folder.

## Limitations

- The skill is delivered at activation time. A session that is already running
  does not pick it up; start a new session.
- It is a reference, not a code generator. It tells the agent which parameters
  and patterns to use; the agent still writes the code for your engine.
- Covers runtime behaviour only: not art production, audio assets, builds or
  store submission.

## Attribution

Concept list, prompt bits and pseudocode structure are adapted from
[gamedev-cheatsheet.com](https://gamedev-cheatsheet.com) by Nicolas Zullo —
a visual reference for people building games with AI. The Chinese explanations,
routing tables, parameter tables, checklists and engine mapping were written for
this package. See `NOTICE.md` before redistributing.
