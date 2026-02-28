import { Context, Schema, Session } from 'koishi'

export const name = 'group-verification'

// 模块级日志器，测试时使用 console
let logger: any = console

// 数据库模型定义
declare module 'koishi' {
  interface Tables {
    group_verification_config: GroupVerificationConfig
    group_verification_stats: GroupVerificationStats
    group_verification_pending: PendingVerification
    group_verification_blacklist: GroupBlacklistEntry
  }
}

// 群组验证配置表
export interface GroupVerificationConfig {
  id: number
  groupId: string
  keywords: string[]
  reviewMethod: 0 | 1 | 2 | 3  // 0:全部同意, 1:按数量同意, 2:按比例同意, 3:全部拒绝
  reviewParameters: number  // 直接存储数字：0表示无阈值，其他表示具体阈值
  reminderEnabled: boolean  // 是否启用提醒消息
  reminderMessage: string
  createdBy: string
  updatedBy: string
  createdAt: string | Date
  updatedAt: string | Date
}

// 群组统计信息表
export interface GroupVerificationStats {
  id: number
  groupId: string
  autoApproved: number
  manuallyApproved: number
  rejected: number
  // 新增：总入群人数（不论方式，只要检测到成员加入则增加）
  totalJoined: number
  lastUpdated: string | Date
}

// 黑名单条目，每一条记录一个用户及可选原因
export interface GroupBlacklistEntry {
  id: number
  groupId: string   // 群号或 "all" 表示全局
  userId: string
  reason?: string
}

// 待审核申请表
export interface PendingVerification {
  id: number
  groupId: string
  userId: string
  userName: string
  requestMessage: string
  // raw OneBot requestId (may be empty string)
  requestId?: string
  applyTime: string | Date
}

export interface Config {
  defaultReminderMessage?: string
  enableStrictGroupCheck?: boolean  // 群号合法性检查配置
  logLevel?: 'debug' | 'info' | 'warn' | 'error'  // 日志等级配置
  // 以下为可自定义的命令反馈提示词，可在插件管理界面调整
  permissionDeniedMessage?: string
  invalidGroupMessage?: string
  parameterConflictMessage?: string
  noKeywordsMessage?: string
}

export const Config: Schema<Config> = Schema.object({
  defaultReminderMessage: Schema.string()
    .description('默认提醒消息模板（使用 \\n 表示换行，可包含下方变量）')
    .default('{user}({id}) 申请加入群 {gname}({group})\n申请理由：{question}\n匹配情况：{answer}/{threshold}\n使用 gva 同意或 gvr 拒绝申请'),
  enableStrictGroupCheck: Schema.boolean().description('是否启用严格的群号检查（检查群号长度）').default(false),
  logLevel: Schema.union(['debug', 'info', 'warn', 'error']).description('日志级别').default('info'),
  permissionDeniedMessage: Schema.string().description('权限不足时返回给调用者的提示').default('权限不足：需要群主/管理员权限或koishi三级以上权限'),
  invalidGroupMessage: Schema.string().description('无效群号或机器人未在该群时的提示').default('群号 {group} 格式不合法或机器人不在该群中'),
  parameterConflictMessage: Schema.string().description('参数冲突时提示').default('参数冲突：-? 或 -r 不能与其他参数或关键词一起使用（仅可搭配 -i）'),
  noKeywordsMessage: Schema.string().description('未提供关键词且无法从现有配置继承时的提示').default('请先提供关键词创建配置，或使用 -? 查询配置，-r 删除配置'),
})
  .description('群组验证插件配置')

export const inject = ['database']

// ---- 辅助解析函数 ----
/**
 * 将输入字符串按照空格和逗号分隔，支持双引号包裹以保留空格/逗号。
 * 返回解码后的令牌数组。
 */
export interface TokenizeResult {
  tokens: string[];
  seps: string[]; // separator that preceded each token: ' ' or ',' or '' (start)
  error?: string;
}

// Sentinel characters used internally to distinguish escaped quotes/backslashes
const ESC_QUOTE = '\u0000';
const ESC_BACKSLASH = '\u0001';

export function tokenize(input: string): TokenizeResult {
  const tokens: string[] = [];
  const seps: string[] = [];
  let cur = '';
  let lastSep = ''; // separator before current token
  let i = 0;

  const flush = () => {
    if (cur !== '') {
      tokens.push(cur);
      seps.push(lastSep);
      cur = '';
      lastSep = '';
    }
  };

  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === ',') {
      // record separator for next token
      lastSep = ch;
      flush();
      i++;
      continue;
    }
    if (ch === '"') {
      const prev = i > 0 ? input[i - 1] : '';
      if (i === 0 || prev === ' ' || prev === ',') {
        // 开始引用
        i++;
        let content = '';
        let closed = false;
        while (i < input.length) {
          const c = input[i];
          if (c === '\\') {
            if (i + 1 < input.length) {
              const nxt = input[i + 1];
              if (nxt === '"') {
                content += ESC_QUOTE;
                i += 2;
                continue;
              }
              if (nxt === '\\') {
                content += ESC_BACKSLASH;
                i += 2;
                continue;
              }
            }
            content += '\\';
            i++;
          } else if (c === '"') {
            closed = true;
            i++;
            break;
          } else {
            content += c;
            i++;
          }
        }
        if (!closed) {
          return { tokens, seps, error: '引号未闭合' };
        }
        tokens.push(content);
        continue;
      } else {
        // 引号当做普通字符
        cur += ch;
        i++;
        continue;
      }
    }
    if (ch === '\\') {
      if (i + 1 < input.length) {
        const nxt = input[i + 1];
        if (nxt === '"') {
          cur += ESC_QUOTE;
          i += 2;
          continue;
        }
        if (nxt === '\\') {
          cur += ESC_BACKSLASH;
          i += 2;
          continue;
        }
      }
      cur += ch;
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  flush();
  return { tokens, seps };
}

export interface ParsedArgs {
  keywords: string[];
  flags: {
    groupId?: string;
    method?: string;
    threshold?: string;
    message?: string;
    enableMessage?: boolean;
    disableMessage?: boolean;
    query?: boolean;
    remove?: boolean;
  };
  error?: string;
}

/**
 * 验证关键词格式：仅允许用逗号和引号分隔，禁止纯空格分隔
 */
// helper used during parsing
function validateKeywordFormat(raw: string): boolean {
  if (raw.includes(',') || raw.includes('"')) {
    return true;
  }
  if (raw.includes(' ')) {
    return false;
  }
  return true;
}

/**
 * 合并提醒消息设置
 *
 * existingConfig - 数据库中已存在的配置记录（可能为 null）
 * cleanedOptions - 从 flags/options 合并出来的对象，包含 message/enableMessage/disableMessage
 * hasRealMessageParam - 是否由用户通过 -msg 指定了具体内容
 * hasRealEnableMessageParam - 是否仅给了 bare -msg
 * hasRealDisableMessageParam - 是否给了 -nomsg
 * logger - 用于记录调试信息的日志器
 *
 * 返回最终的 reminderEnabled 和 reminderMessage。
 * 对于 -nomsg 不会清除已保存的 message，便于后续再次启用时恢复。
 */
export function usageString(): string {
  return `用法：
# 创建/修改配置
  gvc 关键词1,关键词2 -m 1 -t 2    # 创建配置
  gvc -m 1 -t 2                    # 修改审核参数

# 提醒消息控制（可用变量详见下方）
  gvc -msg "消息内容"              # 修改提醒消息
  gvc -nomsg                       # 禁用提醒消息
  # 查询/删除
  gvc -?                          # 查询配置
  gvc -r                          # 删除配置

  审核方式说明（使用 -m 参数）：
    0 全部同意（默认）
    1 按数量同意，需要 -t 指定数量
    2 按比例同意，需要 -t 指定百分比
    3 全部拒绝（拒绝后系统会自动阻止任何通过）

  提醒消息可用变量：{user} 用户名  {id} 用户ID
    {group} 群号  {gname} 群名称
    {question} 申请理由  {answer} 匹配情况  {threshold} 阈值
    使用 \\n   换行`;
}

export function mergeReminder(
  existingConfig: any | null,
  cleanedOptions: {
    message?: string;
    enableMessage?: boolean;
    disableMessage?: boolean;
  },
  hasRealMessageParam: boolean,
  hasRealEnableMessageParam: boolean,
  hasRealDisableMessageParam: boolean,
  logger: any,
  defaultMessage?: string
) {
  let reminderEnabled = true;
  // 优先使用传入的默认模板，其次使用已有配置，再 fallback 到老写死的样式
  let reminderMessage = defaultMessage || '{user}({id}) 申请加入群 {gname}({group})\n申请理由：{question}\n匹配情况：{answer}/{threshold}';

  if (existingConfig) {
    reminderEnabled = existingConfig.reminderEnabled;
    // 保留原 message，而不是空字符串
    reminderMessage = existingConfig.reminderMessage || reminderMessage;
  }

  // 优先级：disable > bare enable > new message content
  if (hasRealDisableMessageParam) {
    reminderEnabled = false;
    logger.debug('禁用提醒消息功能 (保留现有内容)');
  } else if (hasRealEnableMessageParam) {
    reminderEnabled = true;
    logger.debug(`启用提醒消息（保留原消息）: ${reminderMessage.substring(0, 50)}...`);
  } else if (hasRealMessageParam) {
    reminderEnabled = true;
    if (cleanedOptions.message !== undefined) {
      reminderMessage = cleanedOptions.message.replace(/\\n/g, '\n');
      logger.debug(`设置自定义提醒消息: ${reminderMessage.substring(0, 50)}...`);
    }
  }
  return { reminderEnabled, reminderMessage };
}

/**
 * 解析 gvc 配置命令的原始参数。
 *
 * 返回关键词数组和各类 flag 的值，未出现的 flag 保持 undefined。
 * 若检测到格式错误（如纯空格分隔关键词），返回 error 字段。
 */
// 全局缓存：记录通过机器人自动批准的用户，供 guild-member-added 事件使用
const autoQueue = new Map<string, Set<string>>();

// 更新统计信息函数，提取到模块层供多个位置调用
// synchronize overall statistics across groups
export async function syncTotalStats(ctx: Context) {
  try {
    // 获取所有群组统计（排除TOTAL行）
    const allStats = await ctx.database.get('group_verification_stats', {
      groupId: { $ne: 'TOTAL' }
    })
    
    if (allStats.length > 0) {
      // 计算总计
      const totalAutoApproved = allStats.reduce((sum, stat) => sum + (stat.autoApproved || 0), 0)
      const totalManuallyApproved = allStats.reduce((sum, stat) => sum + (stat.manuallyApproved || 0), 0)
      const totalRejected = allStats.reduce((sum, stat) => sum + (stat.rejected || 0), 0)
      const totalJoined = allStats.reduce((sum, stat) => sum + (stat.totalJoined || 0), 0)
      
      // 更新总计行
      await ctx.database.set('group_verification_stats', { groupId: 'TOTAL' }, {
        autoApproved: totalAutoApproved,
        manuallyApproved: totalManuallyApproved,
        rejected: totalRejected,
        totalJoined,
        lastUpdated: new Date().toISOString()
      })
      
      logger.debug(`总计统计已同步: 自动批准${totalAutoApproved}, 手动批准${totalManuallyApproved}, 拒绝${totalRejected}, 入群${totalJoined}`)
    }
  } catch (error) {
    logger.error('同步总计统计时出错:', error)
  }
}

export async function updateStats(ctx: Context, groupId: string, action: 'autoApproved' | 'manuallyApproved' | 'rejected') {
  // 更新群组统计
  const existingStats = await ctx.database.get('group_verification_stats', { groupId })
  
  if (existingStats.length > 0) {
    const stats = existingStats[0]
    await ctx.database.set('group_verification_stats', { id: stats.id }, {
      [action]: stats[action] + 1,
      lastUpdated: new Date().toISOString()
    })
  } else {
    await ctx.database.create('group_verification_stats', {
      groupId,
      autoApproved: action === 'autoApproved' ? 1 : 0,
      manuallyApproved: action === 'manuallyApproved' ? 1 : 0,
      rejected: action === 'rejected' ? 1 : 0,
      totalJoined: 0,
      lastUpdated: new Date().toISOString()
    })
  }
  
  // 同步更新总计统计
  await syncTotalStats(ctx)
}

// 提取成独立函数：增加总入群计数，供事件统一调用
export async function incrementTotal(ctx: Context, groupId: string) {
  const existingStats = await ctx.database.get('group_verification_stats', { groupId })
  if (existingStats.length > 0) {
    const stats = existingStats[0]
    await ctx.database.set('group_verification_stats', { id: stats.id }, {
      totalJoined: (stats.totalJoined || 0) + 1,
      lastUpdated: new Date().toISOString()
    })
  } else {
    await ctx.database.create('group_verification_stats', {
      groupId,
      autoApproved: 0,
      manuallyApproved: 0,
      rejected: 0,
      totalJoined: 1,
      lastUpdated: new Date().toISOString()
    })
  }
  await syncTotalStats(ctx)
}

// helper to decide reviewParameters based on existing configuration, keyword list, user inputs,
// and whether the audit method has been changed by the command.
export interface ThresholdResult {
  reviewParameters: number
  error?: string
  autoInfo?: 'methodChange' | 'kwChange'
}

export function resolveThreshold(
  existingConfig: any | null,
  keywordList: string[],
  reviewMethod: 0 | 1 | 2 | 3,
  thresholdStr?: string,
  methodChanged: boolean = false
): ThresholdResult {
  let reviewParameters = 0
  if (existingConfig) {
    reviewParameters = existingConfig.reviewParameters || 0
    if (isNaN(reviewParameters)) reviewParameters = 0
  }
  // explicit threshold provided by user
  if (thresholdStr !== undefined) {
    const thresholdNum = parseInt(thresholdStr)
    if (isNaN(thresholdNum)) {
      return { reviewParameters, error: '阈值参数必须为数字' }
    }
    if (reviewMethod === 1) {
      if (thresholdNum < 0 || thresholdNum > keywordList.length) {
        return { reviewParameters, error: `数量阈值必须在0-${keywordList.length}之间（0表示全部同意）` }
      }
    } else if (reviewMethod === 2) {
      if (thresholdNum < 0 || thresholdNum > 100) {
        return { reviewParameters, error: '比例阈值必须在0-100之间（0表示全部同意）' }
      }
    }
    return { reviewParameters: thresholdNum }
  }
  // no threshold specified by user
  if (methodChanged) {
    if (reviewMethod === 1) {
      reviewParameters = keywordList.length
      return { reviewParameters, autoInfo: 'methodChange' }
    }
    if (reviewMethod === 2) {
      reviewParameters = 100
      return { reviewParameters, autoInfo: 'methodChange' }
    }
  }
  if (existingConfig && reviewMethod === 1 && reviewParameters !== 0) {
    const oldKeywordCount = existingConfig.keywords.length
    const newKeywordCount = keywordList.length
    if (oldKeywordCount !== newKeywordCount) {
      reviewParameters = newKeywordCount
      return { reviewParameters, autoInfo: 'kwChange' }
    }
  }
  return { reviewParameters }
}

// 权限检查函数（也可用于命令）
export async function checkPermission(session: any, targetGroupId?: string): Promise<[boolean, string?]> {
  const groupId = targetGroupId || session.guildId
  
  // 私聊情况下必须指定群号
  if (!groupId) {
    return [false, '请在群聊中使用此命令或使用 -i 参数指定群号']
  }
  
  logger.debug(`权限检查 - 用户ID: ${session.userId}, 群号: ${groupId}`)
  const koishiAuthority = session.author?.authority || session.user?.authority
  logger.debug(`权限检查 - Koishi权限等级: ${koishiAuthority || '未获取到'}`)
  
  if (!session.author) {
    logger.debug(`权限检查 - session中可能的权限字段:`, {
      authority: session.authority,
      permission: session.permission,
      role: session.role
    })
  } else {
    logger.debug(`权限检查 - author对象中的字段:`, {
      permission: session.author.permission,
      role: session.author.role,
      permissions: session.author.permissions
    })
  }
  
  if (session.user) {
    logger.debug(`权限检查 - user对象中的权限信息:`, {
      authority: session.user.authority,
      permission: session.user.permission,
      role: session.user.role
    })
  }
  
  if (koishiAuthority && koishiAuthority >= 3) {
    logger.info(`权限检查 - 通过koishi权限检查: ${koishiAuthority}`)
    return [true]
  }
  
  try {
    const member = await session.bot.getGuildMember(groupId, session.userId)
    logger.info(`权限检查 - 获取到成员信息:`, {
      roles: member?.roles,
      permissions: member?.permissions
    })
    if (member) {
      if (member.permissions?.includes('OWNER') || member.roles?.includes('owner')) {
        logger.info(`权限检查 - 用户是群主`)
        return [true]
      }
      if (member.roles?.includes('admin') || member.permissions?.includes('ADMINISTRATOR')) {
        logger.info(`权限检查 - 用户是管理员`)
        return [true]
      }
    }
  } catch (e) {
    logger.warn('权限检查获取成员信息失败', e)
  }
  
  return [false, '权限不足']
}

// 提供给测试的辅助函数：处理 guild-member-request 事件的逻辑
export async function handleGuildMemberRequestEvent(ctx: Context, session: any) {
  logger.debug('guild-member-request event', session)
  let guildId = (session.guildId || session.channelId || '').toString().trim();
  const userId = session.userId;
  const message = session.content || '';

  if (!guildId) {
    logger.warn('guild-member-request 没有 guildId，跳过处理');
    return;
  }

  const requestId = ((session.event as any)?.requestId) || session.messageId || '';
  const groupConfig = await ctx.database.get('group_verification_config', { groupId: guildId });
  if (!groupConfig || groupConfig.length === 0) return;
  const config = groupConfig[0];

  if (config.reviewMethod === 3) {
    logger.info(`配置要求全部拒绝，自动拒绝用户 ${userId}`);
    if (requestId) {
      try { await session.bot.handleGuildMemberRequest(requestId, false); } catch (e) { logger.warn('自动拒绝失败', e); }
    }
    await updateStats(ctx, guildId, 'rejected');
    return;
  }

  // 黑名单优先检查（仅在非全拒模式下）
  try {
    const blacklisted = await isUserBlacklisted(ctx, guildId, userId);
    if (blacklisted) {
      logger.info(`用户 ${userId} 在群 ${guildId} 或全局黑名单中，自动拒绝申请`);
      if (requestId) {
        try { await session.bot.handleGuildMemberRequest(requestId, false); } catch (e) { logger.warn('自动拒绝失败', e); }
      }
      await updateStats(ctx, guildId, 'rejected');
      return;
    }
  } catch (e) {
    logger.warn('黑名单检查失败', e);
  }

  const { isValid, matchedCount, requiredThreshold } = await verifyApplication(config, message, session);
  logger.debug(`验证结果 guild=${guildId} user=${userId} msg="${message}" matched=${matchedCount} threshold=${requiredThreshold} valid=${isValid}`);

  if (isValid) {
    if (requestId) {
      try {
        await session.bot.handleGuildMemberRequest(requestId, true);
        logger.debug(`自动同意 requestId=${requestId}`);
        if (!autoQueue.has(guildId)) autoQueue.set(guildId, new Set());
        autoQueue.get(guildId)!.add(userId);
      } catch (e) {
        logger.warn('自动同意失败', e);
      }
    }
  } else {
    await handleFailedVerification(ctx, session, config, matchedCount, requiredThreshold);
  }
}

// 供测试读取当前 autoQueue 状态
export function __getAutoQueue() {
  return autoQueue;
}

export function parseConfigArgs(raw: string): ParsedArgs {
  const res = tokenize(raw);
  if (res.error) {
    return { keywords: [], flags: {}, error: res.error };
  }
  let tokens = res.tokens;
  const seps = res.seps;
  const flags: ParsedArgs['flags'] = {};
  const keywords: string[] = [];
  let error: string | undefined;

  const isFlag = (tok: string) => /^-(?:i|m|t|msg|nomsg|\?|r)$/.test(tok);

  // catch unescaped stray quotes before we unescape the sentinel symbols
  for (const tok of tokens) {
    if (tok.includes('"')) {
      error = '存在未转义的引号';
      return { keywords: [], flags, error };
    }
  }

  // unescape sentinel placeholders back to real characters
  tokens = tokens.map(t =>
    t.replace(new RegExp(ESC_QUOTE, 'g'), '"').replace(new RegExp(ESC_BACKSLASH, 'g'), '\\')
  );

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '-i') {
      if (tokens[i + 1] && !isFlag(tokens[i + 1])) {
        flags.groupId = tokens[++i];
      } else {
        return { keywords: [], flags, error: '参数 -i 需要指定群号' };
      }
    } else if (tok === '-m') {
      if (tokens[i + 1] && !isFlag(tokens[i + 1])) {
        flags.method = tokens[++i];
      } else {
        return { keywords: [], flags, error: '参数 -m 需要指定审核方式' };
      }
    } else if (tok === '-t') {
      if (tokens[i + 1] && !isFlag(tokens[i + 1])) {
        flags.threshold = tokens[++i];
      } else {
        return { keywords: [], flags, error: '参数 -t 需要指定阈值' };
      }
    } else if (tok === '-msg') {
      // gather all tokens after -msg up to next flag
      const clusters: string[][] = [];
      let j = i + 1;
      while (j < tokens.length && !isFlag(tokens[j])) {
        // start a new comma-cluster
        const cluster: string[] = [tokens[j]];
        while (j < tokens.length - 1 && seps[j] === ',') {
          j++;
          cluster.push(tokens[j]);
        }
        clusters.push(cluster);
        j++;
      }
      // advance outer index to skip consumed tokens
      i = j - 1;

      if (clusters.length === 0) {
        flags.enableMessage = true;
      } else {
        // first cluster is always message
        const msgCluster = clusters[0];
        flags.message = msgCluster.join(',');
        // remaining clusters become keywords if any
        if (clusters.length > 1) {
          // flatten subsequent clusters into keywords and push back into main loop
          for (let k = 1; k < clusters.length; k++) {
            const kws = clusters[k];
            // create artificial tokens for these keywords; they will be
            // appended by the outer `else keywords.push(tok)` section
            for (const kw of kws) {
              keywords.push(kw);
            }
          }
        }
      }
    } else if (tok === '-nomsg') {
      flags.disableMessage = true;
    } else if (tok === '-?') {
      flags.query = true;
    } else if (tok === '-r') {
      flags.remove = true;
    } else {
      keywords.push(tok);
    }
  }

  // remove everything from the first flag onward, including when flag sits at start
  const keywordSection = raw.split(/(?:^|\s+)-(?:i|m|t|msg|nomsg|\?|r)\b/)[0].trim();
  if (keywordSection && !validateKeywordFormat(keywordSection)) {
    error = '关键词应使用逗号分隔或引号框起（如：k1,k2,k3 或 "k1","k2" 或 "k1,k2",k3）';
  }

  return { keywords, flags, error };
}

// 验证申请（提取到外层，供测试调用）
export async function verifyApplication(config: GroupVerificationConfig, message: string, session: any): Promise<{isValid: boolean, matchedCount: number, requiredThreshold: string}> {
  // 统计匹配的关键词数量（允许相互重叠）
  const lowered = message.toLowerCase()
  const matched = new Set<string>()
  for (const keyword of config.keywords) {
    if (lowered.includes(keyword.toLowerCase())) {
      matched.add(keyword)
    }
  }
  const matchedCount = matched.size

  let isValid = false
  let requiredThreshold = ''

  switch (config.reviewMethod) {
    case 0: // 全部同意
      isValid = true
      requiredThreshold = 'null'
      break
    case 1: // 按数量同意
      {
        // threshold may legitimately be 0 (表示全部同意)
        const thresholdNum = config.reviewParameters !== undefined && config.reviewParameters !== null
          ? config.reviewParameters
          : 0
        isValid = matchedCount >= thresholdNum
        requiredThreshold = `${thresholdNum}`
      }
      break
    case 2: // 按比例同意
      {
        const thresholdPct = config.reviewParameters !== undefined && config.reviewParameters !== null
          ? config.reviewParameters
          : 100
        const ratio = matchedCount / config.keywords.length
        isValid = ratio >= thresholdPct / 100
        // 显示阈值为需要匹配的关键词数量，避免 "1/60%" 之类混淆
        const needed = Math.ceil(config.keywords.length * thresholdPct / 100)
        requiredThreshold = `${needed}`
      }
      break
    case 3: // 全部拒绝
      isValid = false
      requiredThreshold = 'null'
      break
    default:
      isValid = false
      requiredThreshold = 'null'
  }

  logger.debug(`verifyApplication msg="${message}" keywords=${JSON.stringify(config.keywords)} matched=${matchedCount} threshold=${requiredThreshold} valid=${isValid}`)
  return { isValid, matchedCount, requiredThreshold }
}

// 处理验证失败的情况并发送提醒消息（可由 tests 调用）
export async function handleFailedVerification(
  ctx: Context,
  session: any,
  config: GroupVerificationConfig,
  matchedCount?: number,
  requiredThreshold?: string
) {
  const guildId = (session.guildId || session.channelId || '').toString().trim();
  const userId = session.userId
  // 如果没有可用的群号，直接退出（防止错误插入数据库）
  if (!guildId) {
    logger.warn('handleFailedVerification invoked without guildId, aborting')
    return
  }
  const username = session.username || '未知用户'
  const message = session.content || ''
  logger.debug(`处理失败验证 guild=${guildId} user=${userId} msg="${message}" matched=${matchedCount} threshold=${requiredThreshold}`)
  // 如果未传入匹配信息，则重新计算一次（老调用）
  if (matchedCount === undefined || requiredThreshold === undefined) {
    const result = await verifyApplication(config, message, session)
    matchedCount = result.matchedCount
    requiredThreshold = result.requiredThreshold
  }

  // 获取群信息
  let groupName = '未知群组'
  try {
    const guild = await session.bot.getGuild(guildId)
    groupName = guild.name || groupName
  } catch (error) {
    // 无法获取群名称时使用默认值
  }

  // extract requestId if available (OneBot event attaches it)
  const requestId = ((session.event as any)?.requestId) || session.messageId || ''

  // 删除同一用户在该群之前的所有待审核记录，保留最新一个
  await ctx.database.remove('group_verification_pending', { groupId: guildId, userId })

  // 将申请加入待审核列表
  await ctx.database.create('group_verification_pending', {
    groupId: guildId,
    userId: userId,
    userName: username,
    requestMessage: message,
    requestId,
    applyTime: new Date().toISOString()
  })
  // 如果提醒消息被禁用，直接返回
  if (!config.reminderEnabled || !config.reminderMessage || config.reminderMessage === '') {
    logger.debug(`群 ${guildId} 的提醒消息已被禁用，跳过发送`)
    return
  }

  // 替换提醒消息中的变量
  let reminderMsg = config.reminderMessage
  reminderMsg = reminderMsg
    .replace(/{user}/g, username)
    .replace(/{id}/g, userId)
    .replace(/{group}/g, guildId)
    .replace(/{gname}/g, groupName)
    .replace(/{question}/g, message)
    .replace(/{answer}/g, matchedCount!.toString())
    .replace(/{threshold}/g, requiredThreshold!)

  // 发送提醒消息到群内
  // OneBot 等适配器需要同时指定 channelId 与 guildId，否则会无法定位到具体频道
  // ctx.broadcast 接收的元素可以是字符串、[channel, guild] 或者 session
  const rawChannel = (session.channelId || '').toString().trim()
  const channel = rawChannel || guildId
  const target: string | [string, string] = rawChannel ? [channel, guildId] : guildId
  logger.debug('broadcast target', { channel, guildId, target })
  // prefer using bot.broadcast since ctx.broadcast may not support tuple
  if (session.bot && typeof session.bot.broadcast === 'function') {
    try {
      await session.bot.broadcast([target], reminderMsg as any)
    } catch (err) {
      // fallback to ctx.broadcast if bot.broadcast fails for some reason
      logger.warn('bot.broadcast failed, fallback to ctx.broadcast', err)
      if (typeof (ctx.broadcast) === 'function') {
        await (ctx.broadcast as any)([target], reminderMsg)
      } else {
        logger.info('ctx.broadcast 不可用，跳过发送')
      }
    }
  } else {
    if (typeof (ctx.broadcast) === 'function') {
      await (ctx.broadcast as any)([target], reminderMsg)
    } else {
      logger.info('ctx.broadcast 不可用，跳过发送')
    }
  }
}

// 黑名单相关辅助函数 ----------------------------------------------------------

// 检查指定用户是否在黑名单（群级或全局）中
export async function isUserBlacklisted(ctx: Context, groupId: string, userId: string): Promise<boolean> {
  // 全局黑名单
  const globalRows = await ctx.database.get('group_verification_blacklist', { groupId: 'all', userId })
  if (globalRows.length > 0) return true
  // 群级黑名单
  const groupRows = await ctx.database.get('group_verification_blacklist', { groupId, userId })
  return groupRows.length > 0
}

// 解析并执行黑名单管理命令，返回要回复的字符串
export async function processBlacklistCommand(ctx: Context, session: any, rawArgs: string): Promise<string> {
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean)
  const op = parts[0]?.toLowerCase()
  if (!op || !['a','r','l','i'].includes(op)) {
    return '用法：gvb a <id> [reason] [group] | gvb r <id> [group] | gvb l [group] | gvb i <id>'
  }

  const getCurrentGroup = () => session.guildId || ''
  let group: string | undefined
  let targetUser: string | undefined
  let reason = ''

  if (op === 'a') {
    targetUser = parts[1]
    if (!targetUser) return '请提供用户ID'
    // handle optional reason and group at end
    const rest = parts.slice(2)
    if (rest.length > 0) {
      const last = rest[rest.length - 1]
      if (/^\d+$/.test(last) || last.toLowerCase() === 'all') {
        group = last
        reason = rest.slice(0, -1).join(' ')
      } else {
        reason = rest.join(' ')
      }
    }
    group = group || getCurrentGroup()
    if (!group) return '请在群聊中使用此命令或指定群号'
    // 权限检查
    if (group.toLowerCase() === 'all') {
      const auth = session.author?.authority || session.user?.authority
      if (!(auth && auth >= 3)) return '设置全局黑名单需要 koishi 3 级以上权限'
    } else {
      const [ok, err] = await checkPermission(session, group)
      if (!ok) return err || '权限不足'
    }
    // add entry
    await ctx.database.remove('group_verification_blacklist', { groupId: group, userId: targetUser })
    await ctx.database.create('group_verification_blacklist', { groupId: group, userId: targetUser, reason })
    return `已将用户 ${targetUser} 加入群 ${group} 黑名单${reason ? `，原因：${reason}` : ''}`
  }
  if (op === 'r') {
    targetUser = parts[1]
    if (!targetUser) return '请提供用户ID'
    group = parts[2] || getCurrentGroup()
    if (!group) return '请在群聊中使用此命令或指定群号'
    if (group.toLowerCase() === 'all') {
      const auth = session.author?.authority || session.user?.authority
      if (!(auth && auth >= 3)) return '修改全局黑名单需要 koishi 3 级以上权限'
    } else {
      const [ok, err] = await checkPermission(session, group)
      if (!ok) return err || '权限不足'
    }
    await ctx.database.remove('group_verification_blacklist', { groupId: group, userId: targetUser })
    return `已从群 ${group} 的黑名单中移除用户 ${targetUser}`
  }
  if (op === 'l') {
    group = parts[1] || getCurrentGroup()
    if (!group) return '请在群聊中使用此命令或指定群号'
    if (group.toLowerCase() === 'all') {
      const auth = session.author?.authority || session.user?.authority
      if (!(auth && auth >= 3)) return '查看全局黑名单需要 koishi 3 级以上权限'
    } else {
      const [ok, err] = await checkPermission(session, group)
      if (!ok) return err || '权限不足'
    }
    const rows = await ctx.database.get('group_verification_blacklist', { groupId: group })
    if (rows.length === 0) {
      return `群 ${group} 的黑名单为空`
    }
    let msg = `群 ${group} 黑名单：\n`
    rows.forEach(r => { msg += `${r.userId}${r.reason ? `：${r.reason}` : ''}\n` })
    return msg
  }
  if (op === 'i') {
    targetUser = parts[1]
    if (!targetUser) return '请提供用户ID'
    const groupId = getCurrentGroup()
    if (!groupId) return '请在群聊中使用此命令'
    const [ok, err] = await checkPermission(session, groupId)
    if (!ok) return err || '权限不足'
    const globalRows = await ctx.database.get('group_verification_blacklist', { groupId: 'all', userId: targetUser })
    const groupRows = await ctx.database.get('group_verification_blacklist', { groupId: groupId, userId: targetUser })
    let msg = `全局黑名单: ${globalRows.length ? '有' : '无'}\n`
    msg += `本群黑名单: ${groupRows.length ? '有' : '无'}`
    return msg
  }
  return ''
}

export function apply(ctx: Context, config: Config) {
  // 创建数据库表
  ctx.model.extend('group_verification_config', {
    id: 'unsigned',
    groupId: 'string',
    keywords: 'list',
    reviewMethod: 'integer',
    reviewParameters: 'integer',  // 直接存储数字
    reminderEnabled: 'boolean',
    reminderMessage: 'string',
    createdBy: 'string',
    updatedBy: 'string',
    createdAt: 'string',
    updatedAt: 'string'
  }, {
    primary: 'id',
    autoInc: true
  })

  // 获取logger实例并保存到模块级变量
  logger = ctx.logger('group-verification')
  // 根据配置调整日志等级
  if (config.logLevel) logger.level = config.logLevel
  
  // 设置日志级别
  // 注意：Koishi logger的level设置可能需要不同的方式
  
  // 记录插件启动信息
  logger.info('群组验证插件已启动')
  logger.info(`默认提醒消息: ${config.defaultReminderMessage}`)
  logger.info(`严格群号检查: ${config.enableStrictGroupCheck ? '启用' : '禁用'}`)
  logger.info(`日志级别: ${config.logLevel}`)

  ctx.model.extend('group_verification_stats', {
    id: 'unsigned',
    groupId: 'string',
    autoApproved: 'integer',
    manuallyApproved: 'integer',
    rejected: 'integer',
    totalJoined: 'integer',
    // store as string (ISO timestamp) to preserve full date+time;
    // Koishi `date` type truncates to day which leads to 00:00:00.
    lastUpdated: 'string'
  }, {
    primary: 'id',
    autoInc: true
  })

  // cast schema to any to avoid type conflicts when adding new fields
  ctx.model.extend('group_verification_pending', {
    id: 'unsigned',
    groupId: 'string',
    userId: 'string',
    userName: 'string',
    requestMessage: 'string',
    // store the raw requestId if provided by OneBot event; used for approving/rejecting
    requestId: 'string',
    // record full timestamp as string to keep time component
    applyTime: 'string'
  } as any, {
    primary: 'id',
    autoInc: true
  })

  // 黑名单表：每条记录对应一个用户，可查群级或全局(all)
  ctx.model.extend('group_verification_blacklist', {
    id: 'unsigned',
    groupId: 'string',
    userId: 'string',
    reason: 'string'
  } as any, {
    primary: 'id',
    autoInc: true
  })



  // 监听 guild-member-request 事件，以便对新申请执行自动审批或拒绝
  ctx.on('guild-member-request', async (session) => {
    logger.info('收到 guild-member-request 事件，转发给处理函数')
    await handleGuildMemberRequestEvent(ctx, session)
  })

  // 监听群成员增加事件（包括手动邀请入群）
  ctx.on('guild-member-added', async (session) => {
    const groupId = session.guildId
    const userId = session.userId

    // 无论什么情况只要检测到加入就累加总入群
    await incrementTotal(ctx, groupId)

    // 先检查 autoQueue
    const set = autoQueue.get(groupId)
    if (set && set.has(userId)) {
      await updateStats(ctx, groupId, 'autoApproved')
      set.delete(userId)
      logger.info(`用户 ${userId} 通过机器人审批加入群 ${groupId}（autoQueue），统计已更新`)
      return
    }

    // 检查是否有待审核记录
    const pendingRecords = await ctx.database.get('group_verification_pending', {
      groupId: groupId,
      userId: userId
    })

    if (pendingRecords.length > 0) {
      // 通过验证的用户入群，更新统计
      await updateStats(ctx, groupId, 'autoApproved')
      // 清除所有该用户的待审核记录
      for (const rec of pendingRecords) {
        await ctx.database.remove('group_verification_pending', { id: rec.id })
      }
      logger.info(`用户 ${userId} 通过验证加入群 ${groupId}，已清理 ${pendingRecords.length} 条待审核记录，统计已更新`)
    } else {
      // 手动邀请入群，记录到手动批准统计
      await updateStats(ctx, groupId, 'manuallyApproved')
      logger.info(`用户 ${userId} 被手动邀请加入群 ${groupId}，手动批准统计已更新`)
    }
  })



  // 更新统计信息

  // 权限检查函数
  async function checkPermission(session: any, targetGroupId?: string): Promise<[boolean, string?]> {
    const groupId = targetGroupId || session.guildId
    
    // 私聊情况下必须指定群号
    if (!groupId) {
      return [false, config.invalidGroupMessage || '请在群聊中使用此命令或使用 -i 参数指定群号']
    }
    
    // 使用Koishi logger输出调试信息
    logger.debug(`权限检查 - 用户ID: ${session.userId}, 群号: ${groupId}`)
    
    // 检查koishi权限等级（最高优先级）
    const koishiAuthority = session.author?.authority || session.user?.authority
    logger.debug(`权限检查 - Koishi权限等级: ${koishiAuthority || '未获取到'}`)
    
    // 尝试其他可能的权限字段
    if (!session.author) {
      logger.debug(`权限检查 - session中可能的权限字段:`, {
        authority: session.authority,
        permission: session.permission,
        role: session.role
      })
    } else {
      // 检查author对象中的其他权限字段
      logger.debug(`权限检查 - author对象中的字段:`, {
        authority: session.author.authority,
        permission: session.author.permission,
        role: session.author.role,
        permissions: session.author.permissions
      })
    }
    
    // 尝试从user对象获取权限信息
    if (session.user) {
      logger.debug(`权限检查 - user对象中的权限信息:`, {
        authority: session.user.authority,
        permission: session.user.permission,
        role: session.user.role
      })
    }
    
    // 先检查koishi权限等级（最高优先级）
    if (koishiAuthority && koishiAuthority >= 3) {
      logger.debug(`权限检查 - 通过koishi权限检查: ${koishiAuthority}`)
      return [true]
    }
    
    // 再检查是否为群主或管理员（次优先级）
    try {
      const member = await session.bot.getGuildMember(groupId, session.userId)
      logger.debug(`权限检查 - 获取到成员信息:`, {
        roles: member?.roles,
        permissions: member?.permissions
      })
      
      if (member) {
        // 检查群主权限
        if (member.permissions?.includes('OWNER') || member.roles?.includes('owner')) {
          logger.info(`权限检查 - 用户是群主`)
          return [true]
        }
        // 检查管理员权限
        if (member.roles?.includes('admin') || member.permissions?.includes('ADMINISTRATOR')) {
          logger.debug(`权限检查 - 用户是管理员`)
          return [true]
        }
      }
    } catch (error) {
      logger.warn(`权限检查 - 获取群成员信息失败:`, error)
      return [false, `无法获取群 ${groupId} 的成员信息，请确认机器人已在该群中`]
    }
    
    logger.debug(`权限检查 - 权限不足`)
    const debugInfo = `调试信息 - 用户ID:${session.userId}, 群号:${groupId}, 权限等级:${koishiAuthority || '未知'}`
    return [false, (config.permissionDeniedMessage || '权限不足：需要群主/管理员权限或koishi三级以上权限') + `\n${debugInfo}`]
  }

  // Create main command with aliases
  const groupVerify = ctx.command('group-verify', '群组验证管理命令')
    .alias('gv', 'gverify')

  // Subcommand: configure group verification
  groupVerify
    .subcommand('.config [keywords:text]', '配置群组验证规则')
    .alias(
      'gv.cfg', 'gverify.cfg', 'group-verify.cfg',
      'gv.配置', 'gverify.配置', 'group-verify.配置',
      'gvc'
    )
    .option('groupId', '-i <groupId> 指定群号')
    .option('method', '-m <method> 审核方式 (0-3)')
    .option('threshold', '-t <threshold> 阈值参数')
    .option('message', '-msg [message] 自定义提醒消息')
    .option('disableMessage', '-nomsg 禁用提醒消息')
    .option('query', '-? 查询当前配置')
    .option('remove', '-r 删除配置')
    .action(async ({ session, options }, keywords) => {
      // 详细调试：记录所有输入信息
      logger.info(`=== 命令解析调试 ===`)
      logger.info(`session内容: guildId=${session.guildId}, userId=${session.userId}`)

      // recompute raw argument string (去掉命令本身)
      const rawInput = session.content.split(/\s+/).slice(1).join(' ')
      logger.info(`原始命令参数: "${rawInput}"`)

      // 使用自定义解析函数提取关键词和 flags
      const parsed = parseConfigArgs(rawInput)
      const { keywords: parsedKeywords, flags, error: parseError } = parsed
      
      // 检查解析是否出错
      if (parseError) {
        return parseError
      }
      
      logger.info(`解析结果 flags=${JSON.stringify(flags)}, keywords=[${parsedKeywords.join(', ')}]`)

      // 由 flags 和 Koishi options 合并最终选项
      const cleanedOptions = {
        groupId: flags.groupId || options.groupId,
        method: flags.method || (options.method === '' ? undefined : options.method),
        threshold: flags.threshold || options.threshold,
        message: flags.message !== undefined ? flags.message : options.message,
        enableMessage: flags.enableMessage,  // 新增：-msg 裸调用标记
        disableMessage: flags.disableMessage || options.disableMessage,
        query: flags.query || options.query,
        remove: flags.remove || options.remove,
      }
      logger.info(`合并后options: ${JSON.stringify(cleanedOptions, null, 2)}`)

      // 检查 -? 和 -r 的独占性；允许与 -i 并存
      if ((cleanedOptions.query || cleanedOptions.remove) &&
          (parsedKeywords.length > 0 || cleanedOptions.method !== undefined || cleanedOptions.threshold !== undefined ||
           cleanedOptions.message !== undefined || cleanedOptions.enableMessage || cleanedOptions.disableMessage)) {
        return config.parameterConflictMessage || '参数冲突：-? 或 -r 不能与其他参数或关键词一起使用（仅可搭配 -i）'
      }

      // 检查消息参数冲突
      const hasRealMessageParam = cleanedOptions.message !== undefined
      const hasRealEnableMessageParam = cleanedOptions.enableMessage === true
      const hasRealDisableMessageParam = cleanedOptions.disableMessage !== undefined
      
      const targetGroupId = cleanedOptions.groupId || session.guildId
       
      // 权限检查（先检查群号有效性）
      if (targetGroupId) {
        // 群号合法性检查（只在用户明确指定-i参数时检查）
        if (config.enableStrictGroupCheck && cleanedOptions.groupId) {
          if (targetGroupId.length < 5 || targetGroupId.length > 15) {
            return `群号 ${targetGroupId} 格式不合法（长度应在5-15位之间）`
          }
        }
        
        try {
          // 检查机器人是否在目标群中（必须检查）
          await session.bot.getGuild(targetGroupId)
          
          // 检查用户权限
          const [hasPermission, errorMsg] = await checkPermission(session, targetGroupId)
          if (!hasPermission) {
            return errorMsg || '权限不足'
          }
        } catch (error) {
          return `群号 ${targetGroupId} 无效或机器人不在该群中`
        }
      } else {
        return '请在群聊中使用此命令或指定群号(-i参数)'
      }
       
      // 参数冲突检查
      if ((hasRealMessageParam || hasRealEnableMessageParam) && hasRealDisableMessageParam) {
        return '参数冲突：不能同时使用 -msg 和 -nomsg'
      }

      // 重复参数检测
      const usedOptions = []
      if (cleanedOptions.method !== undefined) usedOptions.push('-m')
      if (cleanedOptions.threshold !== undefined) usedOptions.push('-t')
      if (cleanedOptions.groupId !== undefined) usedOptions.push('-i')
      if (cleanedOptions.message !== undefined) usedOptions.push('-msg')
      if (cleanedOptions.enableMessage) usedOptions.push('-msg')
      if (cleanedOptions.disableMessage) usedOptions.push('-nomsg')
      
      if (usedOptions.length > new Set(usedOptions).size) {
        return `检测到重复参数: ${usedOptions.join(', ')}，将使用最后一次出现的值`
      }

      // 获取群信息
      let groupName = '未知群组'
      try {
        const guild = await session.bot.getGuild(targetGroupId)
        groupName = guild.name || groupName
      } catch (error) {
        // 无法获取群名称时使用默认值
      }
      
      // 处理删除配置
      if (cleanedOptions.remove) {
        const existingConfig = await ctx.database.get('group_verification_config', { groupId: targetGroupId })
        if (existingConfig.length > 0) {
          await ctx.database.remove('group_verification_config', { id: existingConfig[0].id })
          logger.info(`配置删除 - 用户ID:${session.userId}, 群号:${targetGroupId}`)
          return `已删除群 ${targetGroupId} 的验证配置`
        } else {
          return `群 ${targetGroupId} 无验证配置`
        }
      }
      
      // 处理查询配置
      if (cleanedOptions.query) {
        const existingConfig = await ctx.database.get('group_verification_config', { groupId: targetGroupId })
        if (existingConfig.length > 0) {
          const config = existingConfig[0]
          
          // 解码关键词（修复逗号解码问题）
          const decodedKeywords = config.keywords.map(keyword => {
            return keyword.replace(/\[\[COMMA\]\]/g, ',')
          })
          
          let methodDesc = ''
          let thresholdInfo = ''
          switch (config.reviewMethod) {
            case 0: 
              methodDesc = '全部同意'
              thresholdInfo = '无'
              break
            case 1: 
              methodDesc = `按数量同意`
              thresholdInfo = config.reviewParameters?.toString() || '无'
              break
            case 2: 
              methodDesc = `按比例同意`
              thresholdInfo = config.reviewParameters ? `${config.reviewParameters}%` : '无'
              break
            case 3: 
              methodDesc = '全部拒绝'
              thresholdInfo = '无'
              break
          }
          
          const createTime = new Date(config.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          const updateTime = new Date(config.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          const reminderStatus = config.reminderEnabled ? '启用' : '禁用'
          
          return `群 ${targetGroupId} 配置：
关键词: ${decodedKeywords.join(', ')}
审核方式: ${methodDesc}
阈值: ${thresholdInfo}
提醒消息: ${reminderStatus}
自定义消息:\n${config.reminderMessage || '无'}
创建时间: ${createTime}
更新时间: ${updateTime}
创建者: ${config.createdBy}
更新者: ${config.updatedBy}`
        } else {
          return `群 ${targetGroupId} 无验证配置`
        }
      }
      
      // 关键词列表由之前解析得到的 parsedKeywords 构成
      let keywordList: string[] = parsedKeywords.slice()

      logger.info(`关键词解析结果: [${keywordList.join(', ')}] - 原始输入: "${rawInput}"`)

      // 如果没有关键词且不是查询/删除操作，则根据现有配置或报错
      if (keywordList.length === 0 && !cleanedOptions.query && !cleanedOptions.remove) {
        const hasConfigParams = cleanedOptions.method !== undefined ||
                               cleanedOptions.threshold !== undefined ||
                               hasRealMessageParam ||
                               hasRealEnableMessageParam ||
                               hasRealDisableMessageParam
        if (!hasConfigParams) {
          return usageString()
        }
        // 这里会在下面获取一次 existingConfig，故暂不重复查询
      }
      
      // 获取现有配置（仅查询一次）- 用于消息持久化和参数继承
      let existingConfig = null
      const existingConfigs = await ctx.database.get('group_verification_config', { groupId: targetGroupId })
      if (existingConfigs.length > 0) {
        existingConfig = existingConfigs[0]
      }
      
      // 处理关键词：如果没有关键词但有其他参数，从现有配置中获取
      if (keywordList.length === 0 && !cleanedOptions.query && !cleanedOptions.remove) {
        if (!existingConfig) {
          return config.noKeywordsMessage || '请先提供关键词创建配置，或使用 -? 查询配置，-r 删除配置'
        }
        keywordList = existingConfig.keywords
      }
      
          // 处理提醒消息配置（抽取为公共函数，以便测试和复用）
      const { reminderEnabled, reminderMessage } = mergeReminder(
        existingConfig,
        cleanedOptions,
        hasRealMessageParam,
        hasRealEnableMessageParam,
        hasRealDisableMessageParam,
        logger,
        config.defaultReminderMessage
      )
      
      // 解析审核方式和阈值（基于新的数据库模型设计）
      let reviewMethod: 0 | 1 | 2 | 3 = 0 // 默认值
      let reviewParameters: number = 0 // 直接存储数字：0表示无阈值
      
      if (existingConfig) {
        // 默认使用现有配置的参数
        reviewMethod = existingConfig.reviewMethod
        
        // 老版本兼容性处理：处理可能的NaN或无效值
        if (existingConfig.reviewParameters === undefined || 
            existingConfig.reviewParameters === null || 
            isNaN(existingConfig.reviewParameters)) {
          reviewParameters = 0  // 默认值
          logger.info(`检测到老版本数据或无效值，使用默认阈值: 0`)
        } else {
          reviewParameters = existingConfig.reviewParameters
        }
      }
      
      // 处理审核方式参数
      if (cleanedOptions.method !== undefined && cleanedOptions.method !== '') {
        const methodNum = parseInt(cleanedOptions.method)
        if (isNaN(methodNum) || methodNum < 0 || methodNum > 3) {
          return '审核方式参数错误：0-全部同意, 1-按数量同意, 2-按比例同意, 3-全部拒绝'
        }
        const oldMethod = reviewMethod
        reviewMethod = methodNum as 0 | 1 | 2 | 3
        logger.debug(`审核方式明确指定为: ${reviewMethod}`)
        var methodChanged = oldMethod !== reviewMethod
      } else {
        logger.debug(`未指定审核方式，保持原有值: ${reviewMethod}`)
        var methodChanged = false
      }

      // 决定最终的阈值，可能会触发自动调整
      const thresholdResult = resolveThreshold(
        existingConfig,
        keywordList,
        reviewMethod,
        cleanedOptions.threshold,
        methodChanged
      )
      if (thresholdResult.error) {
        return thresholdResult.error
      }
      reviewParameters = thresholdResult.reviewParameters

      // 如果参数通过自动逻辑发生变化，回写数据库并记录提示
      if (existingConfig && reviewParameters !== existingConfig.reviewParameters) {
        await ctx.database.set('group_verification_config', { id: existingConfig.id }, {
          reviewParameters,
          updatedBy: session.username || session.userId,
          updatedAt: new Date().toISOString()
        })
        logger.debug(`自动调整并更新数据库阈值为: ${reviewParameters}`)
      }

      // 自动调整说明，用于反馈消息
      let autoAdjustNote = ''
      if (thresholdResult.autoInfo === 'methodChange') {
        if (reviewMethod === 1) {
          autoAdjustNote = `⚠️ 审核方式由 ${existingConfig?.reviewMethod} 改为 ${reviewMethod}，阈值自动设为 ${reviewParameters}\n`
        } else if (reviewMethod === 2) {
          autoAdjustNote = `⚠️ 审核方式由 ${existingConfig?.reviewMethod} 改为 ${reviewMethod}，阈值自动设为 ${reviewParameters}%\n`
        }
      } else if (thresholdResult.autoInfo === 'kwChange') {
        autoAdjustNote = `⚠️ 关键词数量从${existingConfig?.keywords.length}变为${keywordList.length}，阈值已自动调整为${reviewParameters}\n`
      }
      
      // 数据库存储前的关键词编码处理
      // 避免数据库自动拆分包含逗号的关键词
      const encodedKeywords = keywordList.map(keyword => {
        // 将逗号替换为特殊标记，在读取时再还原
        return keyword.replace(/,/g, '[[COMMA]]')
      })
      
      logger.info(`编码后准备存储的关键词: ${JSON.stringify(encodedKeywords)}`)
      
      // 保存配置到数据库（使用新的简单格式）
      const dbData = {
        keywords: encodedKeywords,
        reviewMethod: reviewMethod,
        reviewParameters: reviewParameters, // 直接存储数字
        reminderEnabled: reminderEnabled,
        reminderMessage: reminderMessage,
        updatedBy: session.username || session.userId,
        updatedAt: new Date().toISOString()
      }
      
      if (existingConfig) {
        // ensure timestamp strings for compatibility
        await ctx.database.set('group_verification_config', { id: existingConfig.id }, {
          ...dbData,
          updatedAt: new Date().toISOString(),
        })
        logger.info(`更新配置成功 - 审核方式: ${reviewMethod}, 阈值: ${reviewParameters}`)
      } else {
        await ctx.database.create('group_verification_config', {
          groupId: targetGroupId,
          ...dbData,
          createdBy: session.username || session.userId,
          createdAt: new Date().toISOString()
        })
        logger.info(`创建配置成功 - 审核方式: ${reviewMethod}, 阈值: ${reviewParameters}`)
      }
      
      // 读取时解码关键词（修复更新显示中的关键词显示问题）
      const decodedKeywords = keywordList  // 显示时使用原始关键词
      
      // 构建完整的配置反馈信息
      let feedbackMessage = `群 ${targetGroupId} 配置已更新:\n`
      if (autoAdjustNote) feedbackMessage += autoAdjustNote
      // 使用原始输入的关键词显示，而不是处理后的keywordList
      const displayKeywords = keywordList.map(k => k.replace(/\[\[COMMA\]\]/g, ','))
      feedbackMessage += `关键词: ${displayKeywords.map(k => `"${k}"`).join(', ')}\n`
      
      const methodMap = {0: '全部同意', 1: '按数量', 2: '按比例', 3: '全部拒绝'}
      feedbackMessage += `审核方式: ${methodMap[reviewMethod]}\n`
      
      // 显示阈值（即便为 0）
      if (reviewMethod === 1 || reviewMethod === 2) {
        const thresholdDisplay = reviewMethod === 2 ? `${reviewParameters}%` : reviewParameters.toString()
        feedbackMessage += `阈值: ${thresholdDisplay}\n`
      }
      
      feedbackMessage += `提醒状态: ${reminderEnabled ? '启用' : '禁用'}\n`
      if (reminderMessage && reminderEnabled) {
        // show full message on its own lines so users can see everything
        feedbackMessage += `提醒消息:\n${reminderMessage}\n`
      }
      
      
      // 同时更新数据库存储时也要确保正确格式
      logger.info(`准备存储到数据库的关键词: ${JSON.stringify(encodedKeywords)}`)
      
      // 添加详细的处理日志
      logger.info(`=== 配置处理详情 ===`)
      logger.info(`原始输入: ${keywords || '无关键词'}`)
      logger.info(`审核方式: ${reviewMethod} (${['全部同意','按数量','按比例','全部拒绝'][reviewMethod]})`)
      logger.info(`阈值参数: ${JSON.stringify(reviewParameters)}`)
      logger.info(`关键词列表: [${keywordList.map(k => `"${k}"`).join(', ')}]`)
      logger.info(`现有配置: ${existingConfig ? '存在' : '不存在'}`)
      if (existingConfig) {
        logger.info(`原审核方式: ${existingConfig.reviewMethod}`)
        logger.info(`原阈值: ${JSON.stringify(existingConfig.reviewParameters)}`)
        logger.info(`原关键词数: ${existingConfig.keywords.length}`)
        logger.info(`新关键词数: ${keywordList.length}`)
      }
      logger.info(`==================`)
      
      logger.info(feedbackMessage.replace(/\n/g, '; '))
      return feedbackMessage
    })

  // Subcommand: approve join request
  groupVerify
    .subcommand('.approve [userId]', '同意加群申请')
    .alias(
      'gv.accept', 'gverify.accept', 'group-verify.accept',
      'gv.同意', 'gverify.同意', 'group-verify.同意',
      'gva'
    )
    .action(async ({ session }, userId) => {
      // 权限检查
      const [hasPermission, errorMsg] = await checkPermission(session)
      if (!hasPermission) {
        return errorMsg || '权限不足'
      }

      const groupId = session.guildId
      if (!groupId) {
        return '请在群聊中使用此命令'
      }

      // 在开始之前检查配置是否为全部拒绝
      const configs = await ctx.database.get('group_verification_config', { groupId })
      if (configs.length > 0 && configs[0].reviewMethod === 3) {
        return '该群已设为全部拒绝，无法手动同意任何申请'
      }
      // 处理默认情况和 all 情况
      if (!userId || userId.toLowerCase() === 'all') {
        if (userId?.toLowerCase() === 'all') {
          // 处理所有待审核申请
          const pendingRequests = await ctx.database.get('group_verification_pending', { groupId })
          if (pendingRequests.length === 0) {
            return '当前无待审核的加群申请'
          }
          
          let approvedCount = 0
          let skippedCount = 0
          for (const request of pendingRequests) {
            if (request.requestId) {
              try {
                await session.bot.handleGuildMemberRequest(request.requestId, true)
                approvedCount++
              } catch (error) {
                logger.warn(`处理申请 ${request.id} 时出错:`, error)
              }
            } else {
              skippedCount++
            }
            // 不论是否有 requestId，都清除记录，避免无限积累
            await ctx.database.remove('group_verification_pending', { id: request.id })
          }
          let msg = `已处理 ${approvedCount} 个加群申请`
          if (skippedCount) msg += `，${skippedCount} 个因缺少 requestId 未处理`;
          return msg
        } else {
          // 处理最近的一个申请（按时间降序）
          let pending: any[] = await ctx.database.get('group_verification_pending', { groupId }, ['id', 'userId', 'userName', 'applyTime', 'requestId'])
          if (pending.length === 0) {
            return '当前无待审核的加群申请'
          }
          pending.sort((a, b) => String(b.applyTime).localeCompare(String(a.applyTime)))
          const request: any = pending[0]
          if (!request.requestId) {
            return `用户 ${request.userId} 的申请缺少 requestId，无法自动同意`;
          }
          try {
            await session.bot.handleGuildMemberRequest(request.requestId, true)
            // 清除该用户的所有待审核记录
            await ctx.database.remove('group_verification_pending', { groupId, userId: request.userId })
            const displayName = request.userName && request.userName !== request.userId ? `${request.userName}(${request.userId})` : request.userId
            return `已同意用户 ${displayName} 的加群申请`
          } catch (error) {
            return `处理申请时出错: ${error.message}`
          }
        }
      }

      // 处理指定用户ID的情况
      let pendingRequests = await ctx.database.get('group_verification_pending', { 
        groupId, 
        userId: userId 
      })

      if (pendingRequests.length === 0) {
        return `未找到用户 ${userId} 的待审核申请`
      }

      const request = pendingRequests[0]
      if (!request.requestId) {
        return `用户 ${userId} 的申请缺少 requestId，无法自动同意`
      }
      try {
        await session.bot.handleGuildMemberRequest(request.requestId, true)
        // 删除该用户的所有记录
        await ctx.database.remove('group_verification_pending', { groupId, userId })
        const displayName = request.userName && request.userName !== request.userId ? `${request.userName}(${request.userId})` : request.userId
        return `已同意用户 ${displayName} 的加群申请`
      } catch (error) {
        return `处理申请时出错: ${error.message}`
      }
    })

  // Subcommand: reject join request
  groupVerify
    .subcommand('.reject [userId]', '拒绝加群申请')
    .alias(
      'gv.拒绝', 'gverify.拒绝', 'group-verify.拒绝',
      'gv.rej', 'gverify.rej', 'group-verify.rej',
      'gvr'
    )
    .action(async ({ session }, userId) => {
      // 权限检查
      const [hasPermission, errorMsg] = await checkPermission(session)
      if (!hasPermission) {
        return errorMsg || '权限不足'
      }

      const groupId = session.guildId
      if (!groupId) {
        return '请在群聊中使用此命令'
      }

      // 处理默认情况和 all 情况
      if (!userId || userId.toLowerCase() === 'all') {
        if (userId?.toLowerCase() === 'all') {
          // 拒绝所有待审核申请
          const pendingRequests = await ctx.database.get('group_verification_pending', { groupId })
          if (pendingRequests.length === 0) {
            return '当前无待审核的加群申请'
          }
          
          let rejectedCount = 0
          let skippedCount = 0
          for (const request of pendingRequests) {
            if (request.requestId) {
              try {
                await session.bot.handleGuildMemberRequest(request.requestId, false)
                rejectedCount++
              } catch (error) {
                logger.warn(`处理申请 ${request.id} 时出错:`, error)
              }
            } else {
              skippedCount++
            }
            await ctx.database.remove('group_verification_pending', { id: request.id })
            await updateStats(ctx, groupId, 'rejected')
          }
          let msg = `已拒绝 ${rejectedCount} 个加群申请`
          if (skippedCount) msg += `，${skippedCount} 个因缺少 requestId 未处理`;
          return msg
        } else {
          // 拒绝最近的一个申请（按 applyTime 降序）
          let pending: any[] = await ctx.database.get('group_verification_pending', { groupId }, ['id', 'userId', 'userName', 'applyTime', 'requestId'])
          if (pending.length === 0) {
            return '当前无待审核的加群申请'
          }
          pending.sort((a, b) => String(b.applyTime).localeCompare(String(a.applyTime)))
          const request: any = pending[0]
          if (!request.requestId) {
            return `用户 ${request.userId} 的申请缺少 requestId，无法自动拒绝`;
          }
          try {
            await session.bot.handleGuildMemberRequest(request.requestId, false)
            // 删除该用户的所有记录
            await ctx.database.remove('group_verification_pending', { groupId, userId: request.userId })
            await updateStats(ctx, groupId, 'rejected')
            const displayName = request.userName && request.userName !== request.userId ? `${request.userName}(${request.userId})` : request.userId
            return `已拒绝用户 ${displayName} 的加群申请`
          } catch (error) {
            return `处理申请时出错: ${error.message}`
          }
        }
      }

      // 处理指定用户ID的情况
      const pendingRequests = await ctx.database.get('group_verification_pending', { 
        groupId, 
        userId: userId 
      })

      if (pendingRequests.length === 0) {
        return `未找到用户 ${userId} 的待审核申请`
      }

      const request = pendingRequests[0]
      if (!request.requestId) {
        return `用户 ${userId} 的申请缺少 requestId，无法自动拒绝`
      }
      try {
        await session.bot.handleGuildMemberRequest(request.requestId, false)
        // 删除该用户的所有记录
        await ctx.database.remove('group_verification_pending', { groupId, userId })
        await updateStats(ctx, groupId, 'rejected')
        const displayName = request.userName && request.userName !== request.userId ? `${request.userName}(${request.userId})` : request.userId
        return `已拒绝用户 ${displayName} 的加群申请`
      } catch (error) {
        return `处理申请时出错: ${error.message}`
      }
    })

  // Subcommand: view statistics
  groupVerify
    .subcommand('.stats [target]', '查看群组验证统计信息')
    .alias(
      'gv.统计', 'gverify.统计', 'group-verify.统计',
      'gvs'
    )
    .action(async ({ session }, target) => {
      // 参数验证：只能是群号、all、total或空
      const validTargets = ['all', 'total']
      const isGroupId = target && /^\d+$/.test(target)
      const isSpecialTarget = target && validTargets.includes(target.toLowerCase())
      
      if (target && !isGroupId && !isSpecialTarget) {
        return '参数错误：只能指定群号、all、total或留空'
      }
      
      // 权限检查：总计统计需要3级以上权限
      if (target?.toLowerCase() === 'total' || target?.toLowerCase() === 'all') {
        // 检查是否为koishi 3级以上权限
        const koishiAuthority = (session as any).author?.authority || (session as any).user?.authority
        if (!(koishiAuthority && koishiAuthority >= 3)) {
          return '查看总计统计需要koishi 3级以上权限'
        }
      }
      
      const groupId = session.guildId
      
      // 处理不同参数情况
      if (!target) {
        // 无参数：显示当前群统计
        if (!groupId) {
          return '请在群聊中使用此命令或指定群号'
        }
        return await getGroupStats(groupId)
      }
      
      if (target.toLowerCase() === 'all' || target.toLowerCase() === 'total') {
        // 显示总计统计
        return await getTotalStats()
      }
      
      if (isGroupId) {
        // 显示指定群统计
        return await getGroupStats(target)
      }
      
      return '参数错误'
    })

  // Subcommand: view pending requests
  groupVerify
    .subcommand('.pending', '查看待审核加群申请')
    .alias(
      'gv.list', 'gverify.list', 'group-verify.list',
      'gv.待处理', 'gverify.待处理', 'group-verify.待处理',
      'gvp'
    )
    .action(async ({ session }) => {
      if (!session.guildId) {
        return '请在群聊中使用此命令'
      }
      
      const pendingApplications = await ctx.database.get('group_verification_pending', {
        groupId: session.guildId
      })
      
      if (pendingApplications.length === 0) {
        return '当前没有待审核的加群申请'
      }
      
      let result = '待审核申请列表：\n'
      pendingApplications.forEach((app, index) => {
        result += `${index + 1}. ${app.userName}(${app.userId})
   申请时间：${app.applyTime.toLocaleString()}
   申请理由：${app.requestMessage}

`
      })
      
      return result
    })

  // Subcommand: blacklist management
  groupVerify
    .subcommand('.blacklist [args:text]', '管理加群黑名单')
    .alias(
      'gvb',
      'gv.blacklist', 'gverify.blacklist', 'group-verify.blacklist',
      'gv.黑名单', 'gverify.黑名单', 'group-verify.黑名单'
    )
    .action(async ({ session }, args) => {
      return await processBlacklistCommand(ctx, session, args || '')
    })

  // Subcommand: help information
  groupVerify
    .subcommand('.help', '显示帮助信息')
    .alias('gv.帮助', 'gverify.帮助', 'group-verify.帮助', '帮助', 'hlp', '帮助信息')
    .action(() => {
      return `群组验证命令帮助：
主指令别名：gv, gverify

配置命令 (.config/.cfg):
  用法：
    1. 创建新配置：gv.cfg 关键词1,关键词2 -m 1 -t 2
    2. 修改现有配置：gv.cfg -m 1 -t 2 (不提供关键词)
    3. 启用提醒消息：gv.cfg -msg "消息内容"
    4. 禁用提醒消息：gv.cfg -nomsg
    5. 查询配置：gv.cfg -?
    6. 删除配置：gv.cfg -r
  
  参数说明：
    -i <群号>     指定群号（私聊时必需）
    -m <方式>     审核方式 (0=全部同意, 1=按数量, 2=按比例, 3=全部拒绝)
    -t <阈值>     阈值参数（方式1:0-关键词数, 方式2:0-100）
    -msg [消息]   自定义提醒消息（支持引号和\\n换行）；若不跟内容则仅启用/保留上一次的消息
                 空格将把消息与后续关键词分隔。
                 若消息本身含逗号且不希望与后续文字混淆，可直接写出（只要所有逗号处均未伴随空格，插件会将它们视为同一消息）。
                 如果逗号后还有其他词，则请用引号包裹整个消息或把逗号与空格分开以避免歧义。
    -nomsg        禁用提醒消息
    -?           查询当前配置
    -r           删除配置
  
  引号使用规则：
    • 关键词包含空格：gv.cfg "关键词1,关键词 2,关键词3"
    • 提醒消息包含空格：gv.cfg -msg "这是包含空格的消息"
    • 内部引号转义：gv.cfg -msg "包含\\"引号\\"的内容"
    • 换行符：gv.cfg -msg "第一行\\n第二行"
  
  特殊说明：
    • 阈值可设为0表示全部同意
    • 关键词数量变化时阈值会自动调整
    • 重复参数会使用最后出现的值并提醒
    • 群号检查可在插件配置中开关
  
  提醒消息变量：
    {user} - 用户名
    {id} - 用户ID  
    {group} - 群号
    {gname} - 群名称
    {question} - 申请理由
    {answer} - 答对数量/比例
    {threshold} - 阈值要求
  
  使用示例：
    gv.cfg "关键词1,关键词2" -m 1 -t 2
    gv.cfg -msg "用户 {user}\\n申请理由：{question}"
    gv.cfg -m 2 -t 80
    gv.cfg -nomsg

黑名单命令 (.blacklist / gvb):
  a <id> [reason] [group]   添加黑名单，可指定原因和群号；group为all表示全局
  r <id> [group]             删除条目
  l [group]                  查看某个群（或 all）的黑名单
  i <id>                     查询指定用户在当前群与全局的状态
使用示例：
    gvb a 12345 作弊记录
    gvb r 12345 67890
    gvb l
    gvb l all
    gvb i 12345

快捷命令：
  gvc - 配置命令快捷方式
  gva - 同意申请快捷命令
  gvr - 拒绝申请快捷命令
  gvp - 查看待审核列表快捷命令
  gvs - 查看统计信息快捷命令

权限说明：
  - 群主/管理员权限
  - koishi三级以上权限
  - 私聊时必须指定群号(-i参数)`
    })

  // 插件初始化时确保总计统计行存在
  ctx.on('ready', async () => {
    // 迁移：将旧版保留的 Date 对象字段转换为 ISO 字符串，以避免绑定错误
    try {
      const configs = await ctx.database.get('group_verification_config', {})
      for (const cfg of configs) {
        const updates: any = {}
        if (cfg.createdAt instanceof Date) updates.createdAt = cfg.createdAt.toISOString()
        if (cfg.updatedAt instanceof Date) updates.updatedAt = cfg.updatedAt.toISOString()
        if (Object.keys(updates).length) {
          await ctx.database.set('group_verification_config', { id: cfg.id }, updates)
        }
      }
      const stats = await ctx.database.get('group_verification_stats', {})
      for (const st of stats) {
        const updates: any = {}
        if (st.lastUpdated instanceof Date) updates.lastUpdated = st.lastUpdated.toISOString()
        // add missing totalJoined column default 0
        if (st.totalJoined === undefined) updates.totalJoined = 0
        if (Object.keys(updates).length) {
          await ctx.database.set('group_verification_stats', { id: st.id }, updates)
        }
      }
      const pendings = await ctx.database.get('group_verification_pending', {})
      for (const p of pendings) {
        const updates: any = {}
        if (p.applyTime instanceof Date) updates.applyTime = p.applyTime.toISOString()
        // add default empty requestId if record pre-dates the new column
        if (p.requestId === undefined) updates.requestId = ''
        if (Object.keys(updates).length) {
          await ctx.database.set('group_verification_pending', { id: p.id }, updates)
        }
      }
      logger.info('旧版日期字段迁移完成')
    } catch (e) {
      logger.warn('迁移旧日期字段时出错', e)
    }

    // 检查是否已存在总计行（groupId为'TOTAL'）
    const totalStats = await ctx.database.get('group_verification_stats', { groupId: 'TOTAL' })
    
    if (totalStats.length === 0) {
      // 创建总计统计行
      await ctx.database.create('group_verification_stats', {
        groupId: 'TOTAL',
        autoApproved: 0,
        manuallyApproved: 0,
        rejected: 0,
        lastUpdated: new Date().toISOString()
      })
      logger.info('已创建总计统计行')
    } else {
      logger.info('总计统计行已存在')
    }
    
    // 同步现有统计数据到总计行
    await syncTotalStats(ctx)
  })
  
  // 辅助函数：获取群组统计
  async function getGroupStats(groupId: string): Promise<string> {
    const stats = await ctx.database.get('group_verification_stats', { groupId })
    
    if (stats.length === 0) {
      return `群 ${groupId} 暂无验证统计信息`
    }
    
    const stat = stats[0]
    const lastUpdated = new Date(stat.lastUpdated).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    
    return `群 ${groupId} 验证统计：
自动批准: ${stat.autoApproved}
手动批准: ${stat.manuallyApproved}
拒绝: ${stat.rejected}
最后更新: ${lastUpdated}`
  }
  
  // 辅助函数：获取总计统计
  async function getTotalStats(): Promise<string> {
    const stats = await ctx.database.get('group_verification_stats', { groupId: 'TOTAL' })
    
    if (stats.length === 0) {
      return '暂无统计信息'
    }
    
    const stat = stats[0]
    const lastUpdated = new Date(stat.lastUpdated).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    
    return `总计验证统计：
自动批准: ${stat.autoApproved}
手动批准: ${stat.manuallyApproved}
拒绝: ${stat.rejected}
最后更新: ${lastUpdated}`
  }
  
}
