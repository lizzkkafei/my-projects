# 34 概念总索引

> 反查用：从中文名、英文名、症状关键词都能找到对应概念。
> 每个概念在对应章节文件里有稳定锚点，链接可直接跳。

## 3D & rendering · 3D 与渲染（8）

3D 场景怎么变成像素，以及怎么少画。

| # | 概念 | English | 一句话 | 触发词 |
|---|---|---|---|---|
| 01 | 射线检测 | [Raycasting](./3d-rendering.md#raycasting) | 从一点朝一个方向发一条不可见线，返回第一个撞到的物体 | 命中判定、鼠标拾取、地面探测、视线 |
| 02 | 法线 | [Normals](./3d-rendering.md#normals) | 垂直于表面的单位向量，决定光照亮暗与「能不能站」 | 光照、反弹、坡度、表面朝向 |
| 03 | 细节层级 | [Level of detail](./3d-rendering.md#level-of-detail) | 离远就换低模，反正看不见那么多三角面 | 远处变糊、模型面数、LOD |
| 04 | 视锥剔除 | [Frustum culling](./3d-rendering.md#frustum-culling) | 相机看不见的东西直接不画 | 视野外还渲染、剔除、包围球 |
| 05 | 片元着色器 | [Fragment shader](./3d-rendering.md#fragment-shader) | 每个像素跑一次的 GPU 小程序，决定这个像素什么颜色 | 水面、描边、扫描线、特效、GLSL |
| 06 | 面向相机 | [Billboarding](./3d-rendering.md#billboarding) | 每帧把平面转到正对相机，任何角度都能读 | 血条、名字、伤害数字、树、公告板 |
| 07 | 四元数 | [Quaternions](./3d-rendering.md#quaternions) | 用 4 个数表示旋转，插值走最短弧、不会翻转 | 旋转乱转、slerp、欧拉角、万向节 |
| 08 | Z 冲突 | [Z-fighting](./3d-rendering.md#z-fighting) | 两个面同一深度，深度缓冲逐像素打架 → 闪烁条纹 | 闪烁、贴花、共面、深度精度 |

## Game feel · 手感（10）

让跳跃、打击、相机符合玩家直觉的时间与运动规则。

| # | 概念 | English | 一句话 | 触发词 |
|---|---|---|---|---|
| 09 | 帧时间 | [Delta time](./game-feel.md#delta-time) | 上一帧花了多少秒，所有速度乘它才与帧率无关 | 高刷变快、帧率、变速、帧率无关 |
| 10 | 土狼时间 | [Coyote time](./game-feel.md#coyote-time) | 跑出平台后还允许你迟一点起跳（0.1–0.15s） | 跳不起来、边缘、迟按、宽容 |
| 11 | 缓动 | [Easing](./game-feel.md#easing) | 把 0→1 的线性进度弯成曲线：减速、冲过头再回弹 | UI 动画、菜单、相机平移、tween |
| 12 | 屏幕震动 | [Screen shake](./game-feel.md#screen-shake) | 一个 trauma 值驱动的抖动，平方后衰减，用平滑噪声 | 打击反馈、爆炸、震屏、trauma |
| 13 | 挤压拉伸 | [Squash and stretch](./game-feel.md#squash-and-stretch) | 沿速度方向拉长、落地压扁，反向轴缩放补偿（2D 保面积；3D 用 1/√s） | 弹跳、弹性、变形、卡通 |
| 14 | 相机死区 | [Camera deadzone](./game-feel.md#camera-deadzone) | 屏幕中间留一块不动区，玩家小移动时相机不晃 | 相机跟随、晃、抖动、镜头 |
| 15 | 输入缓冲 | [Input buffering](./game-feel.md#input-buffering) | 记住 0.1s 内的按键，等到能做的那一刻立刻执行 | 早按、连招、落地跳、输入延迟 |
| 16 | 加速与摩擦 | [Acceleration and friction](./game-feel.md#acceleration-and-friction) | 速度慢慢逼近目标值，而不是一帧到位 | 惯性、滑、刹车、移动手感 |
| 17 | 命中停顿 | [Hit stop](./game-feel.md#hit-stop) | 命中瞬间双方冻结 50–100ms，让接触被看见 | 打击感、卡肉、顿帧、冻结 |
| 18 | 无敌帧 | [Invincibility frames](./game-feel.md#invincibility-frames) | 受伤后 0.5–1s 免伤并闪烁，防止连续掉血 | 掉血太快、闪烁、受击、knockback |

## Systems · 系统（9）

角色、战斗、移动、物理的代码骨架。

| # | 概念 | English | 一句话 | 触发词 |
|---|---|---|---|---|
| 19 | 对象池 | [Object pooling](./systems.md#object-pooling) | 一次分配、反复复用，避免 GC 卡顿 | 卡顿、GC、子弹、粒子、实例化 |
| 20 | 有限状态机 | [Finite state machine](./systems.md#state-machine) | 一个状态在跑，转移表显式，非法事件忽略 | 状态乱、动画打断、isJumping |
| 21 | 判定框 | [Hitbox and hurtbox](./systems.md#hitbox-hurtbox) | 攻击的判定区只在有效帧开启，防御方有可受击区 | 打不中、判定、攻击帧、躲避 |
| 22 | A* 寻路 | [A* pathfinding](./systems.md#pathfinding) | 每次都扩展「已走代价 + 剩余估计」最小的格子 | 寻路、绕障、导航网格、敌人寻敌 |
| 23 | 粒子系统 | [Particle system](./systems.md#particle-system) | 一个发射器 + 几个数字（速率/寿命/扩散/重力/阻力） | 火花、烟、爆炸、特效、confetti |
| 24 | 固定步长 | [Fixed timestep](./systems.md#fixed-timestep) | 物理用固定 1/60s 切片推进，与渲染帧率解耦 | 物理爆炸、弹簧发散、不同步 |
| 25 | 转向行为 | [Steering behaviors](./systems.md#steering-behaviors) | 每帧给速度加一个「转向力」，让单位平滑扑向目标 | 群体、追人、绕圈、separation、arrive |
| 26 | 穿透 | [Tunneling](./systems.md#tunneling) | 一帧移动太远，前后都在墙两侧 → 穿墙 | 穿墙、子弹漏判、高速、CCD |
| 27 | 种子噪声 | [Seeded noise](./systems.md#seeded-noise) | 同一种子必然生成同一个世界，存档只存种子 | 世界生成、随机地图、可复现、Perlin |

## Performance · 性能（7）

16.67ms 花在哪，以及怎么少花。

| # | 概念 | English | 一句话 | 触发词 |
|---|---|---|---|---|
| 28 | 帧预算 | [Frame budget](./performance.md#frame-budget) | 60fps = 每帧 16.67ms，输入/逻辑/物理/渲染共享 | 掉帧、测量、performance.now、卡 |
| 29 | 绘制调用 | [Draw calls](./performance.md#draw-calls) | CPU 每次告诉 GPU「画一个网格」都要花钱，能合并就合并 | 卡在 CPU、instancing、合批 |
| 30 | 空间划分 | [Spatial partitioning](./performance.md#spatial-partitioning) | 只和附近的物体比，别做 O(n²) 两两检测 | 碰撞爆炸、网格、四叉树、broadphase |
| 31 | 过度绘制 | [Overdraw](./performance.md#overdraw) | 同一像素被着色多次，透明粒子是重灾区 | 手机发烫、烟雾、透明、填充率 |
| 32 | 时间切片 | [Time slicing](./performance.md#time-slicing) | 把贵计算（AI/寻路）拆到多帧，每帧只做一个 bucket | AI 卡、决策、分摊、bucket |
| 33 | 贴图图集 | [Texture atlas](./performance.md#texture-atlas) | 把小图拼成一张大图，同图集可一次画完 | 批处理中断、材质切换、sprite |
| 34 | 分块加载 | [Chunk streaming](./performance.md#chunk-streaming) | 只加载玩家附近的地块，远了卸载，带滞回 | 大世界、开放世界、加载卡顿、streaming |

---

## 按症状反查（最常用）

| 你看到的 | 概念 |
|---|---|
| 高刷屏上角色跑得更快 | delta time |
| 跳跃手感发硬、迟按就掉下去 | coyote time · input buffering |
| 走路像在冰上 / 像机器人 | acceleration and friction |
| 打上去软绵绵 | hit stop · screen shake · squash and stretch |
| 受伤连续掉血 / 血条瞬间空 | invincibility frames |
| 相机一直晃、晕 | camera deadzone · easing |
| 子弹穿墙 / 打不中高速目标 | tunneling · raycasting |
| 越玩越卡、战斗时掉帧 | object pooling · particle system · overdraw |
| 手机发烫、画面糊 | overdraw · texture atlas |
| 角色状态互相打架 | state machine |
| 敌人直线冲过来堆在一起 | steering behaviors · pathfinding |
| 物理抖、弹簧炸 | fixed timestep |
| 物体边缘闪、贴花乱闪 | z-fighting |
| 转身像抽风 | quaternions |
| 血条/名字侧面看不见 | billboarding |
| 远处物体开销大 | LOD · frustum culling |
| 大世界加载卡 | chunk streaming |
| 每次生成的地图都不一样、存不了档 | seeded noise |
