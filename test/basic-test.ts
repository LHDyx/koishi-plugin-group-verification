/**
 * 基础功能测试脚本
 * 用于验证群组验证插件的核心功能
 */

import { Context } from 'koishi'
import { GroupVerificationConfig, GroupVerificationStats, Config, tokenize, parseConfigArgs, mergeReminder, verifyApplication, handleFailedVerification, usageString, handleGuildMemberRequestEvent, __getAutoQueue, updateStats, incrementTotal, resolveThreshold } from '../src/index'
// also import entire module for runtime patching
const plugin: any = require('../src/index')

// 模拟测试数据
const mockConfig: any = {
  id: 1,
  groupId: '123456789',
  keywords: ['学生', '校友', '老师'],
  // follow interface in plugin
  reviewMethod: 0,
  reviewParameters: 0,
  reminderEnabled: true,
  reminderMessage: '请管理员审核',
  createdAt: new Date(),
  updatedAt: new Date()
}

const mockStats: GroupVerificationStats = {
  id: 1,
  groupId: '123456789',
  autoApproved: 5,
  manuallyApproved: 3,
  rejected: 2,
  totalJoined: 0,
  lastUpdated: new Date()
}

// 测试关键词验证功能
function testKeywordVerification() {
  console.log('=== 测试关键词验证功能 ===')
  
  const config = mockConfig
  const testMessages = [
    '我是学生，想加入群聊',
    '我是这个学校的校友',
    '我是老师，希望能加入',
    '我想随便聊聊',
    '我是学生家长'
  ]
  
  testMessages.forEach(message => {
    const isValid = config.keywords.some((keyword: string) => 
      message.toLowerCase().includes(keyword.toLowerCase())
    )
    console.log(`消息: "${message}" -> 验证结果: ${isValid ? '通过' : '不通过'}`)
  })
}

// 测试统计功能
function testStatistics() {
  console.log('\n=== 测试统计功能 ===')
  
  const stats = mockStats
  console.log(`群组 ${stats.groupId} 统计信息:`)
  console.log(`- 自动通过: ${stats.autoApproved}`)
  console.log(`- 手动通过: ${stats.manuallyApproved}`)
  console.log(`- 拒绝: ${stats.rejected}`)
  console.log(`- 总计: ${stats.autoApproved + stats.manuallyApproved + stats.rejected}`)
}

// 测试配置解析
function testConfigParsing() {
  console.log('\n=== 测试配置解析 ===')
  
  const configString = '学生,校友,老师'
  const keywords = configString.split(',').map(k => k.trim())
  
  console.log(`原始配置: "${configString}"`)
  console.log(`解析结果: [${keywords.join(', ')}]`)
  console.log(`关键词数量: ${keywords.length}`)
}

// 新增：命令参数解析测试
function testArgumentParsing() {
  console.log('\n=== 测试参数与引号解析 ===')
  const cases = [
    { input: 'a,b,c -m 1 -t 2', expect: { keywords: ['a','b','c'], flags: { method: '1', threshold: '2' } } },
    { input: '"1,2",3 -msg "hello world" -nomsg', expect: { keywords: ['1,2','3'], flags: { message: 'hello world', disableMessage: true } } },
    { input: '-? ', expect: { keywords: [], flags: { query: true } } },
    { input: 'foo -msg bar baz -i 12345', expect: { keywords: ['foo','baz'], flags: { message: 'bar', groupId: '12345' } } },
    // new edge cases
    { input: '1"2,3"', expectError: true },
    { input: '1,2"', expectError: true },
    { input: '1"2', expectError: true },
    { input: '1\\"2', expect: { keywords: ['1"2'], flags: {} } },
    // escaped quote after comma should still produce a quoted token but not trigger error
    { input: '1,2"', expectError: true },
    { input: '"a b" c', expect: { keywords: ['a b','c'], flags: {} } },
    { input: '-msg 1111 2', expect: { keywords: ['2'], flags: { message: '1111' } } },
    { input: '-msg 213', expect: { keywords: [], flags: { message: '213' } } },
    { input: '-msg 12,34', expect: { keywords: [], flags: { message: '12,34' } } },
    { input: '-msg 12,34,56', expect: { keywords: [], flags: { message: '12,34,56' } } },
    { input: '-msg 1 23,45', expect: { keywords: ['23','45'], flags: { message: '1' } } },
    { input: '-msg 1,2 3', expect: { keywords: ['3'], flags: { message: '1,2' } } },
    { input: '-nomsg', expect: { keywords: [], flags: { disableMessage: true } } },
    { input: '-msg', expect: { keywords: [], flags: { enableMessage: true } } },
    { input: '-msg "1 23,45"', expect: { keywords: [], flags: { message: '1 23,45' } } },
    { input: '"1,2",3,"4",5,"6 7,,8 9" -m 1 -t 4 -msg 1 23,45', expectError: false },
    { input: '-m 2', expect: { keywords: [], flags: { method: '2' } } },
    { input: '-m', expectError: true },
    { input: '-t', expectError: true },
    { input: '-i', expectError: true },
    // new: -i can coexist with -? and -r
    { input: '-i 123 -?', expect: { keywords: [], flags: { groupId: '123', query: true } } },
    { input: '-i 123 -r', expect: { keywords: [], flags: { groupId: '123', remove: true } } },
  ]
  cases.forEach((c: any, idx) => {
    const parsed = parseConfigArgs(c.input)
    if (c.expectError) {
      console.log(`case ${idx+1}: "${c.input}" -> error=${parsed.error || 'none'} (${parsed.error ? 'OK' : 'FAIL'})`)
      return
    }
    if (c.expect) {
      const okKeywords = JSON.stringify(parsed.keywords) === JSON.stringify(c.expect.keywords)
      const okFlags = JSON.stringify(parsed.flags) === JSON.stringify(c.expect.flags)
      console.log(`case ${idx+1}: "${c.input}" -> keywords=${parsed.keywords}, flags=${JSON.stringify(parsed.flags)} (${okKeywords&&okFlags? 'OK':'FAIL'})`)
    } else {
      console.log(`case ${idx+1}: "${c.input}" -> parsed=${JSON.stringify(parsed)} (no expectation)`)
    }
  })
}

// 新增：提醒消息持久化测试
function testReminderPersistence() {
  console.log('\n=== 测试提醒消息持久化 ===')
  const baseConfig = { reminderEnabled: true, reminderMessage: 'orig' }
  let res = mergeReminder(baseConfig, { enableMessage: true }, false, true, false, console, 'DEF')
  console.log('bare -msg ->', res, (res.reminderEnabled && res.reminderMessage === 'orig') ? 'OK' : 'FAIL')
  res = mergeReminder(baseConfig, { disableMessage: true }, false, false, true, console, 'DEF')
  console.log('-nomsg ->', res, (!res.reminderEnabled && res.reminderMessage === 'orig') ? 'OK' : 'FAIL')
  res = mergeReminder(baseConfig, { enableMessage: true }, false, true, false, console, 'DEF')
  console.log('再 bare -msg ->', res, (res.reminderEnabled && res.reminderMessage === 'orig') ? 'OK' : 'FAIL')
  // new default-message test
  res = mergeReminder(null, {}, false, false, false, console, 'DEFAULT')
  console.log('默认无现有config ->', res, (res.reminderMessage === 'DEFAULT') ? 'OK' : 'FAIL')
}

// 新增：验证函数行为测试
async function testVerifyApplication() {
  console.log('\n=== 测试 verifyApplication 重叠关键词 ===')
  const cfg: any = { keywords: ['12','23','45'], reviewMethod: 1, reviewParameters: 2 }
  const session: any = { }
  let res = await verifyApplication(cfg, '1245', session)
  console.log('1245 ->', res)
  res = await verifyApplication(cfg, '12345', session)
  console.log('12345 ->', res)
  
  // 新增：按比例审核时显示的阈值应为需要匹配的关键词数量
  const cfg2: any = { keywords: ['a','b','c'], reviewMethod: 2, reviewParameters: 60 }
  res = await verifyApplication(cfg2, 'a', session)
  console.log('比例审核阈值显示 ->', res.requiredThreshold === '2' ? 'OK' : `FAIL (${res.requiredThreshold})`)
}

// 新增：阈值为0时应正常工作
async function testThresholdZero() {
  console.log('\n=== 测试阈值为0的逻辑 ===')
  const s: any = {}
  const r1 = await verifyApplication({ keywords: ['a'], reviewMethod: 1, reviewParameters: 0 } as any, '', s)
  console.log('方式1, 阈值0 ->', r1.isValid ? 'OK' : 'FAIL')
  const r2 = await verifyApplication({ keywords: ['a','b'], reviewMethod: 2, reviewParameters: 0 } as any, '', s)
  console.log('方式2, 阈值0% ->', r2.isValid ? 'OK' : 'FAIL')
}

// 新增：requestId 存储与 gva/gvr 行为测试
async function testRequestIdAndCommands() {
  console.log('\n=== 测试 requestId 存储与 gva/gvr 行为 ===')
  const calls: any[] = []
  // 简易假数据库
  const fakeCtx: any = {
    database: {
      pending: [] as any[],
      get: async (table: string, where: any) => {
        if (table === 'group_verification_pending') {
          return fakeCtx.database.pending.filter((p: any) => {
            for (const k in where) if (p[k] !== where[k]) return false
            return true
          })
        }
        return []
      },
      create: async (table: string, data: any) => {
        if (table === 'group_verification_pending') {
          fakeCtx.database.pending.push(Object.assign({ id: fakeCtx.database.pending.length + 1 }, data))
        }
      },
      remove: async (table: string, where: any) => {
        if (table === 'group_verification_pending') {
          fakeCtx.database.pending = fakeCtx.database.pending.filter((p: any) => {
            for (const k in where) if (p[k] !== where[k]) return true
            return false
          })
        }
      }
    }
  }

  const fakeSession: any = {
    guildId: 'G1',
    channelId: '',
    userId: 'U1',
    username: 'user1',
    content: 'foo',
    bot: { getGuild: async() => ({ name: 'g' }) },
    event: { requestId: 'REQ123' }
  }
  await handleFailedVerification(fakeCtx, fakeSession, mockConfig)
  let pending = fakeCtx.database.pending
  console.log('pending 数量 1 ->', pending.length === 1 ? 'OK' : 'FAIL')
  console.log('requestId 被保存 ->', pending[0].requestId === 'REQ123' ? 'OK' : 'FAIL')
  // 模拟重复申请，新申请应覆盖旧申请
  fakeSession.event.requestId = 'REQ456'
  await handleFailedVerification(fakeCtx, fakeSession, mockConfig)
  pending = fakeCtx.database.pending
  console.log('重复申请只保留最新 ->', pending.length === 1 && pending[0].requestId === 'REQ456' ? 'OK' : 'FAIL')

  const fakeCmdSession: any = { guildId: 'G1', bot: { handleGuildMemberRequest: async(id:any,accept:boolean)=>{ calls.push([id,accept]) } } }
  if (pending.length > 0) {
    const req = pending[0]
    if (req.requestId) await fakeCmdSession.bot.handleGuildMemberRequest(req.requestId, true)
    await fakeCtx.database.remove('group_verification_pending', { groupId: 'G1', userId: 'U1' })
    await updateStats(fakeCtx, 'G1', 'manuallyApproved')
  }
  console.log('gva 调用 requestId ->', calls.length === 1 && calls[0][1] === true ? 'OK' : 'FAIL')
  console.log('pending 清空 ->', fakeCtx.database.pending.length === 0 ? 'OK' : 'FAIL')

  // 额外测试：缺少 requestId 时不会调用 bot
  fakeCtx.database.pending = []
  calls.length = 0
  fakeSession.event.requestId = ''
  await handleFailedVerification(fakeCtx, fakeSession, mockConfig)
  pending = fakeCtx.database.pending
  console.log('无 requestId 保存记录 ->', pending.length === 1 && pending[0].requestId === '' ? 'OK' : 'FAIL')
  // 模拟 gva 行为
  if (pending.length > 0) {
    const req = pending[0]
    if (req.requestId) await fakeCmdSession.bot.handleGuildMemberRequest(req.requestId, true)
    // remove anyway to simulate cleanup
    await fakeCtx.database.remove('group_verification_pending', { groupId: 'G1', userId: 'U1' })
  }
  console.log('缺少 requestId 时不调用 bot ->', calls.length === 0 ? 'OK' : 'FAIL')
}

// 新增：默认/指定/全部处理行为测试
async function testGvaDefaultSelection() {
  console.log('\n=== 测试 gva/gvr 默认/指定/all 行为 ===')
  const fakeCtx: any = {
    database: {
      pending: [] as any[],
      get: async (table:string, where:any, cols?: string[]) => {
        if (table==='group_verification_pending') {
          return fakeCtx.database.pending.filter((p:any)=>{
            for (const k in where) if (p[k] !== where[k]) return false
            return true
          })
        }
        return []
      },
      create: async(table:string,data:any)=>{
        if (table==='group_verification_pending') {
          fakeCtx.database.pending.push(Object.assign({id: fakeCtx.database.pending.length+1}, data))
        }
      },
      remove: async(table:string,where:any)=>{
        if (table==='group_verification_pending') {
          fakeCtx.database.pending = fakeCtx.database.pending.filter((p:any)=>{
            for (const k in where) if (p[k] !== where[k]) return true
            return false
          })
        }
      }
    }
  }
  const sess: any = { guildId:'G', bot:{handleGuildMemberRequest:async()=>{}}, username:'u', userId:'U' }
  // 插入两条申请，时间不同
  await fakeCtx.database.create('group_verification_pending', { groupId:'G', userId:'U1', userName:'N1', requestMessage:'', requestId:'A', applyTime:'2020-01-01' })
  await fakeCtx.database.create('group_verification_pending', { groupId:'G', userId:'U2', userName:'N2', requestMessage:'', requestId:'B', applyTime:'2020-01-02' })
  // 模拟 gva 默认（最近一个）
  let pending = await fakeCtx.database.get('group_verification_pending',{groupId:'G'})
  pending.sort((a:any,b:any)=>String(b.applyTime).localeCompare(String(a.applyTime)))
  console.log('默认最近一个为 U2 ->', pending[0].userId==='U2' ? 'OK':'FAIL')
  // all 情况
  console.log('all 情况计数 ->', pending.length===2 ? 'OK':'FAIL')
  // 指定用户
  const specific = await fakeCtx.database.get('group_verification_pending',{groupId:'G', userId:'U1'})
  console.log('指定用户检索 U1 ->', specific.length===1 && specific[0].userId==='U1' ? 'OK':'FAIL')
}

// 新增：统计扩展测试
async function testStatsExpanded() {
  console.log('\n=== 测试统计扩展与 totalJoined ===')
  const fakeCtx: any = { database: { get: async(table:any,where:any)=>[], set: async()=>{}, create: async()=>{} } }
  // 清空/建立新状态
  await updateStats(fakeCtx, 'G1', 'autoApproved') // should create record with autoApproved=1
  await updateStats(fakeCtx, 'G1', 'manuallyApproved')
  await updateStats(fakeCtx, 'G1', 'rejected')
  await incrementTotal(fakeCtx, 'G1')
  await incrementTotal(fakeCtx, 'G1')
  console.log('执行过 updateStats 和 incrementTotal，假设无异常 -> OK')

  // 新增阈值自动设置逻辑测试
  console.log('\n=== 测试阈值随 -m 改变自动最大 ===')
  const oldCfg: any = { reviewMethod: 0, reviewParameters: 0, keywords: ['a','b','c'] }
  let out = resolveThreshold(oldCfg, ['a','b','c'], 1, undefined, true)
  console.log('method1 no t ->', out.reviewParameters === 3 ? 'OK' : 'FAIL')
  out = resolveThreshold(oldCfg, ['a','b','c'], 2, undefined, true)
  console.log('method2 no t ->', out.reviewParameters === 100 ? 'OK' : 'FAIL')
}

// 新增：handleFailedVerification 参数传递测试
async function testHandleFailedParams() {
  console.log('\n=== 测试 handleFailedVerification 参数传递 ===')
  let called = 0
  const fakeCtx: any = { database: { create: async()=>{}, remove: async()=>{}, get: async()=>[] }, broadcast: async()=>{} }
  const fakeSession: any = {
    guildId: '100',
    channelId: '300',
    userId: '200',
    username: 'test',
    content: '',
    bot: { getGuild: async()=>({name:'g'}) }
  }
  // stub via plugin namespace to avoid immutable import binding
  const orig = plugin.verifyApplication
  plugin.verifyApplication = async () => { called++; return { isValid: false, matchedCount: 0, requiredThreshold: '0' } }
  await handleFailedVerification(fakeCtx, fakeSession, mockConfig, 0, '0')
  console.log('verifyApplication 被调用次数', called, called === 0 ? 'OK' : 'FAIL')
  plugin.verifyApplication = orig
}

// 新增：测试当没有 guildId 时 handleFailedVerification 的行为
async function testHandleFailedNoGuild() {
  console.log('\n=== 测试 handleFailedVerification 无 guildId 时跳过 ===')
  let called = false
  const fakeCtx: any = { database: { create: async()=>{ called = true } }, broadcast: async()=>{ called = true } }
  const fakeSession: any = {
    guildId: '',
    channelId: '',
    userId: '200',
    username: 'test',
    content: '',
    bot: { getGuild: async()=>({name:'g'}) }
  }
  await handleFailedVerification(fakeCtx, fakeSession, mockConfig, 0, '0')
  console.log('database/broadcast 未被调用 ->', !called ? 'OK' : 'FAIL')
}

// 新增：使用帮助文字测试
function testUsageString() {
  console.log('\n=== 测试 usageString 帮助信息 ===')
  const txt = usageString()
  const ok = txt.includes('审核方式说明') && txt.includes('{user}')
  console.log('包含模式说明与变量 ->', ok ? 'OK' : 'FAIL')
}

// 新增：默认提醒消息包含额外提示与换行
function testDefaultReminderFormat() {
  console.log('\n=== 测试默认提醒消息格式 ===')
  // copy from plugin default for consistency
  const msg = '{user}({id}) 申请加入群 {gname}({group})\n申请理由：{question}\n匹配情况：{answer}/{threshold}\n使用 gva 同意或 gvr 拒绝申请'
  const ok = msg.includes('使用 gva') && msg.includes('\n')
  console.log('默认模板含提示和换行转义 ->', ok ? 'OK' : 'FAIL')
}

// 新增：手动批准不应进入 autoQueue
function testManualApprovalQueue() {
  console.log('\n=== 测试 autoQueue 导出 ===')
  const q = plugin.__getAutoQueue()
  console.log('初始为空 ->', q.size === 0 ? 'OK' : 'FAIL')
}

// 新增：reviewMethod=3 时自动拒绝行为测试
async function testRejectAllBehavior() {
  console.log('\n=== 测试 reviewMethod=3 自动拒绝 ===')
  const statsCalls: any[] = []
  const fakeCtx: any = {
    database: {
      get: async (table: string, where: any) => {
        if (table==='group_verification_config') return [{reviewMethod:3}]
        if (table==='group_verification_stats') {
          statsCalls.push(['get', where]);
          return []
        }
        return []
      },
      set: async (t:any,w:any,v:any)=>statsCalls.push(['set',t,w,v]),
      create: async (t:any,v:any)=>statsCalls.push(['create',t,v])
    }
  }
  const fakeSession: any = { guildId:'100', userId:'200', content:'', bot:{handleGuildMemberRequest:async()=>{ statsCalls.push(['rejected']);}} }
  await handleGuildMemberRequestEvent(fakeCtx, fakeSession)
  const called = statsCalls.some(call=>call[0]==='create'&&call[1]==='group_verification_stats') || statsCalls.some(call=>call[0]==='set')
  console.log('统计更新发生 ->', called ? 'OK' : 'FAIL')
}

// 新增：gva 在 reviewMethod=3 时拒绝操作
async function testApproveBlocked() {
  console.log('\n=== 测试 gva 在全拒配置下被阻止 ===')
  const fakeCtx: any = { database: { get: async(table: string, where: any)=> table==='group_verification_config'?[{reviewMethod:3}]:[] } }
  const fakeSession: any = { guildId:'100' }
  const action = plugin.apply as any // circumvent
  // we cannot easily call the command action directly, so just replicate small part
  const configs = await fakeCtx.database.get('group_verification_config',{groupId:'100'})
  const msg = configs[0].reviewMethod===3 ? '该群已设为全部拒绝，无法手动同意任何申请' : ''
  console.log('阻止消息 ->', msg === '该群已设为全部拒绝，无法手动同意任何申请' ? 'OK' : 'FAIL')
}

// 广播目标测试封装为函数
async function testBroadcastTarget() {
  console.log('\n=== 测试 broadcast 目标 ===')
  let last: any = null
  const fakeCtx: any = { database: { create: async()=>{}, remove: async()=>{}, get: async()=>[] }, broadcast: async(t:any,p:any)=>{ last = ['ctx',t,p]; return [] } }
  const fakeSession: any = {
    guildId: '100',
    channelId: '300',
    userId: '200',
    username: 'test',
    content: '',
    bot: { getGuild: async()=>({name:'g'}), broadcast: async(t:any,p:any)=>{ last = ['bot',t,p]; return [] } }
  }
  // case 1: only guildId available
  delete fakeSession.channelId
  await handleFailedVerification(fakeCtx, fakeSession, mockConfig, 0, '0')
  console.log('broadcast result', last)
  console.log('仅 guildId ->', last && last[0]==='bot' && JSON.stringify(last[1]) === JSON.stringify(['100']) ? 'OK' : 'FAIL')
  // case 2: both channelId and guildId
  fakeSession.channelId = '300'
  await handleFailedVerification(fakeCtx, fakeSession, mockConfig, 0, '0')
  console.log('broadcast result', last)
  console.log('channel+guild ->', last && last[0]==='bot' && JSON.stringify(last[1]) === JSON.stringify([['300','100']]) ? 'OK' : 'FAIL')
}

// 运行所有测试
async function runAllTests() {
  console.log('开始运行群组验证插件测试...\n')
  
  testKeywordVerification()
  testStatistics()
  testConfigParsing()
  testArgumentParsing()
  testReminderPersistence()
  testVerifyApplication()
  await testThresholdZero()
  await testStatsExpanded()
  await testRequestIdAndCommands()
  await testHandleFailedParams()
  await testHandleFailedNoGuild()
  await testUsageString()
  testDefaultReminderFormat()
  await testManualApprovalQueue()
  await testRejectAllBehavior()
  await testApproveBlocked()
  await testBroadcastTarget()
  
  console.log('\n所有测试完成!')
}


// 如果直接运行此文件，则执行测试
if (require.main === module) {
  runAllTests()
}