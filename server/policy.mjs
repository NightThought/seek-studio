export const executionOptions = (value = {}) => ({
  model: value.model === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : 'deepseek-flash',
  safetyEnabled: value.safetyEnabled !== false,
  metadataEnabled: value.metadataEnabled === true,
  locale: value.locale === 'en-US' ? 'en-US' : 'zh-CN',
  location: typeof value.location === 'string' ? value.location.slice(0, 200) : '',
})
export const latestReminder = (options, date = new Date()) => {
  const locale = options.locale ?? 'zh-CN'
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return [
    day,
    new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Shanghai', weekday: 'long' }).format(date),
    options.location ?? '',
    'Web',
    locale === 'en-US' ? 'English' : '中文',
  ].join(',')
}
export const auditEntry = (input) => {
  if (!input || !['completed', 'refused', 'error', 'cancelled'].includes(input.status)) {
    throw new Error('Invalid audit entry')
  }
  return {
    id: typeof input.id === 'string' ? input.id.slice(0, 100) : crypto.randomUUID(),
    time: Number.isFinite(input.time) ? input.time : Date.now(),
    model: String(input.model ?? '').slice(0, 80),
    status: input.status,
    source: String(input.source ?? '').slice(0, 80),
    ...(typeof input.runId === 'string' ? { runId: input.runId.slice(0, 100) } : {}),
    ...(typeof input.requestId === 'string' ? { requestId: input.requestId.slice(0, 100) } : {}),
    ...(Number.isFinite(input.safetyTokens) ? { safetyTokens: input.safetyTokens } : {}),
  }
}
