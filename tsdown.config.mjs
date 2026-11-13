// tsdown 配置：独立桌宠多入口构建（src → lib）
//
// 四段入口：
//   1) 宿主半侧（index → lib/index.js）—— ESM，供 standalone / Electron 应用内嵌。
//   2) 独立 CLI（standalone → lib/standalone.js）—— 无外部宿主；@deepseek-ai/* 专有包用
//      src/standalone/shims/* 替身，其余仍外部化。
//   3) Electron 应用（app → lib/app.js）—— 单进程服务 + 宿主 + 桌面窗口。
//   4) 设置页对话面板（chat-panel → lib/chat-panel.js）—— 浏览器环境，react 内联打包。
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

/** 本配置文件所在目录（= 包根） */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)));

/** 替换包名用的绝对路径（rolldown 的 alias 收绝对路径最稳） */
const shim = (name) => join(packageRoot, 'src', 'standalone', 'shims', `${name}.ts`);

/** 两份配置共用的编译口径 */
const shared = {
  format: ['esm'],
  platform: 'node',
  target: 'es2020',
  dts: false,
  outDir: 'lib',
  clean: false,
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/host/index.ts',
    },
    external: [/^@deepseek-ai\//, /^@electron\//, /^node:/],
  },
  {
    ...shared,
    // 独立模式只在 Node ≥ 22.12 上运行（package.json 的 engines 已声明），因此目标可以是 es2022：
    // es2020 目标会把 class field 一类语法降级成 `_defineProperty(...)`，进而把
    // `@oxc-project/runtime` 拖成一条裸 import —— 那个包不在本包依赖里，装好的用户跑起来会
    // ERR_MODULE_NOT_FOUND。提到 es2022 后这类降级辅助整体消失（与插件本体的 es2020 产物无关，
    // 两者是不同的入口，DSH 侧仍按 es2020 发布）。
    target: 'es2022',
    entry: {
      standalone: 'src/standalone/cli.ts',
    },
    // tsdown 默认把 dependencies/peerDependencies 全部外部化（本包那三个 DSH 专有包正是
    // peerDependencies），所以这里必须先 noExternal 把它们拉回打包图，下面的 alias 才轮得到生效；
    // 否则产物里留下裸 import，在没有 DSH 的环境里 ERR_MODULE_NOT_FOUND。
    noExternal: [/^@deepseek-ai\/(?:dsh-home-paths|dsh-credentials|dsh-llm)$/],
    // 除三个替身外，其余 @deepseek-ai/* 仍视为宿主提供（负向断言）
    external: [/^@electron\//, /^node:/, /^@deepseek-ai\/(?!dsh-home-paths$|dsh-credentials$|dsh-llm$)/],
    alias: {
      '@deepseek-ai/dsh-home-paths': shim('dsh-home-paths'),
      '@deepseek-ai/dsh-credentials': shim('dsh-credentials'),
      '@deepseek-ai/dsh-llm': shim('dsh-llm'),
    },
  },
  {
    ...shared,
    // 独立应用入口（`lib/app.js`）：一个 Electron 进程里跑「本机服务 + 插件宿主半边 + 桌面窗口」。
    // 口径与 standalone 完全一致（三个 DSH 专有包同样换成替身），只多外部化 `electron` ——
    // 它由 Electron 自己的模块加载器提供，进包反而会炸。
    target: 'es2022',
    entry: {
      app: 'src/app/main.ts',
    },
    // zod 打进包：应用产物要做到「不依赖 node_modules」，而配置校验每次启动都要用。
    // openai / @anthropic-ai/sdk 同样必须打进包：它们由 src/standalone/ai-transport.ts 顶层静态
    // import，而 electron-builder 的 files 白名单不带 node_modules；留成外部裸 import 时，产物
    // 一旦离开项目目录（例如解压到 Downloads）就会 ERR_MODULE_NOT_FOUND。
    // @electron/get 与 @electron-internal/extract-zip 保持外部——它们只在「下载 Electron」时被
    // 动态解析，应用模式永远不走那条路（见 src/host/helper-process.ts 的 import 注释）。
    noExternal: [
      /^@deepseek-ai\/(?:dsh-home-paths|dsh-credentials|dsh-llm)$/,
      /^zod$/,
      /^openai$/,
      /^@anthropic-ai\/sdk$/,
      // 语音合成：运行时才 import，但应用产物无 node_modules，必须内联（连它的 ws 一起）。
      /^@andresaya\/edge-tts$/,
    ],
    external: ['electron', /^@electron\//, /^node:/, /^@deepseek-ai\/(?!dsh-home-paths$|dsh-credentials$|dsh-llm$)/],
    alias: {
      '@deepseek-ai/dsh-home-paths': shim('dsh-home-paths'),
      '@deepseek-ai/dsh-credentials': shim('dsh-credentials'),
      '@deepseek-ai/dsh-llm': shim('dsh-llm'),
    },
  },
  {
    ...shared,
    // 独立模式设置页里的对话面板（lib/chat-panel.js）：跑在浏览器里，既没有 DSH 注入也没有
    // node_modules，所以 react / react-dom 必须打进产物——这与 client 那份正好相反（那边由宿主提供）。
    // platform 覆盖成 browser，否则 tsdown 会按 node 口径解析并留下 node: 内置依赖。
    platform: 'browser',
    target: 'es2020',
    entry: {
      'chat-panel': 'src/standalone/settings-page/chat-mount.ts',
    },
    noExternal: [/^react(\/|$)/, /^react-dom(\/|$)/],
    external: [/^node:/],
    // 与 client 同理：设置页刷新会重跑脚本，包一层 IIFE 免得顶层声明重复触发 SyntaxError。
    outputOptions: { banner: ';(()=>{', footer: '})();' },
  },
]);
