import { createServer, type Server } from 'node:net';
import type { Socket } from 'node:net';

export async function startSmtpFixture(onMessage?: (message: string) => void) {
  const messages: string[] = [];
  const sessions = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sessions.add(socket);
    socket.write('220 smtp-fixture ESMTP\r\n');
    let pending = '';
    let data = '';
    let inData = false;
    socket.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      while (true) {
        if (inData) {
          const end = pending.indexOf('\r\n.\r\n');
          if (end < 0) {
            data += pending;
            pending = '';
            break;
          }
          data += pending.slice(0, end);
          const message = data.replace(/\r\n\.\./g, '\r\n.');
          messages.push(message);
          onMessage?.(message);
          pending = pending.slice(end + 5);
          data = '';
          inData = false;
          socket.write('250 message accepted\r\n');
          continue;
        }
        const end = pending.indexOf('\r\n');
        if (end < 0) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const command = line.toUpperCase();
        if (command.startsWith('EHLO') || command.startsWith('HELO'))
          socket.write(
            '250-smtp-fixture\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1048576\r\n',
          );
        else if (command.startsWith('AUTH'))
          socket.write('235 authenticated\r\n');
        else if (
          command.startsWith('MAIL FROM') ||
          command.startsWith('RCPT TO')
        )
          socket.write('250 accepted\r\n');
        else if (command === 'DATA') {
          inData = true;
          socket.write('354 end with dot\r\n');
        } else if (command === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 ok\r\n');
      }
    });
    socket.on('close', () => sessions.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected SMTP test fixture port.');
  return {
    port: address.port,
    messages,
    async close() {
      for (const session of sessions) session.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
