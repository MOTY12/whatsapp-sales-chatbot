import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createConnection, createServer, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecureContext, rootCertificates, TLSSocket } from 'node:tls';
import { DataSource } from 'typeorm';
import { databaseConfig } from '../../src/config/env';
import { integrationConfig } from './postgres';

describe('PostgreSQL TLS policy', () => {
  it('queries real PostgreSQL through trusted TLS and rejects an untrusted certificate or the wrong hostname', async () => {
    const control = integrationConfig(process.env);
    const directory = mkdtempSync(join(tmpdir(), 'kleva-db-tls-'));
    const sockets = new Set<Socket>();
    const certPath = join(directory, 'certificate.pem');
    const keyPath = join(directory, 'key.pem');
    const server = createServer();
    let certificate: Buffer;
    function track(socket: Socket) {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
    }

    try {
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=127.0.0.1',
          '-addext',
          'subjectAltName=IP:127.0.0.1',
          '-keyout',
          keyPath,
          '-out',
          certPath,
        ],
        { stdio: 'ignore' },
      );
      certificate = readFileSync(certPath);
      const secureContext = createSecureContext({
        cert: certificate,
        key: readFileSync(keyPath),
      });

      // Terminate the PostgreSQL TLS handshake locally, then relay the wire
      // protocol to the existing disposable PostgreSQL service.
      server.on('connection', (socket) => {
        track(socket);
        socket.once('readable', () => {
          const request = socket.read(8) as Buffer | null;
          if (
            request?.readUInt32BE(0) !== 8 ||
            request.readUInt32BE(4) !== 80877103
          ) {
            socket.destroy();
            return;
          }
          socket.write('S');
          const secure = new TLSSocket(socket, {
            isServer: true,
            secureContext,
          });
          track(secure);
          const upstream = control.host?.startsWith('/')
            ? createConnection(
                join(control.host, `.s.PGSQL.${control.port ?? 5432}`),
              )
            : createConnection({
                host: control.host,
                port: control.port ?? 5432,
              });
          track(upstream);
          secure.once('close', () => upstream.destroy());
          upstream.once('close', () => secure.destroy());
          secure.pipe(upstream).pipe(secure);
        });
      });

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Expected a TCP port for the TLS fixture.');
      const env = {
        NODE_ENV: 'production',
        DATABASE_HOST: '127.0.0.1',
        DATABASE_PORT: String(address.port),
        DATABASE_USER: control.username,
        DATABASE_PASSWORD:
          typeof control.password === 'string' ? control.password : undefined,
        DATABASE_NAME: String(control.database),
        DATABASE_SSL_CA: certificate.toString().replaceAll('\n', '\\n'),
      };

      const trusted = new DataSource(databaseConfig(env));
      await trusted.initialize();
      try {
        await expect(trusted.query('SELECT 1 AS ready')).resolves.toEqual([
          { ready: 1 },
        ]);
      } finally {
        await trusted.destroy();
      }

      const untrusted = new DataSource(
        databaseConfig({
          ...env,
          DATABASE_SSL_CA: rootCertificates[0],
        }),
      );
      await expect(untrusted.initialize()).rejects.toMatchObject({
        code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
      });

      const wrongHost = new DataSource({
        ...databaseConfig({ ...env, DATABASE_HOST: 'wrong.example.test' }),
        host: '127.0.0.1', // Route to the fixture while verifying the configured identity.
      });
      await expect(wrongHost.initialize()).rejects.toMatchObject({
        code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
