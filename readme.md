# Koishi 群组验证插件

一个功能完整的 Koishi 群组加群验证插件，支持多关键词匹配审核、多种审核方式和详细统计功能。

**仓库**: https://github.com/LHDyx/koishi-plugin-group-verification  
**问题反馈**: https://github.com/LHDyx/koishi-plugin-group-verification/issues

## 🌟 主要特性

- **多关键词匹配**：支持多个关键词的灵活配置
- **四种审核方式**：全部同意、按数量同意、按比例同意、全部拒绝
- **完善的权限控制**：群主/管理员权限或 Koishi 三级以上权限
- **详细的统计功能**：自动记录审核统计和手动入群统计（含自动通过、手动通过、拒绝以及总入群人数）
- **灵活的消息配置**：支持自定义提醒消息和禁用功能
- **友好的命令系统**：丰富的别名和快捷命令

## 🚀 安装使用

> 本插件已脱离开发阶段，可在 Koishi 插件管理页直接安装并配置。部分提示词可在管理界面自定义。

```
# 在 Koishi 控制台中搜索并安装
koishi-plugin-group-verification
```

## 📋 命令说明

### 主指令别名
- `group-verify` (完整英文名称)
- `gv` (英文快捷别名)
- `gverify` (英文中等长度别名)

### 配置命令
```
# 创建新配置（支持引号和逗号组合）
group-verify.config "关键词1,关键词2",关键词3 -m 1 -t 2
# 别名：gv.cfg gverify.cfg group-verify.cfg gv.配置 gverify.配置 group-verify.配置 gvc

# 修改审核参数
group-verify.config -m 2 -t 60

# 启用自定义提醒消息
group-verify.config -msg "用户 {user} 申请入群，匹配 {answer} 个关键词"

# 禁用提醒消息
group-verify.config -nomsg

# 查询当前配置
group-verify.config -?

# 删除配置
group-verify.config -r

# 指定群号配置
group-verify.config -i 123456789 关键词1,关键词2 -m 1 -t 1

> **提示**:  `-?`（查询）和 `-r`（删除）仍然与所有其它参数 / 关键字互斥，
> 但可以和 `-i` 组合使用，例如 `gvc -i 123 -?` 或 `gvc -i 123 -r`。这样便于在私聊环境下查询或删除指定群的设置。
```

### 审核命令

> **命令增强**
> - 未提供参数时 `gva`/`gvr` 会处理最近一条申请，`all` 可以批量处理。
> - 手动使用 `gva` 时会先在群内返回“已同意用户…的加群申请”等提示，随后再将用户加入群，避免用户看到提示时已在群中的尴尬情形。
> - 如果申请记录缺少 requestId，则无法通过机器人接口处理，会提示管理员请在客户端手动操作。
> - 输出结果会智能展示用户名和ID，避免出现 "12345(12345)" 这样的重复显示。

```
# 同意申请（处理最近一个）
group-verify.approve
# 别名：gv.accept gverify.accept group-verify.accept gv.同意 gverify.同意 group-verify.同意 gva

# 同意指定用户
group-verify.approve 123456789

# 同意所有申请
group-verify.approve all

# 拒绝申请
group-verify.reject 123456789
# 别名：gv.reject gverify.reject group-verify.reject gv.拒绝 gverify.拒绝 group-verify.拒绝 gvr

# 拒绝所有申请
group-verify.reject all
```

### 查询命令
```
# 查看待审核列表
group-verify.pending
# 别名：gv.list gverify.list group-verify.list gv.待审 gverify.待审 group-verify.待审 gvp

# 查看统计信息
group-verify.stats
# 别名：gv.stats gverify.stats group-verify.stats gv.统计 gverify.统计 group-verify.统计 gvs

# 查看指定群统计
group-verify.stats 123456789

# 查看总计统计（需要权限）
group-verify.stats total
```

### 黑名单命令
```
# 添加黑名单条目（可指定原因和群号）
group-verify.blacklist a <用户ID> [原因] [群号]
# 别名：gvb, gv.blacklist, gverify.blacklist, group-verify.blacklist
#      gv.黑名单, gverify.黑名单, group-verify.黑名单

# 删除黑名单条目
group-verify.blacklist r <用户ID> [群号]

# 查看群黑名单
group-verify.blacklist l [群号]
# 传入 all 可查看全局黑名单

# 查询用户在黑名单的状态
group-verify.blacklist i <用户ID> [群号|all]

* 不指定群号时会查询当前群和全局黑名单状态（必须在群聊中使用）。
* 指定单个群号时会查询该群和全局状态，执行此操作需要该群的管理员权限或 Koishi 三级以上权限。
* 输入 `all` 会列出用户在所有群的黑名单条目与全局黑名单（仅限 Koishi `authority>=3`）。
```

### 黑名单消息模板
插件会在配置界面显示当前黑名单存在状态的提示词，用户可以通过修改以下字段自定义这些提示：

- `blacklistLocalExists`：当前群已有黑名单条目时的提示，例如 “本群已设置黑名单”。
- `blacklistGlobalExists`：全局黑名单存在时的提示，例如 “已启用全局黑名单”。

如果将这两个字段留空，则对应的提示不会显示（界面将保持简洁）。

## ⚙️ 参数说明

### 日志级别配置

插件启动时会输出运行状态，并根据 `logLevel` 调整输出量。
- `debug`：打印所有调试细节，包括权限检查、命令解析等。
- `info`：默认值，记录关键事件（插件启动、配置修改、自动拒绝、黑名单踢人等）。
- `warn`：记录可恢复的异常，例如尝试踢出用户失败、数据库操作问题。
- `error`：仅在遇到严重错误时输出。

添加黑名单时会尝试在对应群踢出该用户，成功记为 `info`，失败记为 `warn`。

### 严格群号检查

`enableStrictGroupCheck` 可开启简单群号格式验证（长度 5‑15 位），
影响所有需要群号的命令。


### 审核方式 (-m)

*如果改变审核方式而未提供 `-t`，阈值会自动设置为最大值（方式1为关键词数量，方式2为100）。*
- `0` - 全部同意（默认）
- `1` - 按数量同意（需配合 -t 使用）
- `2` - 按比例同意（需配合 -t 使用）
- `3` - 全部拒绝

### 阈值参数 (-t)
- 方式1（按数量）：需要匹配的关键词数量（1-N）
- 方式2（按比例）：需要达到的百分比（1-100）

### 提醒消息配置

提醒消息里的 `{threshold}` 在“按比例审核”模式下会显示为需要匹配的关键词数量
（而非百分比），例如三条关键词、阈值60%时显示为“1/2”。

- `-msg "消息内容"` - 设置自定义提醒消息
  - 消息内部可包含逗号：只要所有逗号前后都没有空格，它们将被视为同一消息内容。
  - 若逗号之后仍需写关键词，请使用引号包裹整个消息或在逗号后加空格以分隔。
- `-nomsg` - 禁用提醒消息功能
- 不带参数的 `-msg` 会显示帮助信息

### 提醒消息变量

### 其他注意事项

- 统计数据的 **最后更新时间** 使用完整的日期+时间存储，升级到最新版后若看到 `00:00:00`，请手动重建或清除旧的统计记录以便记录最新时间。

### 提醒消息变量
```
{user}    - 用户名
{id}      - 用户ID
{group}   - 群号
{gname}   - 群名称
{question} - 申请理由
{answer}  - 答对数量/比例
{threshold} - 阈值要求
\n        - 换行符（在配置中写成 `\\n`）

默认模板末尾会附加一句 “使用 gva 同意或 gvr 拒绝申请”，表示管理员可以通过快捷命令操作。
```

## 🔐 权限说明

### 配置和审核命令
需要以下任一权限：
- 群主权限
- 管理员权限
- Koishi 三级以上权限

### 统计命令
- 普通统计：任意用户可查看
- 总计统计：需要 Koishi 三级以上权限

## 📊 统计功能

插件会自动记录以下统计信息：
- **自动批准**：通过关键词验证自动入群的用户数（包括自动审批与手动 gva 同意）
- **手动批准**：通过 gva 指令手动同意的用户数
- **拒绝**：被拒绝的申请数（包括自动拒绝与 gvr 指令）
- **总入群人数**：无论通过哪种方式，只要检测到成员加入即增加

> ⚠️ 注意：绕过机器人手动在客户端同意/拒绝的操作不会计入自动批准/拒绝统计，但仍会反映在总入群人数中。
### ⚠️ OneBot/QQ 适配器注意
默认情况下插件会使用 `ctx.broadcast` 发送提醒消息，
为了兼容 OneBot、QQ 等需要同时指定频道和群号的协议，
插件会自动将 `session.channelId` 与 `session.guildId` 一起
传给 `broadcast`。如果你使用的适配器出现无法发送消息的
情况，请确保群号与频道 ID 正确无空格，或者手动在配置
中补充 channelId（目前是自动处理）。
## 🛠️ 开发配置

### 全局配置
在 Koishi 控制台插件配置页面可以设置：
- 默认提醒消息模板
- 日志级别

### 数据库结构
插件使用以下数据表：
- `group_verification_config` - 群组配置表
- `group_verification_stats` - 统计信息表
- `group_verification_pending` - 待审核申请表
- `group_verification_blacklist` - 群组黑名单条目，每行记录一个用户（groupId=all 表示全局）

## 📝 使用示例

### 场景1：学生群验证
```
# 设置学生群验证规则
gvc 学生,校友,老师 -m 1 -t 2 -msg "欢迎 {user} 加入学习群！"
```

### 场景2：企业内部群
```
# 设置严格的验证规则
gvc 员工,实习生,部门 -m 2 -t 100 -nomsg
```

### 场景3：兴趣爱好群
```
# 设置宽松的验证规则
gvc 兴趣,爱好,交流 -m 0 -msg "欢迎 {user} 加入我们的大家庭！"
```

## 🐛 常见问题

### Q: 如何禁用提醒消息？
A: 使用 `gvc -nomsg` 命令禁用提醒功能

### Q: 提醒消息支持哪些变量？
A: 支持 {user}, {id}, {group}, {gname}, {question}, {answer}, {threshold} 等变量

### Q: 如何查看统计信息？
A: 使用 `gvs` 查看当前群统计，`gvs total` 查看总计统计

### Q: 权限不够怎么办？
A: 需要群主/管理员权限或 Koishi 三级以上权限

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！