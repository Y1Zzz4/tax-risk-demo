# 税务风控核查智能体（演示版）

这是一个可本机运行的轻量级 MVP，用于演示税务风险核查场景中的大模型辅助能力。当前版本仅接入 DeepSeek 官方 OpenAI 兼容 API，不接入数据库、登录、历史记录、知识库、政策法规库、案例库、规则库、RAG 或复杂 Agent 编排。

## 功能

- 智能解答：输入风险应对或政策理解问题，返回 5 类结构化辅助建议。
- 报告质量复核：上传 `.xlsx`类型文件，系统会读取首个工作表中的 `qksm` 列，选择一条报告正文后调用大模型复核。
- 示例 Excel：`demo_reports.xlsx`，包含 5 条虚构脱敏报告。

## 依赖安装

建议使用 Python 3.10 或更高版本，以下命令用于在linux系统上创建虚拟环境并安装依赖。
若采用其他环境管理方法，只需安装相应依赖即可。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 配置 DeepSeek

在根目录下创建.env文件(/tax-risk-demo/.env)

填写：

```env
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_TIMEOUT_SECONDS=60
```

如果未配置 `DEEPSEEK_API_KEY`，页面可以正常打开，调用智能解答或报告复核时会提示需要配置 API Key。

## 启动

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

浏览器访问：

```text
http://127.0.0.1:8000
```

## 最小测试流程

1. 打开首页，确认标题为“税务风控核查智能体（演示版）”。
2. 访问 `http://127.0.0.1:8000/api/health`，应返回 `{"status":"ok"}`。
3. 在“智能解答”输入一个风险核查问题，点击“开始分析”。
4. 在“报告质量复核”上传 `demo_reports.xlsx`。
5. 选择任意一条报告，展开正文预览，点击“开始复核”。
6. 查看复核结果表格，并点击“复制复核结果”验证剪贴板复制。

## 上传文件格式

- 仅支持 `.xlsx`。
- 读取首个工作表。
- 报告正文列名必须为 `qksm`，匹配时忽略大小写和首尾空格。
- 上传文件不会保存到服务端磁盘；解析结果仅用于当前浏览器会话。
