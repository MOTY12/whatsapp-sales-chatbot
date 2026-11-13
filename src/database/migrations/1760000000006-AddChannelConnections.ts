import { Logger } from '@nestjs/common';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChannelConnections1760000000006 implements MigrationInterface {
  name = 'AddChannelConnections1760000000006';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      LOCK TABLE public.businesses IN SHARE MODE;
      CREATE TABLE public.channel_connections (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "businessId" uuid NOT NULL,
        provider varchar NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{0,31}$'),
        "externalAccountId" varchar,
        "externalAssetId" varchar NOT NULL CHECK ("externalAssetId" ~ '^[^[:space:][:cntrl:]]{1,255}$'),
        "displayName" varchar,
        status varchar NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive')),
        "verifiedAt" timestamptz,
        "legacyBackfill" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_channel_connections_business" FOREIGN KEY ("businessId")
          REFERENCES public.businesses(id) ON DELETE RESTRICT,
        CONSTRAINT "CHK_channel_connections_verified" CHECK (
          status <> 'active' OR (
            "verifiedAt" IS NOT NULL AND
            (provider <> 'whatsapp' OR (
              "externalAccountId" IS NOT NULL AND
              "externalAccountId" ~ '^[^[:space:][:cntrl:]]{1,255}$'
            ))
          )
        )
      );
      CREATE UNIQUE INDEX "UQ_channel_connections_provider_asset"
        ON public.channel_connections (provider, "externalAssetId");
      CREATE INDEX "IDX_channel_connections_business" ON public.channel_connections ("businessId");
      CREATE INDEX "IDX_businesses_legacy_asset_key" ON public.businesses (btrim("phoneNumberId"))
        WHERE "phoneNumberId" IS NOT NULL;

      ALTER TABLE public.channel_connections ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.channel_connections FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_channel_internal ON public.channel_connections
        USING (current_user::text !~ '^kleva_(merchant|identity)_')
        WITH CHECK (current_user::text !~ '^kleva_(merchant|identity)_');

      CREATE FUNCTION public.kleva_guard_channel_asset()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF TG_OP = 'UPDATE' AND
          ROW(NEW."businessId", NEW.provider, NEW."externalAssetId")
            IS DISTINCT FROM ROW(OLD."businessId", OLD.provider, OLD."externalAssetId") THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Channel asset ownership is immutable';
        END IF;
        IF NEW.provider = 'whatsapp' AND EXISTS (
          SELECT 1 FROM public.businesses b
          WHERE b."phoneNumberId" IS NOT NULL AND btrim(b."phoneNumberId") = NEW."externalAssetId"
            AND b.id <> NEW."businessId"
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Channel asset conflicts with legacy ownership';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER kleva_guard_channel_asset BEFORE INSERT OR
        UPDATE OF "businessId", provider, "externalAssetId" ON public.channel_connections
        FOR EACH ROW EXECUTE FUNCTION public.kleva_guard_channel_asset();
    `);
    await this.backfill(runner);
  }

  async backfill(runner: QueryRunner): Promise<void> {
    await runner.query(`
      WITH legacy AS (
        SELECT *, btrim("phoneNumberId") AS asset,
          count(*) OVER (PARTITION BY btrim("phoneNumberId")) AS owner_count
        FROM public.businesses WHERE "phoneNumberId" IS NOT NULL
      )
      INSERT INTO public.channel_connections (
        "businessId", provider, "externalAccountId", "externalAssetId", "displayName", status, "verifiedAt", "legacyBackfill"
      )
      SELECT id, 'whatsapp', btrim("wabaId"), asset, "displayPhoneNumber", 'active',
        "connectedAt" AT TIME ZONE 'UTC', true
      FROM legacy
      WHERE owner_count = 1 AND status = 'active' AND asset = "phoneNumberId"
        AND asset ~ '^[^[:space:][:cntrl:]]{1,255}$'
        AND btrim("wabaId") ~ '^[^[:space:][:cntrl:]]{1,255}$'
        AND "connectedAt" IS NOT NULL AND btrim("accessToken") <> ''
        AND NOT EXISTS (
          SELECT 1 FROM public.channel_connections c
          WHERE c.provider = 'whatsapp' AND c."externalAssetId" = legacy.asset
        )
      ON CONFLICT (provider, "externalAssetId") DO NOTHING;
    `);
    const [report] = await runner.manager.query<{ conflicts: number }[]>(`
      SELECT count(*)::int AS conflicts FROM (
        SELECT btrim("phoneNumberId")
        FROM public.businesses
        WHERE "phoneNumberId" IS NOT NULL
        GROUP BY btrim("phoneNumberId")
        HAVING count(*) > 1
        UNION
        SELECT c."externalAssetId"
        FROM public.channel_connections c
        JOIN public.businesses b ON btrim(b."phoneNumberId") = c."externalAssetId"
        WHERE c.provider = 'whatsapp' AND b.id <> c."businessId"
      ) conflicts
    `);
    if (report.conflicts) {
      new Logger(this.name).warn(
        'Channel backfill skipped or fenced conflicting WhatsApp asset mappings.',
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP TABLE public.channel_connections;
      DROP FUNCTION public.kleva_guard_channel_asset();
      DROP INDEX public."IDX_businesses_legacy_asset_key";
    `);
  }
}
