# MetaSo Search Neo Quick Start

本指南面向第一次启动 MetaSo Search Neo 的用户，帮助你安全地配置 MetaSo API Key 并完成首次测试。

## 1. 准备 API Key

从你的 MetaSo 开放平台账户获取 API Key。插件只读取名为 `METASO_API_KEY` 的环境变量；不要把 Key 写入插件源码、README、Git 仓库、聊天消息或截图。

## 2. 判断 MCP 的安装形式

打开 Codex：

1. 进入 **Settings → Plugins → MCPs**。
2. 找到 `metaso-search-neo`。
3. 根据它所在的区域选择下面对应的方法。

### 方法 A：显示在 “From plugins”（当前默认安装方式）

插件内置 MCP 暂时没有独立的齿轮配置页。打开 `~/.codex/config.toml`，找到已有的 `[shell_environment_policy.set]`；如果该段不存在，再新建它。加入：

```toml
[shell_environment_policy.set]
METASO_API_KEY = "在这里填写你的 MetaSo API Key"
```

如果 `[shell_environment_policy.set]` 已经存在，只添加 `METASO_API_KEY` 那一行，不要重复创建同名 TOML 表。

限制配置文件权限：

```bash
chmod 600 ~/.codex/config.toml
```

保存后完全退出并重新打开 Codex，然后新建一个任务。

### 方法 B：显示在 “Servers” 且右侧有齿轮

这是独立 MCP 或混合安装方式，可以将变量限定给这个 MCP Server：

1. 点击 `metaso-search-neo` 右侧的齿轮。
2. 在 **Environment variables** 中添加：
   - Key：`METASO_API_KEY`
   - Value：你的 MetaSo API Key
3. 点击 **Save**。
4. 关闭并重新打开 Codex，然后新建一个任务。

不要把 Key 填入 **Environment variable passthrough**。该区域只接收变量名，并要求 Key 已经存在于 Codex 宿主进程的环境中。

## 3. 验证配置

在新任务中输入：

> 使用 MetaSo 搜索“MetaSo Search Neo”，返回三条来源链接。

首次成功的研究调用会在正常结果中附带一次 **前沿研究模式（Research Frontier）** 提示。这表示插件、MCP Server 和 API Key 已正常工作。

## 4. 常见问题

### 提示缺少 `METASO_API_KEY`

确认变量名完全一致、没有多余空格，并且修改后已经彻底重启 Codex。使用方法 A 时，还要确认 TOML 中没有重复的 `[shell_environment_policy.set]` 表。

### 返回 2005 或 401

MetaSo 拒绝了当前凭据。检查 Key 是否完整、是否已撤销，以及它是否具备对应 API 的访问权限。

### 同时出现两组 MetaSo 工具

不要同时启用插件内置 MCP 和独立 MCP；保留其中一种，避免重复注册相同工具。

### 更换或撤销 Key

在原保存位置替换或删除 `METASO_API_KEY`，然后重启 Codex。不要将旧 Key 留在测试脚本、终端历史、日志或截图中。
