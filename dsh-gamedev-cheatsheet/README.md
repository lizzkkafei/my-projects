# dsh-gamedev-cheatsheet

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
installs the **gamedev-cheatsheet** Agent Skill — 34 game-development concepts an
AI agent needs in order to write a game that feels right.

```sh
dsh plugin --profile <profile> add dsh-gamedev-cheatsheet
```

Then restart the host and start a new session. The skill appears in the session
skill catalog as `gamedev-cheatsheet`.

## Why

AI-written games rarely fail because the code does not run. They fail because
nobody asked for coyote time, input buffering, hit stop, a fixed timestep, or
object pooling — each a known named problem with known numbers. An agent that
does not know the name will not implement it.

This skill gives it the names, the numbers, the pseudocode and the pitfalls.

## What is inside

| Layer | Concepts |
|---|---|
| 3D & rendering | raycasting, normals, level of detail, frustum culling, fragment shader, billboarding, quaternions, z-fighting |
| Game feel | delta time, coyote time, easing, screen shake, squash and stretch, camera deadzone, input buffering, acceleration and friction, hit stop, invincibility frames |
| Systems | object pooling, finite state machine, hitbox/hurtbox, A\* pathfinding, particle system, fixed timestep, steering behaviors, tunneling, seeded noise |
| Performance | frame budget, draw calls, spatial partitioning, overdraw, time slicing, texture atlas, chunk streaming |

Each concept carries: definition → when to use → when **not** to use →
paste-ready prompt → engine-neutral pseudocode → common mistakes → tuning values.

Plus a symptom → concept routing table, a default-values table, the twelve
mistakes AI-written games make most often, a pre-ship checklist, and engine
mapping for Unity, Godot 4, three.js and Phaser 3.

## Package layout

```
dsh-gamedev-cheatsheet/
├── package.json          dsh.bundle.patch → cordis.patch.yml
├── cordis.patch.yml      inserts the gamedev-cheatsheet row
├── index.js              apply(): delivers skill/ into <agents home>/skills/
├── skill/                the Agent Skill (SKILL.md + references/, 11 files)
├── locale/{en,zh}.json   Plugin Manager title, description, detail path
├── docs/DETAIL.md        the plugin's detail page
├── icon.svg              original artwork
└── NOTICE.md             attribution and licensing
```

Activation copies `skill/` to
`<DSH_AGENTS_HOME or ~/.agents>/skills/gamedev-cheatsheet`, stamped with the
package version. Same version → no-op; new version → replaces the folder.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `installSkill` | `true` | Set `false` to register the package without writing into the skills folder. |

## Requirements

- DSH `>= 0.2.0`
- Node's `fs.cpSync` (Node 16.7+); no build step and no dependencies

## Attribution

Concept list, prompt bits and pseudocode structure are adapted from
[gamedev-cheatsheet.com](https://gamedev-cheatsheet.com) by Nicolas Zullo. The
Chinese explanations, routing tables, parameter tables, checklists and engine
mapping were written for this package. Read [NOTICE.md](NOTICE.md) before
redistributing the bundled skill content.

## License

Plugin code: MIT. Bundled skill content: see [NOTICE.md](NOTICE.md).
