export interface DateRange {
  start: Date;
  end: Date;
}

export function businessDayRange(date: Date, timezone: string): DateRange {
  const local = localDateParts(date, timezone);
  const start = zonedMidnightToUtc(
    local.year,
    local.month,
    local.day,
    timezone,
  );
  const nextLocalDay = new Date(
    Date.UTC(local.year, local.month - 1, local.day + 1),
  );
  const end = new Date(
    zonedMidnightToUtc(
      nextLocalDay.getUTCFullYear(),
      nextLocalDay.getUTCMonth() + 1,
      nextLocalDay.getUTCDate(),
      timezone,
    ).getTime() - 1,
  );
  return { start, end };
}

export function nextBusinessDayStart(date: Date, timezone: string): Date {
  const { end } = businessDayRange(date, timezone);
  return new Date(end.getTime() + 1);
}

function localDateParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function zonedMidnightToUtc(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date {
  const target = Date.UTC(year, month - 1, day);
  let utc = target;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const date = new Date(utc);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value);
    const renderedAsUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    );
    utc = target - (renderedAsUtc - date.getTime());
  }

  return new Date(utc);
}
