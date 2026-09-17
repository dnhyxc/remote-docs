# Agent 业务消息分表落地（M0–M4）

> **状态**：M0–M4 已落地（2026-09-15）  
> **规划原文**：[docs/ideas/agent/Agent业务消息分表.md](../ideas/agent/Agent业务消息分表.md)  
> **实现思路（逐行注释）**：[Agent记忆分表.md](./Agent记忆分表.md)  
> **文件归位**：[业务记忆文件归位.md](./业务记忆文件归位.md)（业务记忆从 `agent/` 迁入领域目录，无行为变化）

---

## 1. 总览

| 阶段 | 内容 | 状态 |
|------|------|------|
| M0 | `AgentTurnMemory` + 默认 `agent_*` | ✅ |
| M1 | 知识库 Skill → `assistant_*` | ✅ |
| M2 | 英语学习 → `english_agent_*` | ✅ |
| M3 | Skill 试跑/生成 → `skill_try_messages` | ✅ |
| M4 | 产品路径停写 `agent_messages`（仅遗留/未识别会话回退） | ✅ |

**原则**：`/agent/sse` 仍是通用推理；消息与多轮记忆同源落在业务表；`agent_sessions` 保留为停流/epoch 运行句柄。

---

## 2. 改动要点

### 2.1 新表

| 表 | 用途 |
|----|------|
| `english_agent_sessions` / `english_agent_messages` / `english_agent_session_summaries` | 英语学习历史与记忆（会话 id 与 `agent_sessions` 相同） |
| `skill_try_messages` / `skill_try_session_summaries` | Skill 试跑/生成消息（`session_id` = `skill_try_sessions.id`） |

迁移文件：`apps/backend/src/migrations/1789300000000-agent-business-split.ts`（**仅建表，不迁旧数据**）。  
开发环境 `DB_SYNC=true` 时由实体自动建表即可。

**约定**：不以 `agent_*` 旧会话为准；验收与使用均以本方案下**新产生**的会话为准。

### 2.2 后端核心

| 文件 | 变更 |
|------|------|
| `agent-turn-memory.ts` | 记忆端口 |
| `assistant/assistant-table-memory.ts` | M1（归位后路径，见 [业务记忆文件归位.md](./业务记忆文件归位.md)） |
| `english-learning/english-table-memory.ts` | M2 |
| `skill/skill-try-table-memory.ts` | M3 |
| `agent.service.ts` | `resolveTurnMemory`（显式 source 或按会话推断）；`listSessions` 只列英语表；`getSessionDetail` 按表路由；`createSession(memorySource=english_learning)` 双建会话 |
| `dto/agent-chat.dto.ts` | `memorySource`: agent \| assistant \| english_learning \| skill_try |
| `share.service.ts` | `sessionType=agent`：英语表 → 试跑表 → 遗留 `agent_messages` |

### 2.3 前端

| 文件 | 变更 |
|------|------|
| `store/assistant.ts` | Skill：`memorySource=assistant` + `assistantSessionId` |
| `store/englishAgent.ts` | 建会话 `memorySource=english_learning`；SSE 同字段 |
| `store/skillTry.ts` | SSE `memorySource=skill_try` |

### 2.4 M4 收缩含义

- **英语 / 试跑 / 知识库 Skill** 新消息**不再写入** `agent_messages`。
- `AgentMemoryService` 仍保留：仅当无法推断业务归属且未传 `memorySource` 的遗留句柄。
- **未删除** `agent_messages` 表与历史行（可作归档）；正式环境可用 migration 迁数。

---

## 3. 数据流摘要

```
英语：create(english) → SSE(memorySource=english_learning) → english_agent_messages
试跑：skill/session → SSE(memorySource=skill_try) → skill_try_messages
知识库 Skill：assistant 会话 + agent 句柄 → SSE(memorySource=assistant) → assistant_messages
无 Skill 知识库：仍 /assistant/sse → assistant_messages（不动）
```

---

## 4. 回归测试清单（请手测）

### 4.1 知识库

| # | 步骤 | 期望 |
|---|------|------|
| K1 | 无 Skill 多轮 / 历史 / 停流 | 与改前一致 |
| K2 | 有 Skill 多轮续聊 | 有上下文；刷新有消息 |
| K3 | Skill 会话不出现在英语历史列表 | 列表干净 |

### 4.2 英语学习

| # | 步骤 | 期望 |
|---|------|------|
| E1 | 新建会话、多轮、刷新 | 历史完整（`english_agent_*`） |
| E2 | 切历史 / 删会话 / 停流 | 正常 |
| E3 | 分享（若用） | 正文非空 |

### 4.3 Skill 试跑 / 生成

| # | 步骤 | 期望 |
|---|------|------|
| T1 | try / generate 多轮 | 续聊有记忆 |
| T2 | 刷新 / 切历史 | 消息在 |
| T3 | 删 Skill | try 会话与消息级联清理 |
| T4 | 分享（若用） | 正文非空 |

### 4.4 电子书助手

| # | 步骤 | 期望 |
|---|------|------|
| B1 | 阅读页助手 | **零回归** |

---

## 5. 运维注意

1. 本地：重启后端，确认 `english_agent_*` / `skill_try_messages` 表存在（SYNC 或 migration）。  
2. 生产：执行 `1789300000000-agent-business-split` 建表即可，**无需**从 `agent_*` 拷贝历史。  
3. 分表上线前的旧 Agent 会话可忽略；请用**新会话**验证功能。

---

## 6. 已知限制

- 知识库 Skill 的 `assistant_messages` 仍无 `search_organic`（与 M1 相同）。  
- 不迁入、不清理 `agent_messages` 中的历史行（按产品约定忽略旧会话）。
