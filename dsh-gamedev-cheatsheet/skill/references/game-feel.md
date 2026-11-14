# Game feel · 手感

> 让跳跃、打击、相机符合玩家直觉的时间与运动规则。

> 10 个概念 ｜ 返回 [总索引](./index.md) ｜ 下一章 [Systems · 系统](./systems.md)

## 本章目录

09. [Delta time · 帧时间](#delta-time) — 按秒移动而不是按帧
10. [Coyote time · 土狼时间](#coyote-time) — 跳晚一点也算数
11. [Easing · 缓动](#easing) — 把直线运动拗成曲线
12. [Screen shake · 屏幕震动](#screen-shake) — 一个 trauma 值驱动震屏
13. [Squash and stretch · 挤压拉伸](#squash-and-stretch) — 用形状表现速度和冲击
14. [Camera deadzone · 相机死区](#camera-deadzone) — 先让玩家走相机再跟
15. [Input buffering · 输入缓冲](#input-buffering) — 按早一点也算数
16. [Acceleration and friction · 加速与摩擦](#acceleration-and-friction) — 速度要起得来也要收得住
17. [Hit stop · 命中停顿](#hit-stop) — 命中瞬间双方都定格
18. [Invincibility frames · 无敌帧](#invincibility-frames) — 挨打之后短暂安全

---

<a id="delta-time"></a>

## 09 · Delta time · 帧时间

> *按秒移动而不是按帧* ｜ `move per second, not per frame`

delta time 是上一帧花了多少秒。把每个速度都乘上它，游戏在 30 fps 和 240 fps 下就是同样的节奏。演示里帧率从 60 掉到 14 fps，那个每帧固定移动距离的赛车就落后了。

**展开说**：dt 是上一帧花了多少秒。把速度乘 dt，30fps 和 240fps 的移动距离才一致。进阶版：平滑不要写 `lerp(a,b,0.1)`（帧率越高越快），用 `1 - exp(-k*dt)`；单帧 dt 钳到 0.05s，防止切标签页回来瞬移。

**什么时候用**：移动速度、冷却和 UI 动画都应使用以秒计的流逝时间。单位为 units per second 的值，只需乘一次流逝秒数就能变成位移。

**什么时候别用**：物理积分不要直接用可变 dt——那是固定步长的活；UI 动画反而适合用真实时间。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-09)）

```text
Make all movement frame-rate independent with delta time: multiply every speed by dt in seconds, add dt to every timer, smooth with 1 - exp(-k * dt) instead of a fixed lerp factor, and clamp dt to about 0.05 s so one long frame cannot teleport anything.
```

**伪代码**（引擎无关，按需换成 API）

```text
dt = min(frameSeconds, 0.05)
position += velocity * dt
cooldown = max(0, cooldown - dt)
blend = 1 - exp(-smoothing * dt)
```

**常见错误**：不要重复乘两次 delta time。clamp 长帧会丢掉已经流逝的时间，所以需要完整计入这段时间的模拟更适合 fixed-step accumulation。

**关键参数**：单帧 dt 钳制 0.05 s（后台切回可放宽到 0.1 s）；平滑 k ≈ 10–20；物理累加器上限 0.25 s。

**相关概念**：[Fixed timestep](./systems.md#fixed-timestep) · [Acceleration and friction](#acceleration-and-friction) · [Easing](#easing)

**延伸阅读**：[Gaffer On Games: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)

---

<a id="coyote-time"></a>

## 10 · Coyote time · 土狼时间

> *跳晚一点也算数* ｜ `a late jump that still counts`

coyote time 让玩家跑出平台边缘后，还有一小段窗口（通常 0.1 到 0.15 s）可以起跳。玩家经常晚按几帧跳跃，没有这个窗口游戏就会忽略这次按键，人直接掉下去。演示里两个跑者都在同样晚的时刻按跳，只有带 coyote time 的那个越过了缺口。

**展开说**：玩家经常在「刚离开平台」的几帧后才按跳跃，严格判定会直接忽略。土狼时间给 0.1–0.15s 的宽限，且用掉就清零，否则等于送一次二段跳。

**什么时候用**：平台跳跃游戏里，玩家刚离开边缘时仍应接受跳跃，这种短暂宽限就用 coyote time。它要和 jump buffering 分开，后者记住的是提前按下的按键。

**什么时候别用**：需要精确平台判定的硬核游戏可以调小到 0.05s，但不能为 0 —— 那是手感 bug 不是难度。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-10)）

```text
Add coyote time to the jump: track the time since the player last stood on the ground, allow a jump while it is under 0.12 s, and use up that window when the jump fires so the window cannot give a second jump.
```

**伪代码**（引擎无关，按需换成 API）

```text
if grounded: grace = 0.12
else: grace = max(0, grace - dt)
if jumpPressed and grace > 0:
  velocity.y = jumpSpeed
  grace = 0
```

**常见错误**：跳跃真正触发时要消耗掉这段 grace period。还要避免起跳那一帧用残留的 grounded 状态立刻把它补满，否则一次按键序列可能多跳一次。

**关键参数**：0.10–0.15s；触发后清空；与输入缓冲独立计时。

**相关概念**：[Input buffering](#input-buffering) · [Acceleration and friction](#acceleration-and-friction) · [Fixed timestep](./systems.md#fixed-timestep)

**延伸阅读**：[Godot: Character body movement and collision](https://docs.godotengine.org/en/stable/tutorials/physics/using_character_body_2d.html)

---

<a id="easing"></a>

## 11 · Easing · 缓动

> *把直线运动拗成曲线* ｜ `bend linear motion into curves`

easing 函数把 0 到 1 的线性进度映射到一条曲线上，运动可以减速滑入终点，也可以稍微过冲再回稳，而不是一直匀速。左边的图画出每条曲线，右边每个方块在同样的 1.5 秒里沿着自己的曲线运动。任何起点、终点和时长都已知的移动都适合用它，比如菜单滑入或相机平移。

**展开说**：缓动把线性的 0→1 进度弯成曲线：easeOutCubic 减速收尾，easeOutBack 冲过头再回弹。它适用于「有明确起点、终点、时长」的运动，而不是持续跟随。

**什么时候用**：当运动的起点、目标和时长都已知时用 easing。如果目标一直在移动，或物体需要物理化反应，就改用 velocity-based controller。

**什么时候别用**：物理驱动、玩家输入驱动的运动不要用缓动——会和碰撞/输入打架。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-11)）

```text
Replace linear tweens with easing: compute t = elapsed / duration clamped between 0 and 1, set position = lerp(start, end, easeOutCubic(t)), use about 0.3 s for UI moves, and switch to easeOutBack when the motion should overshoot slightly before settling.
```

**伪代码**（引擎无关，按需换成 API）

```text
t = clamp(elapsed / duration, 0, 1)
eased = 1 - pow(1 - t, 3)
position = start + (target - start) * eased
```

**常见错误**：使用流逝进度时，不要反复把起点替换成当前位置，那会改变曲线。有些 easing 函数故意 overshoot，有范围限制的值要避免用它们。

**关键参数**：UI 位移 ~0.3s easeOutCubic；菜单弹出 0.2–0.25s；相机平移 0.4–0.6s。

**相关概念**：[Delta time](#delta-time) · [Quaternions](./3d-rendering.md#quaternions) · [Squash and stretch](#squash-and-stretch)

---

<a id="screen-shake"></a>

## 12 · Screen shake · 屏幕震动

> *一个 trauma 值驱动震屏* ｜ `one trauma value drives the shake`

screen shake 在受击后移动相机，由一个 0 到 1 的 trauma 值驱动：每次命中提高它，再在大约一秒内衰减回 0。右边视图的抖动幅度等于 trauma 的平方乘以平滑噪声，所以两次轻击只挪几个像素，重击则挪得很远。左边用原始 trauma 并且每帧换一个随机偏移，于是每次受击都在乱抖。

**展开说**：用一个 0→1 的 trauma 值驱动震动：命中加 0.3–0.6，每秒衰减 1，相机偏移 = 最大幅度 × trauma² × 平滑噪声。平方让轻击几乎不动、重击很猛；噪声让抖动是「冲击」而不是「癫痫」。

**什么时候用**：用短促、会衰减的 shake 传达冲击。让它只作用于视觉相机偏移，这样 shake 不会改变游戏内瞄准、碰撞检测，也不会污染相机持久跟随的位置。

**什么时候别用**：持续震动（落地、跑步）应该用独立的低频 bob，不该反复加 trauma。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-12)）

```text
Drive screen shake from a trauma value between 0 and 1: each hit adds 0.3 to 0.6, trauma decays by about 1 per second, and each frame the camera x, y and roll offsets equal a max offset times trauma squared times smooth Perlin noise, not fresh random numbers.
```

**伪代码**（引擎无关，按需换成 API）

```text
trauma = clamp(trauma + impact, 0, 1)
trauma = max(0, trauma - decay * dt)
amplitude = trauma * trauma
cameraOffset.x = noise(time * frequency) * maxOffset * amplitude
```

**常见错误**：不要把随机偏移累积进相机基础位置。shake 要叠加在稳定的 pose 上，并提供 reduced-motion 或 shake 强度设置。

**关键参数**：trauma 每击 +0.3~0.6；衰减 1/s；offset ∝ trauma²；用 Perlin/simplex 而非 random。

**相关概念**：[Hit stop](#hit-stop) · [Camera deadzone](#camera-deadzone) · [Seeded noise](./systems.md#seeded-noise)

---

<a id="squash-and-stretch"></a>

## 13 · Squash and stretch · 挤压拉伸

> *用形状表现速度和冲击* ｜ `shape shows speed and impact`

squash and stretch 沿运动方向缩放物体：移动快时拉长，落地时压扁一瞬，另一轴取反向缩放，让体积看起来基本不变。演示里两个球走同一条弹跳轨迹，只有右边的球把速度和冲击表现在了形状上。

**展开说**：沿速度方向拉长、落地瞬间压扁，另一轴取倒数保持视觉体积不变。锚点必须在脚底，否则压缩会陷进地面。它是「用形状讲速度」的最便宜办法。

**什么时候用**：用视觉 transform 强调速度感或落地冲击。2D 中给另一轴施加反向缩放可以保持面积；3D 中要保持体积，则需要在两个轴上做补偿。

**什么时候别用**：写实风格、机械/硬质角色用多了会变橡皮；靠粒子或拖影替代。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-13)）

```text
Add squash and stretch to the sprite: scale it up to about 1.3 along its velocity when it moves fast, squash it to about 0.7 on landing and ease back to 1 within 0.15 s, give the other axis the inverse scale so its area stays constant, and pivot at the feet so it stays on the ground.
```

**伪代码**（引擎无关，按需换成 API）

```text
stretch = 1.3
visual.scaleY = stretch
visual.scaleX = 1 / stretch
// Ease both values back to 1 after the impact.
```

**常见错误**：除非确实要改碰撞，否则碰撞形状应保持独立。视觉 pivot 放在接触点上，squash 才不会看起来把角色滑进地板。

**关键参数**：拉伸 1.3×、压扁 0.7×，0.15s 回弹；2D 用另一轴取倒数保面积，3D 用 1/√s 保体积；锚点 pivot 在底部；不要改物理碰撞体。

**相关概念**：[Easing](#easing) · [Hit stop](#hit-stop) · [Acceleration and friction](#acceleration-and-friction)

---

<a id="camera-deadzone"></a>

## 14 · Camera deadzone · 相机死区

> *先让玩家走相机再跟* ｜ `let the player move first`

camera deadzone 是屏幕中央的一块区域，玩家在里面移动时相机保持不动。玩家越过边界后，相机只移动到刚好把他留在边界上，所以小幅移动和转身都不会让画面跟着晃。演示里玩家每次转身回到框内，相机都稳稳停住。

**展开说**：屏幕中央留一块死区，玩家在里面走相机不动；碰到边缘才把相机推着走。它消灭了「微调走位时画面一直抖」，代价是玩家视野里自己的位置会漂。

**什么时候用**：当玩家的小幅移动不该让视角跟着动时，用 deadzone。它要配合世界边界使用，也可以加上沿移动方向的少量 look-ahead 偏移。

**什么时候别用**：射击/瞄准类游戏通常要更紧的跟随甚至无死区，因为准星需要位置稳定。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-14)）

```text
Give the follow camera a deadzone: keep the camera still while the player is inside a centered box about a quarter of the screen wide, and when they cross an edge, move the camera by exactly how far they went past it.
```

**伪代码**（引擎无关，按需换成 API）

```text
offset = player.position - camera.position
excess.x = offset.x - clamp(offset.x, -halfWidth, halfWidth)
excess.y = offset.y - clamp(offset.y, -halfHeight, halfHeight)
camera.position += excess
```

**常见错误**：最终相机 target 要 clamp 到关卡边界内。如果加了平滑，要区分 target deadzone 和滞后的相机位置，避免在边缘附近来回振荡。

**关键参数**：死区 ≈ 屏幕宽 1/4；越界时相机移动量 = 越界量；配合缓动。

**相关概念**：[Screen shake](#screen-shake) · [Easing](#easing) · [Delta time](#delta-time)

---

<a id="input-buffering"></a>

## 15 · Input buffering · 输入缓冲

> *按早一点也算数* ｜ `an early press that still counts`

input buffering 会把按键记住一小段时间，通常约 0.1 s，并在动作第一次可行的那个帧执行。玩家常在落地前几帧就按跳，没有 buffer 的话游戏会因为角色还在空中而丢掉这次输入。演示里两个角色都在落地前 0.08 s 按下跳跃，只有带 0.1 s buffer 的那个在触地帧跳了起来。

**展开说**：玩家常在落地前就按了跳，严格判定会吞掉这次输入。输入缓冲把按键记 0.1s，等第一个「可执行帧」再消费，一次按键只触发一次。

**什么时候用**：当动作应该在按下后的第一个可用帧触发时，用短 input buffer。落地前一瞬按跳、在 recovery 阶段预输入攻击，都是常见用法。

**什么时候别用**：菜单、暂停等 UI 输入不要缓冲——那会变成「按了没反应又突然触发」。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-15)）

```text
Add a jump input buffer: when the player presses jump, set a buffer timer to 0.1 s that counts down every frame, fire the jump on the first frame the player is grounded while that timer is above 0, and reset the timer to 0 when the jump fires so one press gives one jump.
```

**伪代码**（引擎无关，按需换成 API）

```text
if jumpPressed: buffer = 0.1
else: buffer = max(0, buffer - dt)
if canJump and buffer > 0:
  jump()
  buffer = 0
```

**常见错误**：输入只能消耗一次。buffer 和持续读取按住的按键不是一回事；窗口过长会让角色做出玩家早已不期待的动作。

**关键参数**：0.08–0.12s；触发清零；只对动作类输入生效。

**相关概念**：[Coyote time](#coyote-time) · [Finite state machine](./systems.md#state-machine) · [Hit stop](#hit-stop)

---

<a id="acceleration-and-friction"></a>

## 16 · Acceleration and friction · 加速与摩擦

> *速度要起得来也要收得住* ｜ `speed builds up and bleeds off`

acceleration 和 friction 每帧把 velocity 朝输入速度推进固定量，而不是一帧直接设成目标速度。下面那个角色 0.2 s 达到最大速度，松手后 0.1 s 停下，输入反向时刹车力度翻倍。上面那个角色直接照抄输入，速度曲线是方波，起步、停下和转身都只花一帧。

**展开说**：速度不是瞬间等于输入，而是以固定加速度逼近目标速度；松手后靠摩擦减速；反向输入时用 2 倍减速度「刹车」。这样角色才有重量感，而不是一个方块在滑动。

**什么时候用**：用 acceleration 让移动逐渐起速，用 deceleration 控制玩家多快停下。地面、空中和反向输入使用不同速率，可以做出截然不同的手感。

**什么时候别用**：冰面/太空/低重力场景要反过来调（低摩擦、低加速），别把默认值当普适。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-16)）

```text
Give horizontal movement acceleration and friction: each frame move the velocity toward input times max speed with an acceleration that reaches max speed in 0.1 to 0.2 s, decelerate to a stop in about 0.1 s when no direction is held, use twice that deceleration when the input points against the current velocity, and halve both rates while airborne.
```

**伪代码**（引擎无关，按需换成 API）

```text
target = inputAxis * maxSpeed
rate = acceleration if inputAxis != 0 else deceleration
if target * velocity.x < 0: rate = reversalRate
velocity.x = moveTowards(velocity.x, target, rate * dt)
```

**常见错误**：控制器里的 deceleration 设置不一定等于物理 friction。单位要统一，并在多种帧率下测试反向、空中转向和斜坡。

**关键参数**：0.1–0.2s 到满速；松手 ~0.1s 停；反向 2× 减速；空中减半。

**相关概念**：[Delta time](#delta-time) · [Coyote time](#coyote-time) · [Steering behaviors](./systems.md#steering-behaviors)

---

<a id="hit-stop"></a>

## 17 · Hit stop · 命中停顿

> *命中瞬间双方都定格* ｜ `freeze both fighters on impact`

hit stop 在命中发生时让攻击者和目标一起暂停 50 到 100 ms。没有它，刀光两三帧就穿过目标，接触感很难看清。下面的挥击会冻结 120 ms——比通常稍长，方便你看到时间轴上的停顿——同时火花还在继续动。

**展开说**：命中瞬间把攻击方和被击方冻结 50–100ms，让 2–3 帧内就划过去的接触被看见。冻结的是角色动画和位移，UI、粒子、输入采样照常跑。

**什么时候用**：在接触的瞬间加一个短暂的局部冻结，让打击感更清晰，这就是 hit stop。输入收集要保持运行，并明确决定冻结期间粒子、相机运动和 UI 是否继续。

**什么时候别用**：连续高频命中（机枪、多段 AOE）不要每次都停，会卡成幻灯片；用冷却或只对重击生效。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-17)）

```text
Add hit stop: when a hit lands, pause the animation and movement of the attacker and the target for 50 to 100 ms scaled by the damage, keep reading and buffering input during the pause, and keep UI and particles running at normal speed.
```

**伪代码**（引擎无关，按需换成 API）

```text
onHit(damage):
  hitStopRemaining = durationFor(damage)
update(dt):
  readAndBufferInput()
  if hitStopRemaining > 0:
    hitStopRemaining -= dt
  else:
    updateFighters(dt)
```

**常见错误**：全局 time scale 可能连菜单、网络或本该结束 hit stop 的计时器一起冻住。用不受缩放影响的时钟推进 stop timer，也不要因为一次持续 overlap 反复延长它。

**关键参数**：50–100ms（按伤害缩放）；只冻角色；输入继续缓冲；多人游戏需同步。

**相关概念**：[Screen shake](#screen-shake) · [Input buffering](#input-buffering) · [Hitbox and hurtbox](./systems.md#hitbox-hurtbox)

---

<a id="invincibility-frames"></a>

## 18 · Invincibility frames · 无敌帧

> *挨打之后短暂安全* ｜ `brief safety after each hit`

invincibility frames（i-frames）是受击后 0.5 到 1 s 的窗口，期间角色无视后续伤害。没有它，一支与角色重叠 9 帧的箭会在 9 帧里都造成伤害，三支箭就能清空上面的血条。下面的角色挨一下、被击退，然后闪烁 1 s，下一支箭穿过去也不会造成伤害。

**展开说**：受伤后给 0.5–1s 免伤窗口，并配合按 10Hz 方波闪烁 + 击退。没有 i-frames，一发子弹在角色身上停留 9 帧就会结算 9 次伤害。

**什么时候用**：受伤后，或选定的 dodge frames 内，使用伤害冷却。视觉反馈要传达“无敌”，但伤害系统应独立于 sprite 是否可见来执行判定。

**什么时候别用**：坠落、地形伤害通常不触发 i-frames；持续伤害（毒）需要单独的 tick 机制。

**prompt bit**（英文，可直接粘贴；[中文版见 prompt-bits.md](./prompt-bits.md#bit-18)）

```text
Add invincibility frames: after the player takes damage, ignore all further damage for 0.5 to 1 s, blink the sprite on and off at about 10 Hz during that window, and apply a knockback impulse that pushes the player away from the damage source.
```

**伪代码**（引擎无关，按需换成 API）

```text
if incomingHit and invulnerability <= 0:
  health -= damage
  invulnerability = 0.75
invulnerability = max(0, invulnerability - dt)
visual.visible = invulnerability <= 0 or blinkPhase(time)
```

**常见错误**：只让 sprite 闪烁并不能阻止伤害。要明确哪些伤害类型无视无敌，并区分“对单个目标的冷却”和“阻止同一次攻击重复命中”。

**关键参数**：0.5–1.0s；闪烁 10Hz（不是每帧随机）；击退方向 = 伤害源 → 玩家。

**相关概念**：[Hitbox and hurtbox](./systems.md#hitbox-hurtbox) · [Hit stop](#hit-stop) · [Finite state machine](./systems.md#state-machine)

---

---

← [总索引](./index.md) ｜ 下一章 → [Systems · 系统](./systems.md)
