# 设计：3D 骨骼桌宠（glTF / Three.js 表现层）

日期：2026-11-16  
状态：已与用户确认

## 目标

在保留现有 webm（及并行的 Spine）桌宠能力的前提下，增加**真 3D 骨骼**表现层：使用现成 glTF/GLB + 骨骼动画，在透明 Electron 窗内以固定机位渲染；位移与意图编排复用统一行为层，首版达到「待机循环 + 走路位移 + 拖拽反馈」。

## 已确认决策

| 项 | 选择 |
|----|------|
| 渲染形态 | **A · 真 3D 骨骼**（glTF/GLB + skinned mesh），非伪 3D / 仅贴图板 |
| 首版素材 | **免费现成 glTF**（Khronos / Mixamo 等可演示授权），不自制建模管线 |
| 相机 | **固定机位**；左右朝向用动画或水平镜像，不提供自由旋转查看 |
| 渲染栈 | **Three.js + GLTFLoader + AnimationMixer** |
| 与现有宠物 | **多轨共存**：`presentation: "video" \| "spine" \| "model3d"` |
| 分支策略 | 从 **main** 拉独立分支 `feat/model3d-presentation`；**不依赖、不合并** `feat/spine-free-motion` |
| 架构 | 可插拔 **Presentation** + 统一 **BehaviorPlanner / Intent**（与 Spine 规格同构） |

## 非目标（首版）

- 自由轨道相机 / 用户拖拽旋转模型查看
- 物理布料、毛发、实时光照烘焙重算
- 换装 / 捏脸 / AI 生成 3D 网格或动画
- 自制 DCC 管线或强制迁移旧 webm 素材
- 实现 Spine 运行时（类型可预留 `"spine"`；实现落在独立分支）
- 多 3D 宠复杂社交剧情、任意窗口标题栏攀爬

## 架构

```
意图源（随机漫游 / 菜单 / 坐姿 / 用户 / 可选 AI）
        ↓
   BehaviorPlanner
   · 产出：目标点、朝向、clip 序列、循环/一次性、优先级
        ↓
   MotionDriver（演进现有 sendBounds；video 保留时长同步驱动）
        ↓
   Presentation
   ├─ VideoPresentation     ← 现有双 video 缓冲
   ├─ SpinePresentation     ← 类型预留 / 他分支实现
   └─ Model3dPresentation   ← Three.js + glTF（本规格）
```

### 分层职责

| 单元 | 做什么 | 依赖 |
|------|--------|------|
| Intent 源 | 产生结构化意图 | 无渲染知识 |
| BehaviorPlanner | 校验白名单、补 walk、算到达、处理打断 | clip 元数据、`walkSpeedPx` |
| MotionDriver | 窗口位移、抛掷物理 | Electron bounds API |
| Model3dPresentation | 挂载 WebGL、加载 GLB、播 clip、朝向、释放 | Three.js、DOM |

本分支从 main 出发时：若尚无可插拔 Presentation，则**一并引入**最小接口与 video 适配，再挂 `model3d`；不把 Spine 运行时搬进本分支。

## 配置

每只 `Pet` 增加：

- `presentation?: "video" | "spine" | "model3d"` — 缺省 `"video"`，旧配置零改动
- `model3d?` — 仅 `presentation === "model3d"` 时有效

建议资源目录：

```
assets/model3d/<petId>/
  character.glb          # 网格 + 动画可同文件，或分文件由 meta 声明
  meta.json              # clips、walkSpeedPx、pivot、scale、camera
```

`meta.json` 至少包含：

| 字段 | 含义 |
|------|------|
| `clips` | 槽位 → glTF animation name（或 clip 索引约定） |
| `walkSpeedPx` | 走路时窗口移动速度（与 2D 语义一致） |
| `scale` | 模型统一缩放 |
| `pivot` | 脚下锚点，用于对齐窗口底边 |
| `camera` | 固定机位参数（ortho/perspective、距离、fov 或 frustum） |
| `facingMode` | `"mirror"` \| `"turnClip"`（缺省 mirror） |

透明清屏：Three.js `alpha: true` + 预乘/直通与现有 Electron 透明窗对齐；背景 `setClearColor(0x000000, 0)`。

## Intent 契约

与 2D 骨骼规格对齐，便于同一 Planner：

```ts
type PetIntent = {
  goal?: { xRatio: number; yRatio: number };
  facing?: 'left' | 'right' | 'keep';
  sequence: Array<{
    clip: string;
    loop?: boolean;
    until?: 'arrive' | 'clip-end' | 'duration';
    durationMs?: number;
  }>;
  priority?: number;
  source: 'roam' | 'menu' | 'ai' | 'posture' | 'user';
};
```

### Planner 规则（首版）

1. 有 `goal` 且距离超过阈值 → 以 `walk`（可 loop）直到 `arrive`
2. 到达后执行序列中剩余非位移段
3. 计划结束 → 回 `idle`（`autoBehavior` / 漫游关闭时保持 idle 循环，不强制左半屏乱走）
4. 拖拽、菜单点播等更高优先级 → 取消当前漫游/AI 计划
5. 未知 clip 或非法坐标 → **拒绝整单意图**，不半执行
6. `presentation === "video"`：不读 `model3d` 资源块；行为映射保持现有移动 webm 逻辑

### 优先级（高打断低）

用户拖拽 / 点击点播 / 菜单 > 坐姿演出 > AI Intent > 随机漫游

## 首版 clip 白名单

| 槽位 | clip id | 用途 |
|------|---------|------|
| 待机 | `idle` | 默认**循环**（禁止播完冻帧） |
| 走路 | `walk` | 有窗口位移时 |
| 转身 | `turn` | 可选；默认可用水平镜像代替 |
| 互动 | `wave` / `happy` | 点击或菜单（素材有则映射，无则跳过该槽） |
| 拖拽 | `drag` | 拖拽态（素材无则保持 idle + 位移） |

首版演示宠至少保证 **`idle` + `walk`**；其余槽位按 GLB 实有动画映射，缺省不报错阻断启动。

## Presentation 接口

```ts
interface PetPresentation {
  mount(parent: HTMLElement): void;
  play(clip: string, opts: { loop: boolean }): Promise<void> | void;
  setFacing(dir: 'left' | 'right'): void;
  dispose(): void;
}
```

### Model3dPresentation 要点

- 加载：`GLTFLoader`（必要时 `DRACOLoader` 仅当素材需要）
- 动画：`AnimationMixer`；`play` 切换 clip；`idle` 必须 `loop = true`
- 朝向：`facingMode === "mirror"` 时对根节点 `scale.x` 取反或绕 Y 转 180°；有 `turn` 时可先播再切朝向
- 相机：创建后固定；窗口 resize 时更新 aspect / ortho 范围，不改变「观赏角度」语义
- 灯光：固定少量环境光 + 平行光，保证演示可读；不做昼夜系统
- 命中：首版窗口包围盒；像素级/网格拾取后置
- 帧率：可见时约 30fps；窗口隐藏可降帧或暂停 mixer
- 包体：Three.js 按需引入（至少 core + GLTFLoader + 所用控件以外的最小集合），避免整包无关示例

## 与现有代码的改动边界

| 区域 | 改动 |
|------|------|
| 配置 / 类型 | `presentation`、`model3d?`；`"spine"` 可进联合类型但不实现 |
| helper / sprite 初始化 | 按 presentation 挂 Video 或 Model3d 舞台 |
| 播放控制 | 对 Presentation 发 `play`；video 逻辑收敛到 VideoPresentation（可渐进） |
| motion | model3d 按 `walkSpeedPx` + Intent 驱动 `sendBounds` |
| 新增 | `Model3dPresentation`、meta 解析、BehaviorPlanner（若 main 尚无则最小实现） |
| 菜单 / 气泡 / 托盘 / 多开 | 尽量不改；设置页可后置「选择 3D 演示宠」 |
| 依赖 | 增加 `three`（及类型）；锁定版本写入 package |

默认演示配置：一只 `model3d-demo`（或等价 id），`autoBehavior` **可关**；关时仅 idle 循环 + 用户拖拽/点播。

## 错误处理

| 情况 | 行为 |
|------|------|
| GLB / 动画加载失败 | 不拖垮进程；日志 + 可提示；该实例跳过或占位 |
| clip 名在 GLB 中不存在 | `play` 失败回退 `idle`（若 idle 也无则静态 T-pose/首帧 + 日志） |
| Intent 非法 | 拒绝整单；不半执行 |
| WebGL 上下文丢失 | 日志；尝试一次恢复或停在该宠 |
| dispose / 窗关闭 | 取消 rAF、`mixer.stopAllAction`、释放几何/材质/渲染器 |
| video 宠带 model3d 字段 | 忽略 |

## 测试与验收

### 测试

- 单元：meta / clip 映射解析；Intent 校验；Planner（补 walk、到达、打断）在有实现时覆盖
- 回归：`presentation: "video"` 随机链、移动、拖拽抛掷无明显回退
- 手动：透明窗内 3D 宠 idle 循环；walk + 窗口移动；拖拽；`autoBehavior` 关闭后不左半屏乱走；DPI/多屏边缘钳制

### 验收标准

1. webm 与 model3d **可共存**（可先后或双开，视现有多开能力）
2. 至少一只 3D 宠：`idle` 循环不冻帧；`walk` 与窗口位移一致
3. 固定机位观感稳定；左右朝向正确
4. 加载失败不拖垮应用

## 交付切片

1. 分支 + 依赖 three；类型 / 配置 `presentation: "model3d"`；空舞台透明清屏
2. 加载演示 GLB + 固定相机 + `idle` 循环上屏
3. `play` / `setFacing` + 与 `sendBounds` 联动走路
4. BehaviorPlanner 最小规则（或接入已有 Intent）；`autoBehavior` 开关行为符合预期
5. 文档：素材来源与授权说明、目录约定；可选设置项

## 成本与可行性（摘要）

- **可行性：** 高；Electron 透明窗 + WebGL 已有 Spine/Canvas 先例，Three.js 生态成熟
- **工程：** 首版演示约数天～1–2 周（有现成 GLB、固定机位）
- **风险：** 透明合成、预乘 alpha、高 DPI、部分 GPU 驱动；用切片 1–2 尽早验证
- **后续（本规格外）：** 轨道相机、换装、与 Spine 分支合并统一 Presentation 工厂、更富 clip 集

## 分支与文档

- Git 分支：`feat/model3d-presentation`（基于 main）
- 本设计路径：`docs/superpowers/specs/2026-11-16-model3d-presentation-design.md`（目录若被 ignore，以工作区文件为准）
- 对外说明（实现期同步）：`docs/model3d-presentation.md`（素材署名、如何启用演示宠）
