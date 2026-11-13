import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  ChannelAsset,
  ChannelConnectionResolver,
  ResolvedChannel,
} from './channel.contracts';

@Injectable()
export class ChannelConnectionService implements ChannelConnectionResolver {
  constructor(@InjectDataSource() private readonly database: DataSource) {}

  async resolve({ provider, externalAssetId }: ChannelAsset) {
    if (!/^[^\s\p{Cc}]{1,255}$/u.test(externalAssetId)) return null;

    // Read both mappings in one statement so a signup update cannot split
    // ownership checks across database snapshots.
    const [route] = await this.database.query<ResolvedChannel[]>(
      `
      WITH connections AS (
        SELECT c.id AS "connectionId", c."businessId", c."externalAccountId",
          c.status, c."verifiedAt", c."legacyBackfill", b.status AS business_status,
          (w.business_id IS NULL OR (w.connection_id = c.id AND w.envelope IS NOT NULL
            AND (w.expires_at IS NULL OR w.expires_at > now()))) AS credential_eligible
        FROM public.channel_connections c
        JOIN public.businesses b ON b.id = c."businessId"
        LEFT JOIN public.whatsapp_credentials w ON w.business_id = b.id AND c.provider = 'whatsapp'
        WHERE c.provider = $1 AND c."externalAssetId" = $2
      ), legacy AS (
        SELECT id AS "businessId", btrim("wabaId") AS "externalAccountId",
          ("phoneNumberId" = $2 AND status = 'active'
           AND btrim("wabaId") ~ '^[^[:space:][:cntrl:]]{1,255}$'
           AND "connectedAt" IS NOT NULL AND btrim("accessToken") <> '') AS eligible
        FROM public.businesses b
        WHERE $1 = 'whatsapp' AND "phoneNumberId" IS NOT NULL
          AND btrim("phoneNumberId") = $2
      )
      SELECT $1 AS provider, $2 AS "externalAssetId", c."businessId",
        c."connectionId", c."externalAccountId", 'connection' AS source
      FROM connections c
      WHERE c.status = 'active' AND c."verifiedAt" IS NOT NULL
        AND c.business_status = 'active' AND c.credential_eligible
        AND (NOT c."legacyBackfill" OR EXISTS (
          SELECT 1 FROM legacy l WHERE l."businessId" = c."businessId" AND l.eligible
            AND l."externalAccountId" = c."externalAccountId"
        ))
        AND NOT EXISTS (SELECT 1 FROM legacy l WHERE l."businessId" <> c."businessId")
      UNION ALL
      SELECT $1, $2, l."businessId", NULL::uuid, l."externalAccountId", 'legacy'
      FROM legacy l
      WHERE l.eligible AND (SELECT count(*) FROM legacy) = 1
        AND NOT EXISTS (SELECT 1 FROM connections)
        AND NOT EXISTS (SELECT 1 FROM public.whatsapp_credentials w WHERE w.business_id = l."businessId")
      `,
      [provider, externalAssetId],
    );
    return route ?? null;
  }
}
