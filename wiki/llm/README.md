# 大模型接入

路径前缀：`apps/backend/src/services/`（chat、assistant、agent、settings）。

| 文档 | 说明 |
|------|------|
| [创建LLM.md](./创建LLM.md) | `createLlm` 工厂、preset、排查 400 |
| [会员单用户LLM.md](./会员单用户LLM.md) | **按用户**设置页配置、会员默认硅基 / 非会员 GLM |
| [LLM运行时设置.md](./LLM运行时设置.md) | 设置页持久化、Key 回显、向量 tier 联动（主文档） |
| [硅基对话统一.md](./硅基对话统一.md) | 主对话 / 助手硅基接入总览 |
| [Agent创建LLM统一.md](./Agent创建LLM统一.md) | 英语学习 Agent 接 `createLlm` |
| [OCR创建LLM GLM.md](./OCR创建LLM GLM.md) | **图片 OCR** 接 `createLlm`、智谱 GLM-4.6V-Flash |
| [LLM设置UI预设.md](./LLM设置UI预设.md) | 设置页预设联动、Combobox（Key 行为见 runtime-settings） |
| [LLM设置保存流程.md](./LLM设置保存流程.md) | **保存即启用**、底部四态提示、恢复默认 |
| [知识会员向量分层.md](../knowledge/知识会员向量分层.md) | 会员 Qwen3 向量 + 双 Qdrant 检索 |

知识库向量与 RAG 全链路见 [../knowledge/README.md](../knowledge/README.md)。

上级：[../README.md](../README.md)
