/** Asia/Shanghai calendar day key YYYY-MM-DD */
export function todayKey(now = Date.now()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(now));
}
