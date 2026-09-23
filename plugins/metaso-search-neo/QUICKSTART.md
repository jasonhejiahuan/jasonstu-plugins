# MetaSo Search Neo Quick Start

0.3.0 提供本地浏览器连接流程。需要 Node.js 20+；浏览器连接还需要 npm 和可显示浏览器窗口的桌面环境。已在 macOS 验证真实账号登录、直接调用网页接口创建 Key、保存及后续搜索，详细边界见 [认证说明](docs/auth.md)。

## 1. 在聊天中连接

安装或更新插件后，重新启动 Codex 并打开新任务，以加载新工具。在聊天中输入：

> 使用 MetaSo Auth 连接我的 MetaSo 账号，为这个插件创建一个新的 API Key。

插件会打开独立浏览器窗口，进入 [MetaSo API Key 页面](https://metaso.cn/search-api/api-keys)。如果网站跳转到主页，请在该窗口中自行完成登录、验证码或扫码。登录后，程序直接在该浏览器中调用网站自己的 JavaScript 请求，创建指定名称的 Key，或从返回的 JSON 中选择唯一同名 Key，并保存到本地。程序不操作创建表单，也不读取网页表格或输入框中的 Key。你可以指定名称；最多 20 个字符，可包含中文，部分 emoji 按两个字符计数。

首次连接会安装固定版本的 Playwright 浏览器支持，可能需要等待下载。程序优先尝试已有 Chrome 或 Edge；无法启动时下载 Chromium。普通搜索功能不需要浏览器。

连接后可以输入：

> 检查 MetaSo 连接状态。

需要中止时输入：

> 取消当前 MetaSo 连接。

这些操作分别使用 `metaso_auth_start`、`metaso_auth_status`、`metaso_auth_cancel`。Key 不会返回到聊天。不要把 Key、登录密码或验证码发给 Codex。

## 2. 已有 Key 或使用终端

要使用网站上已经存在的 Key，可以告诉 Codex：

> 导入 MetaSo 上名称为“Codex个人”的现有 API Key。

程序只接受唯一且完全匹配的名称；不会重新生成或删除网站上的 Key。若创建提交后连接中断，请先检查网站是否已有该名称，再选择导入，避免重复创建。

终端方式需在插件目录内执行：

```bash
node scripts/auth.mjs
node scripts/auth.mjs --name "Codex个人"
node scripts/auth.mjs --import-existing --name "Codex个人"
node scripts/auth.mjs --status
```

上面前三条是三种可选连接方式，无需依次执行。已有本地凭据时，程序会要求明确替换；需要替换时，在选定的连接命令末尾加 `--replace`。这只替换本地凭据，不会撤销网站上的旧 Key。

如果浏览器环境不可用，可在网站复制 Key，再从剪贴板直接传入标准输入；Key 不出现在命令参数中：

macOS：

```bash
pbpaste | node scripts/auth.mjs --stdin --name "Codex个人"
```

Windows PowerShell：

```powershell
Get-Clipboard -Raw | node scripts/auth.mjs --stdin --name "Codex个人"
```

Linux 和更多说明见 [手动导入](docs/auth.md#manual-import)。完成后清空剪贴板。不要使用把真实 Key 写入命令中的 `echo` 或 `--key` 形式。

## 3. 保存位置与首次验证

默认文件是 `~/.codex/state/metaso-search-neo/credentials/credential.json`；实际路径会出现在连接状态中。它是受当前用户文件权限保护的**明文文件**，不是加密保险库。请不要把该目录放入 Git、插件安装目录或共享/同步文件夹。路径覆盖规则见 [认证说明](docs/auth.md#credential-storage)。

保存成功后，运行中的 MCP 会在下一次调用读取新 Key，无需因为更换这个文件而重启。环境变量 `METASO_API_KEY` 的优先级更高；如果状态提示环境变量覆盖文件，请检查 MCP 的环境配置。

在聊天中执行一次小型验证：

> 使用 MetaSo 搜索“MetaSo Search Neo”，返回三条来源链接。

“已保存”只代表本地配置完成；成功的 API 请求才能确认 Key 当前可用。

## 4. 原有配置与问题处理

已经使用 `METASO_API_KEY` 或 macOS 钥匙串的用户可以继续使用。读取顺序为环境变量 → 插件凭据文件 → 已选择的旧版钥匙串凭据。新连接不会删除或自动迁移钥匙串内容。macOS 的 `./scripts/import-metaso-key.command` 仍是可选的旧版方式。

- **缺少 Key**：重新运行连接或导入，检查 `metaso_auth_status`。
- **401 / 2005**：MetaSo 拒绝了当前 Key；检查是否撤销、是否复制完整，以及环境变量是否覆盖新文件。
- **创建结果不明确**：到网站检查指定名称，再以导入模式恢复；程序不会自动重发创建请求。
- **权限错误**：凭据目录或文件权限不符合要求，程序会停止；不要把权限改为所有人可读。
- **无法打开浏览器**：在有桌面的电脑运行连接命令，或使用标准输入/环境变量配置；远程无桌面主机不能完成可视登录。
- **工具重复出现**：只保留插件内置 MCP 或独立 MCP 中的一种。

插件市场里的 `ON_INSTALL` 不会自动运行这个本地连接程序；请主动调用 MetaSo Auth。也不要依赖 `[shell_environment_policy.set]` 向插件内置 MCP 传递 Key。

自动创建使用 MetaSo 网站内部接口，网站更新后可能需要同步调整；它不是 MetaSo 官方 OAuth 或稳定的公开 Key 管理 API。依据与具体请求见 [认证说明](docs/auth.md#website-request-contract-and-evidence)。
