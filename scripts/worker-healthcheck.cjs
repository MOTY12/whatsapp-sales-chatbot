const { stat } = require('node:fs/promises');

async function check() {
  try {
    const heartbeat = await stat('/tmp/kleva-worker-heartbeat');
    process.exit(Date.now() - heartbeat.mtimeMs < 30_000 ? 0 : 1);
  } catch {
    process.exit(1);
  }
}

void check();
