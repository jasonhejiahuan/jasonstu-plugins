# MetaSo Search Neo Quick Start

本指南面向第一次启动 MetaSo Search Neo 的用户，帮助你安全地配置 MetaSo API Key 并完成首次测试。

## 1. 准备 API Key

从你的 MetaSo 开放平台账户获取 API Key。独立 MCP 可以读取名为 `METASO_API_KEY` 的环境变量；macOS 上的插件内置 MCP 也可以读取下文导入的钥匙串凭据。不要把 Key 写入插件源码、README、Git 仓库、聊天消息或截图。

## 2. 判断 MCP 的安装形式

打开 Codex：

1. 进入 **Settings → Plugins → MCPs**。
2. 找到 `metaso-search-neo`。
3. 根据它所在的区域选择下面对应的方法。

### 方法 A：显示在 “From plugins”（当前默认安装方式）

插件内置 MCP 暂时没有独立的齿轮配置页。不要把 Key 写入 `[shell_environment_policy.set]`：该设置面向 Codex 启动的 agent shell，当前 Codex Desktop 不会可靠地把其中的值转发给插件内置 MCP。

在终端运行仓库提供的导入脚本：

```bash
./scripts/import-metaso-key.command
```

脚本会依次询问：

1. Key 名称：1–48 个 ASCII 字母、数字、点、下划线或连字符，例如 `work`、`personal`。
2. 备注：可选，最多 200 个字符；同时写入 Keychain comment 并由 `--list` 显示。
3. MetaSo API Key：由 macOS Keychain 隐藏询问并要求输入两次；保存后脚本再校验为 `mk-` 加至少 16 个 ASCII 字母或数字，格式错误时立即删除该项目。

Key 保存在 macOS 登录钥匙串，插件 MCP 每次启动时根据当前选择的名称直接读取到内存，不再通过 `launchctl` 注入整个 GUI 登录会话。名称、备注和当前选择是非秘密元数据，保存在 Codex 状态目录。Key 不会写入脚本、`config.toml`、状态文件或终端历史。

这能避免 Key 被配置文件、终端历史和普通日志被动泄露，但不是针对同一 macOS 登录用户下恶意进程的隔离边界：插件通过系统 `/usr/bin/security` 工具读取钥匙串项目，同一用户下可运行该工具并知道服务名和凭据名的进程也可能读取它。

成功后按 `⌘Q` 完全退出 Codex，重新打开并新建任务。钥匙串内容可以跨 Codex 重启、注销和 Mac 重启保留，无需再次导入。

整理、切换、检查或撤销：

```bash
./scripts/import-metaso-key.command --list
./scripts/import-metaso-key.command --use work
./scripts/import-metaso-key.command --status
./scripts/import-metaso-key.command --clear work
```

`--list` 使用 `*` 标记当前选择，使用 `!` 标记元数据存在但钥匙串项目缺失或格式无效。切换后必须完全重启 Codex，新的 MCP 进程才会读取所选 Key。

为避免一次输错就覆盖原有有效凭据，导入脚本不会原地覆盖同名有效 Key。需要轮换时，先用新名称导入并以 `--use` 切换，验证成功后再用 `--clear` 删除旧名称。0.2 仍可读取此前以旧服务命名空间保存且已被选择的同名凭据；清除时会同时处理新旧服务命名空间，但不会再自动启用未命名的旧版 `METASO_API_KEY` 钥匙串项目。

导入成功后，脚本会清除旧版方法留下的 `launchctl` 会话变量。如果你以前把 `METASO_API_KEY` 写入了 `[shell_environment_policy.set]`，也应删除该行，避免在 `config.toml` 中保留无效的明文副本。

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

使用方法 A 时，先运行 `./scripts/import-metaso-key.command --status`。如果未选择、钥匙串项目缺失或格式无效，运行 `--list` 检查，再用 `--use 名称` 切换或重新运行无参数脚本导入；成功后按 `⌘Q` 完全退出 Codex，重新打开并新建任务。不要改用 `[shell_environment_policy.set]`。

### 返回 2005 或 401

MetaSo 拒绝了当前凭据。检查 Key 是否完整、是否已撤销，以及它是否具备对应 API 的访问权限。

### 同时出现两组 MetaSo 工具

不要同时启用插件内置 MCP 和独立 MCP；保留其中一种，避免重复注册相同工具。

### 更换或撤销 Key

方法 A：运行 `./scripts/import-metaso-key.command --clear 名称` 删除指定 Key；省略名称时删除当前选择。轮换 Key 时请导入一个新名称、切换并验证，再清除旧名称；脚本不会覆盖仍然有效的同名 Key。方法 B：在 MCP 设置中替换或删除变量。之后重启 Codex。不要将旧 Key 留在测试脚本、终端历史、日志或截图中。
