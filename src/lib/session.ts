/** US equity session from the clock alone; exchange holidays are not accounted for. */
export function session(now: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const mins = Number(p.hour) * 60 + Number(p.minute);
  const weekday = p.weekday !== "Sat" && p.weekday !== "Sun";
  const state =
    !weekday || mins < 240 || mins >= 1200
      ? "Closed"
      : mins < 570
        ? "Pre-market"
        : mins < 960
          ? "Market open"
          : "After hours";
  return { state, time: `${p.hour}:${p.minute} ET` } as const;
}
