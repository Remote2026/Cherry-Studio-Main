/**
 * 内网版使用期限闸门：只允许 2026、2027 两个自然年启动。
 *
 * 按本机系统时间判断，超过期限直接静默退出。属于 preboot 阶段的不可移除步骤：
 * 必须在任何用户数据被读取、任何服务启动之前执行。
 */

import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('UsageWindow')

/** 从这一年的 1 月 1 日起拒绝启动。 */
const EXPIRY_YEAR = 2028

export function enforceUsageWindow(): void {
  const now = new Date()
  if (now.getFullYear() < EXPIRY_YEAR) return

  logger.error(`Usage window expired: current date ${now.toISOString()}, allowed only through 2027`)
  application.forceExit(0)
}
