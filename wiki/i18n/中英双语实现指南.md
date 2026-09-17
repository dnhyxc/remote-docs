# 前端中英文切换（i18n）实现思路与代码逐行注释（基于当前仓库实现）

> 目标：基于现有代码改动，沉淀一份**可复用、可扩展、切换即时生效**的中英文切换实现说明。  
> 约束：本文档**不要求也不建议修改现有代码**；仅解释当前实现，并给出扩展方式与注意事项。  
> 术语说明：  
> - **i18n（国际化）**：Internationalization 的缩写，指多语言能力。  
> - **locale（语言环境）**：例如 `zh-CN`、`en-US`。  
> - **dict（词典）**：键值对映射，例如 `route.chat.title -> 智能对话 / Chat`。  
> - **fallback（兜底）**：当 key 缺失时回退到默认语言或回退到 key 本身。  
> - **pub-sub（发布订阅）**：用订阅列表通知所有监听者刷新。  
> - **useSyncExternalStore（同步外部存储订阅）**：React 官方用于订阅外部状态的 Hook。

---

## 1. 总体架构（从“状态”到“组件渲染”）

当前仓库 i18n 的核心设计点是：

- **全局唯一的 `currentLocale`**：语言状态不放在某个组件的 `useState` 里，避免“切语言只刷新局部、页面不刷新”的问题。
- **`useSyncExternalStore` 订阅**：所有使用 `useI18n()` 的组件都会订阅全局语言状态变化，语言切换后立刻触发重渲染。
- **初始化优先级**：
  - URL 查询参数 `?lang=` / `?locale=`（用于分享、复制链接、刷新一致）
  - `localStorage` 的 bootstrap 值（为首屏同步读取服务）
  - Tauri（桌面端）持久化 `getValue('locale')`（异步，最终一致）
  - 默认语言 `DEFAULT_LOCALE`
- **词典加载方式**：静态 import 词典对象，`DICTS[locale]` 直接索引；查不到时回退到默认词典 `DEFAULT_LOCALE`。
- **组件接入策略**：
  - 页面组件：直接 `const { t } = useI18n()`，然后把硬编码文案替换为 `t('xxx')`。
  - 可复用组件：增加可选 `t?: (key, params?) => string`，组件内部统一使用 `t?.(key) ?? '中文兜底'`，让其在“未注入 i18n 的场景”仍可工作。

---

## 2. 词典入口：`apps/frontend/src/i18n/index.ts`

该文件定义了 locale 类型、默认语言、词典映射与支持列表。下面是**逐行注释版**（为避免影响源码，注释仅写在文档代码块中）。

```ts
import { enUS } from './locales/en-US'; // 引入英文词典对象
import { zhCN } from './locales/zh-CN'; // 引入中文词典对象

export type Locale = 'zh-CN' | 'en-US'; // 约束可用语言环境（locale）为两种

export const DEFAULT_LOCALE: Locale = 'zh-CN'; // 定义默认语言；同时作为 fallback 语言

export const DICTS: Record<Locale, Record<string, string>> = { // 词典总表：locale -> (key -> 文案)
  'zh-CN': zhCN, // 中文词典
  'en-US': enUS, // 英文词典
}; // 结束词典映射

export const SUPPORTED_LOCALES: Locale[] = ['zh-CN', 'en-US']; // 显式列出支持的语言，便于校验与下拉展示
```

---

## 3. 核心 Hook：`apps/frontend/src/hooks/i18n.ts`

这是整个“切换即时生效”的关键。下面是**逐行注释版**（与当前代码逻辑一致，注释仅写在文档代码块中）。

```ts
import { useEffect, useMemo, useSyncExternalStore } from 'react'; // React Hook：副作用、记忆化、订阅外部 store
import { DEFAULT_LOCALE, DICTS, type Locale, SUPPORTED_LOCALES } from '@/i18n'; // i18n 配置：默认语言、词典、类型、支持列表
import { getValue, setValue } from '@/utils'; // 桌面端/通用持久化读写（Tauri store 等封装）

/** 供首屏同步读取，降低刷新时语言晚于首帧 */ // 解释：需要一个同步可读的存储，避免刷新后首屏先用默认语言再闪一下
export const LOCALE_BOOTSTRAP_STORAGE_KEY = 'dnhyxc_locale_bootstrap'; // localStorage key：仅用于“启动引导”

function persistLocaleBootstrap(locale: Locale) { // 写入 localStorage 的 bootstrap 值
  try { // try：避免隐私模式/禁用存储时报错
    localStorage.setItem(LOCALE_BOOTSTRAP_STORAGE_KEY, locale); // 写入本地同步存储
  } catch { // 捕获异常
    // 私密模式等场景忽略 // 不阻塞应用
  } // 结束 catch
} // 结束 persistLocaleBootstrap

function parseLocaleFromSearch(search: string): Locale | null { // 从 URL query 中解析语言
  try { // try：URLSearchParams 解析可能失败
    const params = new URLSearchParams( // 构造 URL 参数解析器
      search.startsWith('?') ? search : `?${search}`, // 兼容传入 "lang=xx" 或 "?lang=xx"
    ); // 结束 URLSearchParams
    const raw = params.get('lang') || params.get('locale'); // 支持两种参数名：lang/locale
    if (!raw) return null; // 没有参数则返回 null
    return SUPPORTED_LOCALES.includes(raw as Locale) ? (raw as Locale) : null; // 白名单校验：只允许支持的 locale
  } catch { // 解析失败
    return null; // 返回 null 表示无有效语言
  } // 结束 catch
} // 结束 parseLocaleFromSearch

function readLocaleBootstrapSync(): Locale | null { // 启动阶段同步读取 locale（首屏用）
  if (typeof window === 'undefined') return null; // SSR/非浏览器环境直接返回 null
  try { // try：localStorage 访问可能失败
    const fromUrl = parseLocaleFromSearch(window.location.search); // 1）优先从 URL 读（分享/刷新一致）
    if (fromUrl) return fromUrl; // 若 URL 有值，直接用
    const b = localStorage.getItem(LOCALE_BOOTSTRAP_STORAGE_KEY) as Locale; // 2）否则从 bootstrap 存储读
    return SUPPORTED_LOCALES.includes(b) ? b : null; // 校验合法性，不合法返回 null
  } catch { // 存储异常
    return null; // 返回 null：最终会落到 DEFAULT_LOCALE
  } // 结束 catch
} // 结束 readLocaleBootstrapSync

function applyLangToDocument(locale: Locale) { // 将语言写入 <html lang="...">
  try { // try：document 访问可能失败
    document.documentElement.lang = locale; // 设置页面语言，利于 a11y、拼写检查、翻译等
  } catch { // 忽略异常
    // ignore
  } // 结束 catch
} // 结束 applyLangToDocument

function interpolate(template: string, params?: Record<string, unknown>): string { // 字符串参数插值：把 "{x}" 替换为 params.x
  if (!params) return template; // 无参数则原样返回
  return template.replace(/\\{(\\w+)\\}/g, (full, k) => { // 正则匹配 "{key}" 形式
    const v = params[k]; // 取参数值
    return v == null ? full : String(v); // null/undefined 则保留原占位符，否则转字符串
  }); // 结束 replace
} // 结束 interpolate

// ---- 全局 i18n 状态（保证任意组件切换语言都会更新） ---- // 关键：把语言状态提升到模块全局
let currentLocale: Locale = readLocaleBootstrapSync() ?? DEFAULT_LOCALE; // 当前语言：同步读 bootstrap，否则用默认语言
const localeListeners = new Set<() => void>(); // 订阅者集合：语言变化时通知它们

function emitLocaleChanged() { // 触发所有订阅者更新
  for (const l of localeListeners) l(); // 逐个调用 listener，让 useSyncExternalStore 触发重渲染
} // 结束 emitLocaleChanged

function subscribeLocale(listener: () => void) { // useSyncExternalStore 的订阅函数
  localeListeners.add(listener); // 注册
  return () => localeListeners.delete(listener); // 返回取消订阅函数
} // 结束 subscribeLocale

function getLocaleSnapshot(): Locale { // useSyncExternalStore 的快照读取函数（同步）
  return currentLocale; // 返回当前语言
} // 结束 getLocaleSnapshot

async function setLocaleGlobal(next: Locale, opts?: { syncUrl?: boolean }) { // 全局设置语言（含持久化与 URL 同步）
  if (!SUPPORTED_LOCALES.includes(next)) return; // 防守：不允许设置不支持的语言
  if (next === currentLocale) return; // 同值短路：避免重复通知与重复写入
  currentLocale = next; // 更新全局语言
  applyLangToDocument(next); // 立即写入 <html lang="...">
  persistLocaleBootstrap(next); // 立即写入 bootstrap，保证刷新首屏同步命中
  emitLocaleChanged(); // 通知所有订阅者刷新
  await setValue('locale', next); // 异步持久化到 Tauri store（或统一存储）

  // 推荐：同步覆盖 URL lang，保证复制/刷新一致 // 默认开启；某些初始化场景可关闭
  if (opts?.syncUrl !== false && typeof window !== 'undefined') { // syncUrl 默认 true
    try { // try：URL 操作可能失败
      const u = new URL(window.location.href); // 用当前地址构造 URL
      u.searchParams.set('lang', next); // 写入/覆盖 lang 参数
      window.history.replaceState(null, '', u.toString()); // replace：不新增历史记录
    } catch { // 忽略异常
      // ignore
    } // 结束 catch
  } // 结束 if
} // 结束 setLocaleGlobal

export function useI18n() { // 对外 Hook：组件通过它拿到 locale/t/setLocale/toggleLocale
  const locale = useSyncExternalStore( // 订阅全局 locale：切换后立刻触发更新
    subscribeLocale, // 订阅：注册 listener
    getLocaleSnapshot, // 快照：同步读取 currentLocale
    () => DEFAULT_LOCALE, // SSR/回退快照：返回默认语言
  ); // 结束 useSyncExternalStore

  useEffect(() => { // 初始化 effect：启动时把 URL/store 的值对齐到全局
    // 启动时先应用一次，避免“默认语言选中但未生效” // 确保 document/lang/bootstrap 在首帧之后也一致
    applyLangToDocument(locale); // 写入 document.lang
    persistLocaleBootstrap(locale); // 写入 bootstrap

    const init = async () => { // 异步初始化：读取 URL/store 并更新全局 locale
      if (typeof window !== 'undefined') { // 仅浏览器环境
        const fromUrl = parseLocaleFromSearch(window.location.search); // 1）URL 优先
        if (fromUrl) { // 如果 URL 指定了语言
          await setLocaleGlobal(fromUrl, { syncUrl: false }); // 写入全局但不回写 URL（避免抖动/循环）
          // 仅写 bootstrap，不强制覆盖用户持久化设置 // 解释：URL 适合“当前会话/分享场景”，不必覆盖用户偏好
          return; // 初始化结束
        } // 结束 if
      } // 结束 window 检查

      const stored = (await getValue('locale')) as Locale | undefined; // 2）读取持久化语言（异步）
      if (stored && SUPPORTED_LOCALES.includes(stored)) { // 校验合法性
        await setLocaleGlobal(stored, { syncUrl: false }); // 写入全局，但不主动改 URL（避免打开应用时改动地址）
      } // 结束 if
    }; // 结束 init
    void init(); // 调用 init（忽略 Promise，避免 effect 直接 async）
    // eslint-disable-next-line react-hooks/exhaustive-deps // 只跑一次：避免在 locale 变化时重复 init 覆盖用户选择
  }, []); // 空依赖：只在 mount 时执行

  const dict = useMemo(() => DICTS[locale] ?? DICTS[DEFAULT_LOCALE], [locale]); // 当前词典：不存在则回退默认词典
  const fallbackDict = DICTS[DEFAULT_LOCALE]; // fallback 词典：默认语言

  const t = useMemo(() => { // 翻译函数：稳定引用，避免每次 render 创建新函数
    return (key: string, params?: Record<string, unknown>) => { // t(key, params)
      const raw = dict[key] ?? fallbackDict[key]; // 优先当前语言，其次默认语言
      if (!raw) return key; // 两边都没有：返回 key 作为可见提示，便于发现漏翻
      return interpolate(raw, params); // 有值：做参数插值
    }; // 结束返回函数
  }, [dict, fallbackDict]); // 依赖：词典变化时重建

  const setLocale = async (next: Locale, opts?: { syncUrl?: boolean }) => { // 对外 setLocale
    await setLocaleGlobal(next, opts); // 委托给全局 setter
  }; // 结束 setLocale

  const toggleLocale = async () => { // 对外 toggle：Header 快捷切换用
    await setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN'); // 二选一切换
  }; // 结束 toggleLocale

  return { locale, setLocale, toggleLocale, t, supportedLocales: SUPPORTED_LOCALES }; // 返回 i18n 能力
} // 结束 useI18n
```

---

## 4. Header 快捷切换：`apps/frontend/src/components/design/Header/index.tsx`

Header 中通过 `useI18n()` 获取 `toggleLocale()`，并将“语言切换”放在主题切换前（符合当前产品需求）。下面给出**关键片段的逐行注释版**：

```ts
import { Languages } from 'lucide-react'; // 图标：Languages（语言）
import { useI18n } from '@/hooks'; // i18n：提供 t / toggleLocale

// ... 省略其它 import 与组件结构 ...

const { t, toggleLocale } = useI18n(); // 获取翻译函数与快捷切换

// ... 省略其它逻辑 ...

<div
  title={t('header.toggleLanguage')} // 鼠标悬停提示：来自词典 key
  className="..." // 样式
  onClick={() => void toggleLocale()} // 点击切换语言（异步）
>
  <Languages className="w-5 h-4.5" /> {/* 图标本身无需翻译 */}
</div>
```

---

## 5. 路由标题 i18n：`apps/frontend/src/router/routes.ts`

路由 meta 中新增 `titleKey`，Header 会优先用 `titleKey` 去翻译显示，避免 route title 硬编码。

```ts
export interface RouteMeta {
  title?: string; // 旧字段：可保留
  titleKey?: string; // 新字段：多语言 key，优先渲染
}

// 示例：Chat 路由使用 titleKey
{
  path: '/chat',
  Component: Chat,
  meta: {
    titleKey: 'route.chat.title', // 由词典提供中/英文
  },
}
```

---

## 6. 组件级“可选 t 透传”模式（关键实践）

为了让公共组件可在“未接入 i18n 的宿主”中也能工作，当前仓库采用：

- Prop：`t?: (key, params?) => string`（非必传）
- 使用：`t?.('key') ?? '中文兜底'`

### 6.1 MarkdownEditor（Monaco）模式示例：`apps/frontend/src/components/design/Monaco/index.tsx`

```ts
export type MarkdownEditorT = (key: string, params?: Record<string, unknown>) => string; // 统一的 t 类型

interface MarkdownEditorProps {
  // ... 其它 props ...
  t?: MarkdownEditorT; // 可选：由外部注入翻译函数
}

const MarkdownEditor = ({ placeholder: placeholderProp, t }: MarkdownEditorProps) => {
  const placeholder = placeholderProp ?? (t?.('monaco.placeholder') ?? '# 输入内容...'); // 外部 placeholder 优先，其次 i18n，其次中文兜底
  // ... 省略 ...
};
```

### 6.2 Markdown 预览示例：`apps/frontend/src/components/design/Markdown/index.tsx`

```ts
type MarkdownPreviewT = (key: string, params?: Record<string, unknown>) => string; // 预览组件的 t 类型

interface ParserMarkdownPreviewPaneProps {
  markdown: string; // 预览内容
  t?: MarkdownPreviewT; // 可选：外部注入
}

// 使用示例（空预览文案）
{t?.('markdown.preview.empty') ?? '预览内容为空'} // i18n 优先，否则中文兜底
```

---

## 7. Key 命名规范建议（与当前实现一致）

- **页面级**：`home.*` / `knowledge.*` / `chat.*` / `coding.*` / `pay.*`
- **公共组件/布局**：`common.*` / `nav.*` / `route.*` / `header.*`
- **模块内细分**：
  - `chat.entry.*`（输入区）
  - `chat.controls.*`（滚动/分支控制）
  - `chat.assistant.*`（助手气泡）
  - `chat.codeToolbar.*`（代码吸顶工具条）
  - `mermaid.toolbar.*`（Mermaid 顶栏）

---

## 8. 扩展指南：新增一个页面/组件如何接入 i18n

### 8.1 新页面（推荐）

1. 在页面组件里：
   - `const { t } = useI18n();`
   - 将硬编码文案替换为 `t('your.key')`
2. 在 `apps/frontend/src/i18n/locales/zh-CN.ts` 与 `en-US.ts` 补齐 key
3. 若是路由标题：在 `routes.ts` 使用 `meta.titleKey`

### 8.2 新公共组件（推荐：可选 t 透传）

1. Props 增加 `t?: (key, params?) => string`
2. 文案使用 `t?.('key') ?? '中文兜底'`
3. 由上层（页面/容器）传入 `t={t}`

---

## 9. 常见坑与当前实现如何规避

- **切语言不刷新页面**：把 locale 放在组件 `useState` 会导致其它页面不订阅；当前实现用 `useSyncExternalStore` 订阅全局 `currentLocale`，避免该问题。
- **刷新闪一下默认语言**：当前实现用 localStorage bootstrap 同步读取，降低首屏语言滞后。
- **复制链接后语言丢失**：默认会写 `?lang=` 到 URL（可通过 `setLocale(next, { syncUrl: false })` 禁用）。
- **key 缺失不易发现**：当前 `t()` 在两套词典都没找到时返回 key，能快速暴露漏翻。

---

## 10. 参考文件清单（当前仓库真实路径）

- i18n 配置：`apps/frontend/src/i18n/index.ts`
- i18n Hook：`apps/frontend/src/hooks/i18n.ts`
- Header 快捷切换：`apps/frontend/src/components/design/Header/index.tsx`
- 路由标题 key：`apps/frontend/src/router/routes.ts`
- 中文词典：`apps/frontend/src/i18n/locales/zh-CN.ts`
- 英文词典：`apps/frontend/src/i18n/locales/en-US.ts`
- 可选 t 透传示例：`apps/frontend/src/components/design/Monaco/index.tsx`、`apps/frontend/src/components/design/Markdown/index.tsx`

