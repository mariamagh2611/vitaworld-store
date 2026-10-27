export function instrument(db: D1Database) {
  const counters = { reads: 0, writes: 0 };
  const originals = new WeakMap<object, D1PreparedStatement>();
  const count = (result: D1Result) => {
    counters.reads += result.meta?.rows_read || 0;
    counters.writes += result.meta?.rows_written || 0;
    return result;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, key) {
        if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
        if (key === 'first')
          return async (column?: string) => {
            const r = count(await target.all<Record<string, unknown>>());
            const row = (r.results[0] || null) as Record<string, unknown> | null;
            return column ? (row?.[column] ?? null) : row;
          };
        if (key === 'all' || key === 'run') return async () => count(await target[key]());
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };
  const tracked = new Proxy(db, {
    get(target, key) {
      if (key === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (key === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          const rows = await target.batch(statements.map((s) => originals.get(s) || s));
          rows.forEach(count);
          return rows;
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    db: tracked,
    counters,
    async flush() {
      if (!counters.reads && !counters.writes) return;
      await db
        .prepare(
          'INSERT INTO metrics(date,reads,writes) VALUES(?,?,?) ON CONFLICT(date) DO UPDATE SET reads=reads+excluded.reads,writes=writes+excluded.writes',
        )
        .bind(new Date().toISOString().slice(0, 10), counters.reads, counters.writes + 1)
        .run();
    },
  };
}
