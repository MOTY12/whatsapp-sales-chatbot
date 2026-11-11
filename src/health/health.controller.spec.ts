import type { DataSource } from 'typeorm';
import { DatabaseReadiness } from './health.controller';

it('bounds readiness and shares one pending database probe until it settles', async () => {
  jest.useFakeTimers();
  try {
    let complete!: () => void;
    const query = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const readiness = new DatabaseReadiness({ query } as unknown as DataSource);
    const first = readiness.check();
    const second = readiness.check();
    await jest.advanceTimersByTimeAsync(1000);
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(query).toHaveBeenCalledTimes(1);

    const recovered = readiness.check();
    complete();
    await expect(recovered).resolves.toBe(true);
    query.mockResolvedValue(undefined);
    await expect(readiness.check()).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
