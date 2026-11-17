import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type * as Oidc from 'openid-client';
import { oidcEnvironmentDiagnostics } from '../config/env';
import {
  MERCHANT_AUTH_CONFIG,
  type MerchantAuthConfig,
} from './merchant-database';

export class OidcStageFailure extends Error {
  constructor(
    readonly category: string,
    readonly providerCode?: string,
  ) {
    super(category);
    this.name = 'OidcStageFailure';
  }
}

type OidcConfiguration = NonNullable<MerchantAuthConfig> & {
  issuer: URL;
  redirect: URL;
  clientId: string;
  clientSecret: string;
};

@Injectable()
export class MerchantOidcClient {
  private readonly logger = new Logger(MerchantOidcClient.name);
  private readonly callbackStage = new AsyncLocalStorage<{
    tokenEndpointAttempted: boolean;
    tokenEndpointSucceeded: boolean;
  }>();
  private discovery?: Promise<{
    client: typeof Oidc;
    configuration: Oidc.Configuration;
  }>;
  private configurationLogged = false;

  constructor(
    @Inject(MERCHANT_AUTH_CONFIG) private readonly config: MerchantAuthConfig,
  ) {}

  private provider() {
    if (
      !this.config?.issuer ||
      !this.config.clientId ||
      !this.config.clientSecret ||
      !this.config.redirect
    )
      throw new ServiceUnavailableException(
        'Merchant authentication is unavailable.',
      );
    if (!this.configurationLogged) {
      this.configurationLogged = true;
      this.logger.log({
        event: 'merchant_auth.oidc_configuration',
        ...oidcEnvironmentDiagnostics(),
        tokenEndpointAuthenticationMethod: 'client_secret_basic',
      });
    }
    const settings: OidcConfiguration = {
      ...this.config,
      issuer: this.config.issuer,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirect: this.config.redirect,
    };
    this.discovery ??= this.discover(settings).catch((error: unknown) => {
      this.discovery = undefined;
      throw new OidcStageFailure(
        'OIDC_DISCOVERY_FAILED',
        this.providerErrorCode(error),
      );
    });
    return this.discovery;
  }

  private async discover(settings: OidcConfiguration) {
    const client = await import('openid-client');
    const local = settings.issuer.protocol === 'http:';
    let tokenEndpoint = '';
    const configuration = await client.discovery(
      settings.issuer,
      settings.clientId,
      { id_token_signed_response_alg: 'RS256' },
      client.ClientSecretBasic(settings.clientSecret),
      {
        execute: local ? [client.allowInsecureRequests] : [],
        timeout: 5,
        [client.customFetch]: async (url, options) => {
          const stage = this.callbackStage.getStore();
          const isTokenEndpoint =
            tokenEndpoint && new URL(url).href === tokenEndpoint;
          if (stage && isTokenEndpoint) stage.tokenEndpointAttempted = true;
          const response = await fetch(url, {
            ...options,
            body:
              options.body instanceof Uint8Array
                ? Uint8Array.from(options.body)
                : options.body,
            redirect: 'error',
          });
          if (stage && isTokenEndpoint && response.ok) {
            stage.tokenEndpointSucceeded = true;
          }
          return response;
        },
      },
    );
    const metadata = configuration.serverMetadata();
    tokenEndpoint = metadata.token_endpoint ?? '';
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
      scope: 'openid email profile',
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
    const stage = {
      tokenEndpointAttempted: false,
      tokenEndpointSucceeded: false,
    };
    return this.callbackStage.run(stage, async () => {
      let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
      try {
        tokens = await client.authorizationCodeGrant(configuration, url, {
          expectedState: state,
          expectedNonce: nonce,
          pkceCodeVerifier: verifier,
          idTokenExpected: true,
        });
      } catch (error) {
        throw new OidcStageFailure(
          stage.tokenEndpointSucceeded
            ? 'OIDC_ID_TOKEN_INVALID'
            : stage.tokenEndpointAttempted
              ? 'OIDC_TOKEN_EXCHANGE_FAILED'
              : 'OIDC_CALLBACK_VALIDATION_FAILED',
          this.providerErrorCode(error, client),
        );
      }
      const claims = tokens.claims();
      if (
        !claims ||
        !claims.sub ||
        claims.iss !== configuration.serverMetadata().issuer
      ) {
        throw new OidcStageFailure('OIDC_ID_TOKEN_INVALID');
      }
      const email = typeof claims.email === 'string' ? claims.email : undefined;
      const fullName =
        typeof claims.name === 'string'
          ? claims.name
          : [claims.given_name, claims.family_name]
              .filter((part): part is string => typeof part === 'string')
              .join(' ');
      return {
        issuer: claims.iss,
        subject: claims.sub,
        email,
        fullName: fullName || undefined,
        emailVerified: claims.email_verified === true,
      };
    });
  }

  private providerErrorCode(error: unknown, client?: typeof Oidc) {
    if (
      client &&
      error instanceof client.ResponseBodyError &&
      /^[a-z][a-z0-9_]{1,39}$/.test(error.error)
    ) {
      return error.error;
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z0-9_]{4,40}$/.test(error.code)
    ) {
      return error.code;
    }
    return undefined;
  }
}
