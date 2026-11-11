import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type * as Oidc from 'openid-client';
import {
  MERCHANT_AUTH_CONFIG,
  type MerchantAuthConfig,
} from './merchant-database';

@Injectable()
export class MerchantOidcClient {
  private discovery?: Promise<{
    client: typeof Oidc;
    configuration: Oidc.Configuration;
  }>;

  constructor(
    @Inject(MERCHANT_AUTH_CONFIG) private readonly config: MerchantAuthConfig,
  ) {}

  private provider() {
    if (!this.config)
      throw new ServiceUnavailableException(
        'Merchant authentication is unavailable.',
      );
    const settings = this.config;
    this.discovery ??= this.discover(settings).catch(() => {
      this.discovery = undefined;
      throw new ServiceUnavailableException(
        'Identity provider is unavailable.',
      );
    });
    return this.discovery;
  }

  private async discover(settings: NonNullable<MerchantAuthConfig>) {
    const client = await import('openid-client');
    const local = settings.issuer.protocol === 'http:';
    const configuration = await client.discovery(
      settings.issuer,
      settings.clientId,
      { id_token_signed_response_alg: 'RS256' },
      client.ClientSecretBasic(settings.clientSecret),
      {
        execute: local ? [client.allowInsecureRequests] : [],
        timeout: 5,
        [client.customFetch]: (url, options) =>
          fetch(url, {
            ...options,
            body:
              options.body instanceof Uint8Array
                ? Uint8Array.from(options.body)
                : options.body,
            redirect: 'error',
          }),
      },
    );
    const metadata = configuration.serverMetadata();
    if (
      new URL(metadata.issuer).href !== settings.issuer.href ||
      (metadata.code_challenge_methods_supported &&
        !metadata.code_challenge_methods_supported.includes('S256'))
    ) {
      throw new Error('Invalid provider metadata.');
    }
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.jwks_uri,
    ]) {
      if (!endpoint) throw new Error('Missing provider endpoint.');
      const url = new URL(endpoint);
      if (
        url.username ||
        url.password ||
        url.hash ||
        (url.protocol !== 'https:' &&
          (!local || url.origin !== settings.issuer.origin))
      ) {
        throw new Error('Invalid provider endpoint.');
      }
    }
    client.enableNonRepudiationChecks(configuration);
    return { client, configuration };
  }

  async authorizationUrl(
    redirect: URL,
    state: string,
    nonce: string,
    verifier: string,
  ) {
    const { client, configuration } = await this.provider();
    return client.buildAuthorizationUrl(configuration, {
      redirect_uri: redirect.href,
      scope: 'openid',
      response_type: 'code',
      state,
      nonce,
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    });
  }

  async verifyCallback(
    url: URL,
    state: string,
    nonce: string,
    verifier: string,
  ) {
    const { client, configuration } = await this.provider();
    const tokens = await client.authorizationCodeGrant(configuration, url, {
      expectedState: state,
      expectedNonce: nonce,
      pkceCodeVerifier: verifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (
      !claims ||
      !claims.sub ||
      claims.iss !== configuration.serverMetadata().issuer
    ) {
      throw new Error('Missing verified identity.');
    }
    return { issuer: claims.iss, subject: claims.sub };
  }
}
