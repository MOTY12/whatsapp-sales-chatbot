import type { MigrationInterface, QueryRunner } from 'typeorm';
import { teamFunctions } from '../merchant-access';

/** Add bounded team administration and one-time business invitations. */
export class MerchantTeamManagement1760000000034 implements MigrationInterface {
  name = 'MerchantTeamManagement1760000000034';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.business_members
        ADD COLUMN membership_version integer NOT NULL DEFAULT 1 CHECK (membership_version > 0),
        ADD COLUMN revoked_at timestamptz,
        ADD COLUMN revoked_by_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

      CREATE TABLE public.merchant_business_invitations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        recipient_email text NOT NULL CHECK (recipient_email = lower(btrim(recipient_email)) AND length(recipient_email) <= 254),
        invited_role text NOT NULL CHECK (invited_role IN ('editor','agent')),
        credential_digest text NOT NULL UNIQUE CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
        invitation_version integer NOT NULL DEFAULT 1 CHECK (invitation_version > 0),
        status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','EXPIRED','REVOKED','SUPERSEDED')),
        delivery_status text NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING','QUEUED','FAILED')),
        invited_by uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
        accepted_by uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        accepted_at timestamptz,
        revoked_at timestamptz,
        revoked_by uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
        request_key uuid NOT NULL,
        request_digest bytea NOT NULL,
        resend_count integer NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 20),
        CONSTRAINT FK_merchant_invite_business_tenant UNIQUE (business_id,id)
      );
      CREATE UNIQUE INDEX UQ_merchant_invite_request
        ON public.merchant_business_invitations(business_id, invited_by, request_key);
      CREATE UNIQUE INDEX UQ_merchant_invite_pending_email
        ON public.merchant_business_invitations(business_id, recipient_email)
        WHERE status='PENDING';
      CREATE INDEX IDX_merchant_invite_expiry
        ON public.merchant_business_invitations(expires_at) WHERE status='PENDING';
      CREATE INDEX IDX_merchant_invite_business_created
        ON public.merchant_business_invitations(business_id, created_at DESC);

      CREATE TABLE public.merchant_team_audit (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
        actor_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
        target_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
        target_id uuid,
        event_kind text NOT NULL CHECK (event_kind IN (
          'team.invitation.created','team.invitation.resent','team.invitation.revoked',
          'team.invitation.accepted','team.membership.created','team.membership.role_changed',
          'team.membership.revoked','team.membership.reactivated')),
        previous_value jsonb,
        next_value jsonb,
        correlation_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IDX_merchant_team_audit_tenant_time
        ON public.merchant_team_audit(business_id, created_at DESC, id DESC);

      CREATE TABLE public.merchant_team_invitation_attempts (
        session_digest text PRIMARY KEY CHECK (session_digest ~ '^[0-9a-f]{64}$'),
        attempts integer NOT NULL CHECK (attempts >= 0),
        window_started_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IDX_team_invitation_attempts_updated
        ON public.merchant_team_invitation_attempts(updated_at);

      ALTER TABLE public.merchant_business_invitations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_business_invitations FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_team_invitation_owner ON public.merchant_business_invitations
        USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.merchant_business_invitations'::regclass)))
        WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.merchant_business_invitations'::regclass)));
      ALTER TABLE public.merchant_team_audit ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_team_audit FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_team_audit_owner ON public.merchant_team_audit
        USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.merchant_team_audit'::regclass)))
        WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.merchant_team_audit'::regclass)));
      ALTER TABLE public.merchant_team_invitation_attempts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.merchant_team_invitation_attempts FORCE ROW LEVEL SECURITY;
      CREATE POLICY kleva_team_invite_attempts_owner ON public.merchant_team_invitation_attempts
        USING (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.merchant_team_invitation_attempts'::regclass)))
        WITH CHECK (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.merchant_team_invitation_attempts'::regclass)));

      CREATE FUNCTION public.kleva_team_members(page_size integer, page_offset integer, role_filter text, status_filter text, search_term text)
      RETURNS TABLE(membership_id uuid, account_id uuid, full_name text, email text, role text, status text,
        joined_at timestamptz, revoked_at timestamptz, membership_version integer, total_count bigint)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT m.id,m."accountId",p.full_name::text,p.email::text,m.role::text,m.status::text,
          m."createdAt",m.revoked_at,m.membership_version,
          count(*) OVER() AS total_count
        FROM public.business_members m
        LEFT JOIN public.merchant_auth_profiles p ON p.account_id=m."accountId"
        WHERE m."businessId"=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND m."accountId" IS NOT NULL AND public.kleva_current_role()='owner'
          AND (role_filter IS NULL OR m.role=role_filter)
          AND (status_filter IS NULL OR m.status=status_filter)
          AND (search_term IS NULL OR position(lower(search_term) in lower(COALESCE(p.full_name,'') || ' ' || COALESCE(p.email,'')))>0)
        ORDER BY m."createdAt",m.id LIMIT LEAST(GREATEST(page_size,1),100) OFFSET GREATEST(page_offset,0)
      $$;

      CREATE FUNCTION public.kleva_team_member(target_membership uuid)
      RETURNS TABLE(membership_id uuid, account_id uuid, full_name text, email text, role text, status text,
        joined_at timestamptz, revoked_at timestamptz, membership_version integer)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT m.id,m."accountId",p.full_name::text,p.email::text,m.role::text,m.status::text,
          m."createdAt",m.revoked_at,m.membership_version
        FROM public.business_members m LEFT JOIN public.merchant_auth_profiles p ON p.account_id=m."accountId"
        WHERE m.id=target_membership AND m."businessId"=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND m."accountId" IS NOT NULL AND public.kleva_current_role()='owner'
      $$;

      CREATE FUNCTION public.kleva_team_audit(page_size integer,page_offset integer)
      RETURNS TABLE(id uuid,actor_account_id uuid,target_account_id uuid,target_id uuid,event_kind text,
        previous_value jsonb,next_value jsonb,correlation_id text,created_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT a.id,a.actor_account_id,a.target_account_id,a.target_id,a.event_kind,
          a.previous_value,a.next_value,a.correlation_id,a.created_at
        FROM public.merchant_team_audit a
        WHERE a.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role()='owner'
        ORDER BY a.created_at DESC,a.id DESC LIMIT LEAST(GREATEST(page_size,1),100) OFFSET GREATEST(page_offset,0)
      $$;

      CREATE FUNCTION public.kleva_team_invitation_create(request_id uuid,payload_digest bytea,
        normalized_email text,target_role text,challenge_digest text,ttl_seconds integer)
      RETURNS TABLE(invitation_id uuid,outcome text,business_name text,recipient_email text,invited_role text,expires_at timestamptz)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor uuid:=public.kleva_current_account(); old public.merchant_business_invitations%ROWTYPE;
        created uuid; bname text;
      BEGIN
          IF actor IS NULL OR public.kleva_current_role()<>'owner' THEN RAISE EXCEPTION 'team access denied' USING ERRCODE='42501'; END IF;
        IF target_role NOT IN ('editor','agent') OR ttl_seconds NOT BETWEEN 300 AND 1209600
          OR normalized_email<>lower(btrim(normalized_email)) THEN RAISE EXCEPTION 'invalid invitation' USING ERRCODE='22023'; END IF;
        PERFORM 1 FROM public.businesses b WHERE b.id=tenant AND b.status='active' FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'business unavailable' USING ERRCODE='42501'; END IF;
        SELECT * INTO old FROM public.merchant_business_invitations i
          WHERE i.business_id=tenant AND i.invited_by=actor AND i.request_key=request_id;
        IF FOUND THEN
          IF old.request_digest<>payload_digest THEN RETURN QUERY SELECT NULL::uuid,'conflict',NULL::text,NULL::text,NULL::text,NULL::timestamptz; RETURN; END IF;
          SELECT b.name INTO bname FROM public.businesses b WHERE b.id=tenant;
          RETURN QUERY SELECT old.id,'replayed',bname,old.recipient_email,old.invited_role,old.expires_at; RETURN;
        END IF;
        IF EXISTS (SELECT 1 FROM public.merchant_business_invitations i WHERE i.business_id=tenant
          AND i.recipient_email=normalized_email AND i.status='PENDING' AND i.expires_at>now()) THEN
          RAISE EXCEPTION 'invitation already pending' USING ERRCODE='23505';
        END IF;
        IF EXISTS (SELECT 1 FROM public.business_members m JOIN public.merchant_auth_profiles p ON p.account_id=m."accountId"
          WHERE m."businessId"=tenant AND p.email=normalized_email AND m.status='active') THEN
          RAISE EXCEPTION 'member already active' USING ERRCODE='23505';
        END IF;
        IF (SELECT count(*) FROM public.merchant_business_invitations i WHERE i.business_id=tenant
          AND i.invited_by=actor AND i.created_at>now()-interval '1 hour')>=20 THEN
          RAISE EXCEPTION 'invitation rate limited' USING ERRCODE='53300';
        END IF;
        UPDATE public.merchant_business_invitations AS invitation
          SET status='EXPIRED',updated_at=now()
          WHERE invitation.business_id=tenant AND invitation.recipient_email=normalized_email
            AND invitation.status='PENDING' AND invitation.expires_at<=now();
        INSERT INTO public.merchant_business_invitations(business_id,recipient_email,invited_role,credential_digest,
          invited_by,expires_at,request_key,request_digest)
        VALUES(tenant,normalized_email,target_role,challenge_digest,actor,now()+make_interval(secs=>ttl_seconds),request_id,payload_digest)
        RETURNING id INTO created;
        SELECT b.name INTO bname FROM public.businesses b WHERE b.id=tenant;
        INSERT INTO public.merchant_team_audit(business_id,actor_account_id,target_id,event_kind,next_value,correlation_id)
          VALUES(tenant,actor,created,'team.invitation.created',jsonb_build_object('role',target_role,'email',normalized_email),NULLIF(current_setting('kleva.request_id',true),''));
        RETURN QUERY SELECT i.id,'created',bname,i.recipient_email,i.invited_role,i.expires_at
          FROM public.merchant_business_invitations i WHERE i.id=created;
      END $$;

      CREATE FUNCTION public.kleva_team_invitation_delivery(target_id uuid,new_status text)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
      BEGIN
        IF public.kleva_current_role()<>'owner' OR new_status NOT IN ('QUEUED','FAILED') THEN RETURN false; END IF;
        UPDATE public.merchant_business_invitations SET delivery_status=new_status,updated_at=now()
          WHERE id=target_id AND business_id=tenant AND status='PENDING';
        RETURN FOUND;
      END $$;

      CREATE FUNCTION public.kleva_team_invitations(page_size integer,page_offset integer)
      RETURNS TABLE(id uuid,recipient_email text,invited_role text,status text,delivery_status text,
        invited_by uuid,created_at timestamptz,expires_at timestamptz,resend_count integer)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
        SELECT i.id,i.recipient_email,i.invited_role,i.status,i.delivery_status,i.invited_by,i.created_at,i.expires_at,i.resend_count
        FROM public.merchant_business_invitations i WHERE i.business_id=NULLIF(current_setting('kleva.business_id',true),'')::uuid
          AND public.kleva_current_role()='owner'
        ORDER BY i.created_at DESC,i.id DESC LIMIT LEAST(GREATEST(page_size,1),100) OFFSET GREATEST(page_offset,0)
      $$;

      CREATE FUNCTION public.kleva_team_invitation_resend(target_id uuid,new_digest text,ttl_seconds integer,cooldown_seconds integer,max_resends integer)
      RETURNS TABLE(invitation_id uuid,recipient_email text,invited_role text,business_name text,expires_at timestamptz,outcome text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor uuid:=public.kleva_current_account(); invitation_row public.merchant_business_invitations%ROWTYPE; bname text;
      BEGIN
        IF actor IS NULL OR public.kleva_current_role()<>'owner' THEN RAISE EXCEPTION 'team access denied' USING ERRCODE='42501'; END IF;
        SELECT * INTO invitation_row FROM public.merchant_business_invitations i WHERE i.id=target_id AND i.business_id=tenant FOR UPDATE;
        IF NOT FOUND OR invitation_row.status NOT IN ('PENDING','EXPIRED') THEN RETURN; END IF;
        IF invitation_row.resend_count>=max_resends OR invitation_row.updated_at>now()-make_interval(secs=>cooldown_seconds) THEN
          RAISE EXCEPTION 'invitation resend limited' USING ERRCODE='53300';
        END IF;
        IF ttl_seconds NOT BETWEEN 300 AND 1209600 OR cooldown_seconds NOT BETWEEN 60 AND 86400
          OR max_resends NOT BETWEEN 1 AND 20 OR new_digest !~ '^[0-9a-f]{64}$' THEN
          RAISE EXCEPTION 'invalid invitation' USING ERRCODE='22023'; END IF;
        UPDATE public.merchant_business_invitations SET credential_digest=new_digest,invitation_version=invitation_version+1,
          status='PENDING',delivery_status='PENDING',expires_at=now()+make_interval(secs=>ttl_seconds),resend_count=resend_count+1,updated_at=now()
          WHERE id=target_id RETURNING * INTO invitation_row;
        SELECT b.name INTO bname FROM public.businesses b WHERE b.id=tenant;
        INSERT INTO public.merchant_team_audit(business_id,actor_account_id,target_id,event_kind,previous_value,next_value,correlation_id)
          VALUES(tenant,actor,target_id,'team.invitation.resent',jsonb_build_object('version',invitation_row.invitation_version-1),jsonb_build_object('version',invitation_row.invitation_version),NULLIF(current_setting('kleva.request_id',true),''));
        RETURN QUERY SELECT invitation_row.id,invitation_row.recipient_email,invitation_row.invited_role,bname,invitation_row.expires_at,'rotated';
      END $$;

      CREATE FUNCTION public.kleva_team_invitation_revoke(target_id uuid)
      RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor uuid:=public.kleva_current_account();
        target_email text;
      BEGIN
        IF actor IS NULL OR public.kleva_current_role()<>'owner' THEN RAISE EXCEPTION 'team access denied' USING ERRCODE='42501'; END IF;
        UPDATE public.merchant_business_invitations SET status='REVOKED',revoked_at=now(),revoked_by=actor,updated_at=now()
          WHERE id=target_id AND business_id=tenant AND status='PENDING' RETURNING recipient_email INTO target_email;
        IF NOT FOUND THEN RETURN false; END IF;
        INSERT INTO public.merchant_team_audit(business_id,actor_account_id,target_id,event_kind,previous_value,next_value,correlation_id)
          VALUES(tenant,actor,target_id,'team.invitation.revoked',jsonb_build_object('email',target_email,'status','PENDING'),jsonb_build_object('status','REVOKED'),NULLIF(current_setting('kleva.request_id',true),''));
        RETURN true;
      END $$;

      CREATE FUNCTION public.kleva_team_invitation_accept(session_key text,challenge_digest text,max_attempts integer)
      RETURNS TABLE(business_id uuid,business_name text,role text,outcome text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE actor uuid:=public.kleva_session_account(session_key); invitation_row public.merchant_business_invitations%ROWTYPE;
        verified_email text; tenant_name text; membership public.business_members%ROWTYPE; attempts_now integer;
      BEGIN
        IF actor IS NULL THEN RAISE EXCEPTION 'session expired' USING ERRCODE='28000'; END IF;
        IF max_attempts NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid attempt limit' USING ERRCODE='22023'; END IF;
        DELETE FROM public.merchant_team_invitation_attempts WHERE updated_at<now()-interval '24 hours';
        INSERT INTO public.merchant_team_invitation_attempts(session_digest,attempts,window_started_at)
          VALUES(encode(sha256(convert_to(session_key,'UTF8')),'hex'),1,now())
        ON CONFLICT(session_digest) DO UPDATE SET
          attempts=CASE WHEN public.merchant_team_invitation_attempts.window_started_at<now()-interval '1 hour' THEN 1 ELSE public.merchant_team_invitation_attempts.attempts+1 END,
          window_started_at=CASE WHEN public.merchant_team_invitation_attempts.window_started_at<now()-interval '1 hour' THEN now() ELSE public.merchant_team_invitation_attempts.window_started_at END,
          updated_at=now()
        RETURNING attempts INTO attempts_now;
        IF attempts_now>max_attempts THEN RAISE EXCEPTION 'invitation attempt limit reached' USING ERRCODE='53300'; END IF;
        SELECT lower(p.email) INTO verified_email FROM public.merchant_auth_profiles p
          WHERE p.account_id=actor AND p.email_verified_at IS NOT NULL AND p.status='active';
        IF verified_email IS NULL THEN RAISE EXCEPTION 'verified email required' USING ERRCODE='42501'; END IF;
        SELECT * INTO invitation_row FROM public.merchant_business_invitations i WHERE i.credential_digest=challenge_digest FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        IF invitation_row.status='ACCEPTED' AND invitation_row.accepted_by=actor THEN
          SELECT b.name INTO tenant_name FROM public.businesses b WHERE b.id=invitation_row.business_id;
          RETURN QUERY SELECT invitation_row.business_id,tenant_name,invitation_row.invited_role,'replayed'; RETURN;
        END IF;
        IF invitation_row.status<>'PENDING' OR invitation_row.expires_at<=now() THEN
          IF invitation_row.status='PENDING' AND invitation_row.expires_at<=now() THEN UPDATE public.merchant_business_invitations SET status='EXPIRED',updated_at=now() WHERE id=invitation_row.id; END IF;
          RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='22023';
        END IF;
        IF verified_email<>invitation_row.recipient_email THEN RAISE EXCEPTION 'invitation email mismatch' USING ERRCODE='42501'; END IF;
        PERFORM 1 FROM public.businesses b WHERE b.id=invitation_row.business_id AND b.status='active' FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'business unavailable' USING ERRCODE='22023'; END IF;
        SELECT * INTO membership FROM public.business_members m WHERE m."businessId"=invitation_row.business_id AND m."accountId"=actor FOR UPDATE;
        IF FOUND AND membership.role='owner' THEN RAISE EXCEPTION 'owner membership cannot be replaced' USING ERRCODE='23505'; END IF;
        IF FOUND THEN
          UPDATE public.business_members SET role=invitation_row.invited_role,status='active',membership_version=membership_version+1,
            revoked_at=NULL,revoked_by_account_id=NULL,updated_at=now()
            WHERE id=membership.id;
        ELSE
          INSERT INTO public.business_members("businessId","accountId",role,status)
            VALUES(invitation_row.business_id,actor,invitation_row.invited_role,'active');
        END IF;
        UPDATE public.merchant_business_invitations SET status='ACCEPTED',accepted_by=actor,accepted_at=now(),updated_at=now()
          WHERE id=invitation_row.id;
        SELECT b.name INTO tenant_name FROM public.businesses b WHERE b.id=invitation_row.business_id;
        INSERT INTO public.merchant_team_audit(business_id,actor_account_id,target_account_id,target_id,event_kind,previous_value,next_value,correlation_id)
          VALUES(invitation_row.business_id,actor,actor,invitation_row.id,'team.invitation.accepted',jsonb_build_object('status','PENDING'),jsonb_build_object('status','ACCEPTED','role',invitation_row.invited_role),NULLIF(current_setting('kleva.request_id',true),''));
        INSERT INTO public.merchant_team_audit(business_id,actor_account_id,target_account_id,target_id,event_kind,next_value,correlation_id)
          VALUES(invitation_row.business_id,actor,actor,invitation_row.id,'team.membership.created',jsonb_build_object('role',invitation_row.invited_role),NULLIF(current_setting('kleva.request_id',true),''));
        RETURN QUERY SELECT invitation_row.business_id,tenant_name,invitation_row.invited_role,'accepted';
      END $$;

      CREATE FUNCTION public.kleva_team_member_role(target_membership uuid,new_role text,expected_version integer)
      RETURNS TABLE(changed boolean, current_version integer)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor uuid:=public.kleva_current_account();
        target public.business_members%ROWTYPE; owners integer; conversation_id uuid;
      BEGIN
        IF actor IS NULL OR public.kleva_current_role()<>'owner' THEN RAISE EXCEPTION 'team access denied' USING ERRCODE='42501'; END IF;
        IF new_role NOT IN ('editor','agent') THEN RAISE EXCEPTION 'invalid team role' USING ERRCODE='22023'; END IF;
        PERFORM 1 FROM public.businesses b WHERE b.id=tenant FOR UPDATE;
        SELECT * INTO target FROM public.business_members m WHERE m.id=target_membership AND m."businessId"=tenant FOR UPDATE;
        IF NOT FOUND OR target.status<>'active' THEN RETURN QUERY SELECT false,target.membership_version; RETURN; END IF;
        IF target.membership_version<>expected_version THEN RAISE EXCEPTION 'membership version conflict' USING ERRCODE='40001'; END IF;
        IF target.role='owner' THEN
          SELECT count(*) INTO owners FROM public.business_members m WHERE m."businessId"=tenant AND m.status='active' AND m.role='owner';
          IF owners<=1 THEN RAISE EXCEPTION 'business requires an active owner' USING ERRCODE='23514'; END IF;
        END IF;
        UPDATE public.business_members SET role=new_role,membership_version=membership_version+1,updated_at=now() WHERE id=target.id;
        IF new_role NOT IN ('owner','agent') AND target.role IN ('owner','agent') THEN
          FOR conversation_id IN
            UPDATE public.conversation_inbox_state s SET assigned_to_account_id=NULL,updated_at=now()
            WHERE s.business_id=tenant AND s.assigned_to_account_id=target."accountId"
            RETURNING s.conversation_id
          LOOP
            INSERT INTO public.conversation_inbox_audit(business_id,conversation_id,actor_account_id,event_kind,previous_value,next_value)
              VALUES(tenant,conversation_id,actor,'ASSIGNED',target."accountId"::text,NULL);
          END LOOP;
        END IF;
        INSERT INTO public.merchant_team_audit(business_id,actor_account_id,target_account_id,target_id,event_kind,previous_value,next_value,correlation_id)
          VALUES(tenant,actor,target."accountId",target.id,'team.membership.role_changed',jsonb_build_object('role',target.role),jsonb_build_object('role',new_role,'version',expected_version+1),NULLIF(current_setting('kleva.request_id',true),''));
        RETURN QUERY SELECT true,expected_version+1;
      END $$;

      CREATE FUNCTION public.kleva_team_member_revoke(target_membership uuid,expected_version integer)
      RETURNS TABLE(revoked boolean,current_version integer)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
      DECLARE tenant uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid; actor uuid:=public.kleva_current_account();
        target public.business_members%ROWTYPE; owners integer; conversation_id uuid;
      BEGIN
        IF actor IS NULL OR public.kleva_current_role()<>'owner' THEN RAISE EXCEPTION 'team access denied' USING ERRCODE='42501'; END IF;
        PERFORM 1 FROM public.businesses b WHERE b.id=tenant FOR UPDATE;
        SELECT * INTO target FROM public.business_members m WHERE m.id=target_membership AND m."businessId"=tenant FOR UPDATE;
        IF NOT FOUND OR target.status<>'active' THEN RETURN QUERY SELECT false,target.membership_version; RETURN; END IF;
        IF target.membership_version<>expected_version THEN RAISE EXCEPTION 'membership version conflict' USING ERRCODE='40001'; END IF;
        IF target.role='owner' THEN
          SELECT count(*) INTO owners FROM public.business_members m WHERE m."businessId"=tenant AND m.status='active' AND m.role='owner';
          IF owners<=1 THEN RAISE EXCEPTION 'business requires an active owner' USING ERRCODE='23514'; END IF;
        END IF;
        UPDATE public.business_members SET status='inactive',revoked_at=now(),revoked_by_account_id=actor,
          membership_version=membership_version+1,updated_at=now() WHERE id=target.id;
        IF target.role IN ('owner','agent') THEN
          FOR conversation_id IN
            UPDATE public.conversation_inbox_state s SET assigned_to_account_id=NULL,updated_at=now()
            WHERE s.business_id=tenant AND s.assigned_to_account_id=target."accountId"
            RETURNING s.conversation_id
          LOOP
            INSERT INTO public.conversation_inbox_audit(business_id,conversation_id,actor_account_id,event_kind,previous_value,next_value)
              VALUES(tenant,conversation_id,actor,'ASSIGNED',target."accountId"::text,NULL);
          END LOOP;
        END IF;
        INSERT INTO public.merchant_team_audit(business_id,actor_account_id,target_account_id,target_id,event_kind,previous_value,next_value,correlation_id)
          VALUES(tenant,actor,target."accountId",target.id,'team.membership.revoked',jsonb_build_object('role',target.role,'status','active'),jsonb_build_object('status','inactive','version',expected_version+1),NULLIF(current_setting('kleva.request_id',true),''));
        RETURN QUERY SELECT true,expected_version+1;
      END $$;

      REVOKE ALL ON FUNCTION ${teamFunctions.map((fn) => `public.${fn}`).join(', ')} FROM PUBLIC;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.merchant_business_invitations)
          OR EXISTS (SELECT 1 FROM public.merchant_team_audit)
          OR EXISTS (SELECT 1 FROM public.merchant_team_invitation_attempts)
          OR EXISTS (SELECT 1 FROM public.business_members WHERE membership_version>1 OR revoked_at IS NOT NULL) THEN
          RAISE EXCEPTION 'Team management data exists; roll back the application and retain this migration.';
        END IF;
      END $$;
      DROP FUNCTION ${teamFunctions
        .slice()
        .reverse()
        .map((fn) => `public.${fn}`)
        .join(', ')};
      DROP POLICY kleva_team_audit_owner ON public.merchant_team_audit;
      DROP POLICY kleva_team_invitation_owner ON public.merchant_business_invitations;
      DROP POLICY kleva_team_invite_attempts_owner ON public.merchant_team_invitation_attempts;
      DROP TABLE public.merchant_team_invitation_attempts, public.merchant_team_audit, public.merchant_business_invitations;
      ALTER TABLE public.business_members DROP COLUMN updated_at,DROP COLUMN revoked_by_account_id,
        DROP COLUMN revoked_at,DROP COLUMN membership_version;
    `);
  }
}
