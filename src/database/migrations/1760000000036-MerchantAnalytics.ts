import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Tenant-scoped analytics over authoritative operational records. */
export class MerchantAnalytics1760000000036 implements MigrationInterface {
  name = 'MerchantAnalytics1760000000036';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE public.whatsapp_outbound_messages
        ADD COLUMN actor_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
      CREATE INDEX idx_wa_outbound_actor_time
        ON public.whatsapp_outbound_messages(business_id,actor_account_id,created_at DESC)
        WHERE actor_account_id IS NOT NULL AND authorization_kind='HUMAN';
      CREATE INDEX idx_wa_outbound_analytics
        ON public.whatsapp_outbound_messages(business_id,created_at,conversation_id)
        WHERE status IN ('ACCEPTED','DELIVERED','READ');
      CREATE INDEX idx_ai_runs_analytics
        ON public.ai_response_runs(business_id,created_at,channel)
        INCLUDE (conversation_id,status);
      CREATE INDEX idx_inbox_audit_analytics
        ON public.conversation_inbox_audit(business_id,created_at,event_kind,next_value);
      ALTER TABLE public.usage_reservations ADD COLUMN usage_purpose varchar(24)
        CHECK (usage_purpose IS NULL OR usage_purpose IN ('LIVE_CUSTOMER','PLAYGROUND','KNOWLEDGE_INDEXING','EVALUATION'));
      CREATE INDEX idx_usage_analytics
        ON public.usage_reservations(business_id,period_start,category,usage_purpose,status);
      CREATE INDEX idx_messages_analytics
        ON public.messages("businessId",channel,"createdAt") INCLUDE ("conversationId",direction,status);
      CREATE INDEX idx_conversations_analytics
        ON public.conversations("businessId",channel,status);
      CREATE INDEX idx_leads_analytics
        ON public.merchant_leads(business_id,created_at,source);
      CREATE INDEX idx_conversions_analytics
        ON public.merchant_lead_conversions(business_id,created_at,lead_id);
      CREATE INDEX idx_handoffs_analytics
        ON public.agent_tool_handoff_events(business_id,occurred_at,reason_code);
      CREATE INDEX idx_website_handoffs_analytics
        ON public.website_handoff_requests(business_id,created_at);
      CREATE INDEX idx_knowledge_gaps_analytics
        ON public.knowledge_gap_occurrences(business_id,occurred_at,expires_at,cluster_id);
      CREATE INDEX idx_learning_analytics
        ON public.learning_suggestion_decisions(business_id,occurred_at,to_status);
      CREATE INDEX idx_learning_evaluation_analytics
        ON public.learning_evaluation_runs(business_id,completed_at,status);

      CREATE FUNCTION public.kleva_merchant_analytics(
        range_start timestamptz, range_end timestamptz, channel_filter text, local_timezone text
      ) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
        SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
      DECLARE tenant_id uuid:=NULLIF(current_setting('kleva.business_id',true),'')::uuid;
        actor_role text:=public.kleva_current_role(); result jsonb;
      BEGIN
        IF tenant_id IS NULL OR actor_role NOT IN ('owner','editor') THEN
          RAISE EXCEPTION 'analytics access denied' USING ERRCODE='42501';
        END IF;
        IF range_start IS NULL OR range_end IS NULL OR range_start >= range_end
          OR range_end-range_start > interval '91 days'
          OR channel_filter NOT IN ('ALL','WHATSAPP','WEBSITE') THEN
          RAISE EXCEPTION 'invalid analytics range' USING ERRCODE='22023';
        END IF;
        IF local_timezone IS NULL OR btrim(local_timezone)='' THEN
          RAISE EXCEPTION 'invalid analytics timezone' USING ERRCODE='22023';
        END IF;
        PERFORM now() AT TIME ZONE local_timezone;
        WITH
        inbound AS MATERIALIZED (
          SELECT m.id,m."conversationId" conversation_id,m."createdAt" occurred_at,m.channel
          FROM public.messages m
          WHERE m."businessId"=tenant_id AND m.direction='inbound'
            AND m."createdAt">=range_start AND m."createdAt"<range_end
            AND (channel_filter='ALL' OR m.channel=channel_filter)
        ),
        cohort AS (SELECT DISTINCT conversation_id,channel FROM inbound),
        accepted AS MATERIALIZED (
          SELECT o.conversation_id,o.authorization_kind,o.created_at,o.id,'WHATSAPP'::text channel,o.actor_account_id
          FROM public.whatsapp_outbound_messages o
          WHERE o.business_id=tenant_id AND o.status IN ('ACCEPTED','DELIVERED','READ')
            AND o.conversation_id IS NOT NULL AND o.created_at<now()
            AND (channel_filter IN ('ALL','WHATSAPP'))
          UNION ALL
          SELECT m."conversationId",m.metadata->>'authorizationKind',m."createdAt",m.id,'WEBSITE'::text,
            NULLIF(m.metadata->>'actorAccountId','')::uuid
          FROM public.messages m WHERE m."businessId"=tenant_id AND m.channel='WEBSITE'
            AND m.direction='outbound' AND m.status IN ('sent','delivered','read') AND m."createdAt"<now()
            AND (channel_filter IN ('ALL','WEBSITE'))
        ),
        public_accepted AS MATERIALIZED (
          SELECT * FROM accepted WHERE authorization_kind IN ('AI','HUMAN')
        ),
        cohort_replies AS (
          SELECT c.conversation_id,c.channel,a.authorization_kind,a.created_at,
            row_number() OVER(PARTITION BY c.conversation_id ORDER BY a.created_at,a.id) rn
          FROM cohort c JOIN inbound i ON i.conversation_id=c.conversation_id
          JOIN public_accepted a ON a.conversation_id=c.conversation_id AND a.created_at>=i.occurred_at
        ),
        first_reply AS (SELECT * FROM cohort_replies WHERE rn=1),
        response_groups AS (
          SELECT c.conversation_id,
            COALESCE(bool_or(a.authorization_kind='AI'),false) ai,
            COALESCE(bool_or(a.authorization_kind='HUMAN'),false) human
          FROM cohort c LEFT JOIN public_accepted a ON a.conversation_id=c.conversation_id
            AND a.created_at >= (SELECT min(i.occurred_at) FROM inbound i WHERE i.conversation_id=c.conversation_id)
          GROUP BY c.conversation_id
        ),
        conversion_rows AS MATERIALIZED (
          SELECT x.outcome,x.currency,x.conversion_value FROM public.merchant_lead_conversions x
          JOIN public.merchant_leads l ON l.business_id=x.business_id AND l.id=x.lead_id
          WHERE x.business_id=tenant_id AND x.created_at>=range_start AND x.created_at<range_end
            AND (channel_filter='ALL' OR l.source=channel_filter)
        ),
        handoffs AS (
          SELECT (SELECT count(*) FROM public.agent_tool_handoff_events h
            WHERE h.business_id=tenant_id AND h.occurred_at>=range_start AND h.occurred_at<range_end
              AND (channel_filter='ALL' OR EXISTS(SELECT 1 FROM public.conversations c
                WHERE c."businessId"=tenant_id AND c.id=h.conversation_id AND c.channel=channel_filter)))
            +(SELECT count(*) FROM public.website_handoff_requests w
            WHERE w.business_id=tenant_id AND w.created_at>=range_start AND w.created_at<range_end
              AND channel_filter IN ('ALL','WEBSITE')) total
            ,(SELECT count(DISTINCT h.conversation_id) FROM (
              SELECT a.conversation_id FROM public.agent_tool_handoff_events a JOIN cohort c ON c.conversation_id=a.conversation_id
                WHERE a.business_id=tenant_id AND a.occurred_at>=range_start AND a.occurred_at<range_end
                  AND (channel_filter='ALL' OR c.channel=channel_filter)
              UNION SELECT w.conversation_id FROM public.website_handoff_requests w JOIN cohort c ON c.conversation_id=w.conversation_id
                WHERE w.business_id=tenant_id AND w.created_at>=range_start AND w.created_at<range_end
                  AND c.channel='WEBSITE') h) conversation_count
        ),
        handoff_reasons AS (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('reason',reason,'count',n) ORDER BY reason),'[]'::jsonb) data
          FROM (SELECT h.reason_code::text reason,count(*)::int n FROM public.agent_tool_handoff_events h
            JOIN public.conversations c ON c."businessId"=h.business_id AND c.id=h.conversation_id
            WHERE h.business_id=tenant_id AND h.occurred_at>=range_start AND h.occurred_at<range_end
              AND (channel_filter='ALL' OR c.channel=channel_filter)
            GROUP BY h.reason_code) x
        ),
        ai AS (
          SELECT count(DISTINCT a.conversation_id) FILTER(WHERE a.status='FAILED')::int failed,
            count(*) FILTER(WHERE a.status='ABSTAINED')::int insufficient,
            (SELECT count(*)::int FROM public.whatsapp_outbound_messages o
              WHERE o.business_id=tenant_id AND o.created_at>=range_start AND o.created_at<range_end AND o.status='SUPPRESSED'
                AND o.authorization_kind='AI' AND (channel_filter IN ('ALL','WHATSAPP')))
            +(SELECT count(*)::int FROM public.messages m WHERE m."businessId"=tenant_id AND m.channel='WEBSITE'
              AND m.direction='outbound' AND m.status='suppressed' AND m."createdAt">=range_start AND m."createdAt"<range_end
              AND m.metadata->>'authorizationKind'='AI' AND channel_filter IN ('ALL','WEBSITE')) suppressed,
            count(*) FILTER(WHERE a.status IN ('GENERATED','QUEUED','COMPLETED','FAILED') AND jsonb_array_length(a.evidence)>0)::int eligible
          FROM public.ai_response_runs a WHERE a.business_id=tenant_id
            AND a.created_at>=range_start AND a.created_at<range_end
            AND (channel_filter='ALL' OR a.channel=channel_filter)
        ),
        conversions AS (
          SELECT count(*) FILTER(WHERE outcome='WON')::int won,
            count(*) FILTER(WHERE outcome='LOST')::int lost,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('currency',v.currency,'value',v.total_value::text)
              ORDER BY v.currency) FROM (SELECT currency,sum(conversion_value)::numeric(14,2) total_value
                FROM conversion_rows WHERE outcome='WON' AND conversion_value IS NOT NULL
                GROUP BY currency) v),'[]'::jsonb) values_by_currency
          FROM conversion_rows
        ),
        ai_accepted AS (
          SELECT count(DISTINCT a.id)::int count FROM public.ai_response_runs a
          WHERE a.business_id=tenant_id AND a.created_at>=range_start AND a.created_at<range_end
            AND a.status IN ('QUEUED','COMPLETED') AND jsonb_array_length(a.evidence)>0
            AND (channel_filter='ALL' OR a.channel=channel_filter)
            AND ((a.channel='WHATSAPP' AND EXISTS(SELECT 1 FROM public.whatsapp_outbound_messages o
              WHERE o.id=a.outbound_message_id AND o.business_id=tenant_id AND o.status IN ('ACCEPTED','DELIVERED','READ')))
              OR (a.channel='WEBSITE' AND EXISTS(SELECT 1 FROM public.messages m WHERE m.id=a.website_outbound_message_id
                AND m."businessId"=tenant_id AND m.status IN ('sent','delivered','read'))))
        ),
        agent_replies AS (
          SELECT c.conversation_id,a.actor_account_id,min(a.created_at) first_response,
            (SELECT min(i.occurred_at) FROM inbound i WHERE i.conversation_id=c.conversation_id) first_inbound
          FROM cohort c JOIN public_accepted a ON a.conversation_id=c.conversation_id
            AND a.authorization_kind='HUMAN' AND a.actor_account_id IS NOT NULL
            AND a.created_at >= (SELECT min(i.occurred_at) FROM inbound i WHERE i.conversation_id=c.conversation_id)
          GROUP BY c.conversation_id,a.actor_account_id
        ),
        agent_stats AS (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('name',COALESCE(p.full_name,'Team member'),
              'conversationsHandled',s.conversations,'acceptedReplies',s.replies,
              'resolvedConversations',s.resolved,'medianResponseSeconds',s.median_response)
              ORDER BY s.replies DESC),'[]'::jsonb) data
          FROM (SELECT actor_id,count(DISTINCT conversation_id)::int conversations,count(*)::int replies,
              (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM (ar.first_response-ar.first_inbound)))
                FROM agent_replies ar WHERE ar.actor_account_id=raw.actor_id) median_response,
              (SELECT count(DISTINCT a.conversation_id)::int FROM public.conversation_inbox_audit a
                WHERE a.business_id=tenant_id AND a.actor_account_id=actor_id AND a.event_kind='STATUS'
                  AND lower(a.next_value) IN ('closed','resolved') AND a.created_at>=range_start AND a.created_at<range_end) resolved
            FROM (SELECT o.actor_account_id actor_id,o.conversation_id,o.created_at FROM public.whatsapp_outbound_messages o
                WHERE o.business_id=tenant_id AND o.authorization_kind='HUMAN' AND o.actor_account_id IS NOT NULL
                  AND o.status IN ('ACCEPTED','DELIVERED','READ') AND o.created_at>=range_start AND o.created_at<range_end
                  AND channel_filter IN ('ALL','WHATSAPP')
              UNION ALL SELECT NULLIF(m.metadata->>'actorAccountId','')::uuid,m."conversationId",m."createdAt" FROM public.messages m
                WHERE m."businessId"=tenant_id AND m.channel='WEBSITE' AND m.direction='outbound'
                  AND m.metadata->>'authorizationKind'='HUMAN' AND m.status IN ('sent','delivered','read')
                  AND m."createdAt">=range_start AND m."createdAt"<range_end
                  AND channel_filter IN ('ALL','WEBSITE')) raw
            GROUP BY actor_id) s LEFT JOIN public.merchant_auth_profiles p ON p.account_id=s.actor_id
        ),
        leads AS (
          SELECT count(*)::int created,
            count(*) FILTER(WHERE l.status='QUALIFIED')::int qualified,
            count(*) FILTER(WHERE l.status IN ('NEW','CONTACTED','QUALIFIED'))::int open_count,
            count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.merchant_lead_conversions x
              WHERE x.business_id=l.business_id AND x.lead_id=l.id AND x.outcome='WON'))::int cohort_won
          FROM public.merchant_leads l WHERE l.business_id=tenant_id
            AND l.created_at>=range_start AND l.created_at<range_end
            AND (channel_filter='ALL' OR l.source=channel_filter)
        ),
        gaps AS (
          SELECT COALESCE(sum(topic_occurrences),0)::int occurrences,
            count(*)::int topics,
            count(*) FILTER(WHERE status='OPEN')::int open_topics,
            count(*) FILTER(WHERE status='REVIEWED')::int reviewed_topics,
            COALESCE(jsonb_agg(jsonb_build_object('topic',topic_label,'count',topic_occurrences)
              ORDER BY topic_occurrences DESC,last_seen_at DESC) FILTER(WHERE status='OPEN'),'[]'::jsonb) top_topics
          FROM (
            SELECT c.id,c.status,c.topic_label,count(o.id)::int topic_occurrences,max(o.occurred_at) last_seen_at
            FROM public.knowledge_gap_clusters c JOIN public.knowledge_gap_occurrences o
              ON o.business_id=c.business_id AND o.cluster_id=c.id
            WHERE c.business_id=tenant_id AND o.expires_at>now()
              AND o.occurred_at>=range_start AND o.occurred_at<range_end
            GROUP BY c.id,c.status,c.topic_label
          ) active_gaps
        ),
        usage AS (
          SELECT category,COALESCE(usage_purpose,'UNATTRIBUTED') purpose,
            sum(consumed_amount)::bigint consumed,
            sum(CASE WHEN status='RESERVED' THEN greatest(reserved_amount-consumed_amount-released_amount,0) ELSE 0 END)::bigint reserved,
            sum(CASE WHEN status IN ('UNCERTAIN','PROVIDER_ACCEPTED') THEN greatest(reserved_amount-consumed_amount-released_amount,0) ELSE 0 END)::bigint uncertain,
            sum(greatest(reserved_amount-released_amount,0))::bigint quota_counted
          FROM public.usage_reservations WHERE business_id=tenant_id
            AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date
          GROUP BY category,usage_purpose
        ),
        trend AS (
          SELECT jsonb_agg(jsonb_build_object('date',d::date,'conversations',COALESCE(x.count,0)) ORDER BY d) days,
            jsonb_agg(jsonb_build_object('date',d::date,'leads',COALESCE(l.count,0)) ORDER BY d) lead_days
          FROM generate_series(date_trunc('day',range_start AT TIME ZONE local_timezone),
            date_trunc('day',(range_end-interval '1 microsecond') AT TIME ZONE local_timezone),interval '1 day') d
          LEFT JOIN LATERAL (SELECT count(DISTINCT i.conversation_id)::int count FROM inbound i
            WHERE (i.occurred_at AT TIME ZONE local_timezone)::date=d::date) x ON true
          LEFT JOIN LATERAL (SELECT count(*)::int count FROM public.merchant_leads l WHERE l.business_id=tenant_id
            AND (l.created_at AT TIME ZONE local_timezone)::date=d::date
            AND (channel_filter='ALL' OR l.source=channel_filter)) l ON true
        ),
        channel_stats AS (
          SELECT COALESCE(jsonb_agg(jsonb_build_object('channel',c.channel,
            'inboundConversations',c.inbound_count,
            'acceptedAiResponses',(SELECT count(DISTINCT a.id)::int FROM public_accepted a
              JOIN cohort cc ON cc.conversation_id=a.conversation_id WHERE cc.channel=c.channel AND a.authorization_kind='AI'
                AND a.created_at>=range_start AND a.created_at<range_end),
            'humanResponses',(SELECT count(DISTINCT a.id)::int FROM public_accepted a
              JOIN cohort cc ON cc.conversation_id=a.conversation_id WHERE cc.channel=c.channel AND a.authorization_kind='HUMAN'
                AND a.created_at>=range_start AND a.created_at<range_end),
            'medianFirstResponseSeconds',(SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM
              (fr.created_at-(SELECT min(i.occurred_at) FROM inbound i WHERE i.conversation_id=fr.conversation_id))))
              FROM first_reply fr WHERE fr.channel=c.channel),
            'leadsCreated',(SELECT count(*)::int FROM public.merchant_leads l WHERE l.business_id=tenant_id AND l.source=c.channel
              AND l.created_at>=range_start AND l.created_at<range_end),
            'qualifiedLeads',(SELECT count(*)::int FROM public.merchant_leads l WHERE l.business_id=tenant_id AND l.source=c.channel
              AND l.status='QUALIFIED' AND l.created_at>=range_start AND l.created_at<range_end),
            'recordedConversions',(SELECT count(*)::int FROM public.merchant_lead_conversions x JOIN public.merchant_leads l
              ON l.business_id=x.business_id AND l.id=x.lead_id WHERE x.business_id=tenant_id AND l.source=c.channel
                AND x.created_at>=range_start AND x.created_at<range_end)) ORDER BY c.channel),'[]'::jsonb) data
          FROM (SELECT channel,count(DISTINCT conversation_id)::int inbound_count FROM cohort GROUP BY channel) c
        ),
        learning_activity AS (
          SELECT (SELECT count(*)::int FROM public.learning_suggestion_decisions d
              WHERE d.business_id=tenant_id AND d.to_status='PUBLISHED' AND d.occurred_at>=range_start AND d.occurred_at<range_end) published,
            (SELECT count(*)::int FROM public.learning_suggestion_decisions d
              WHERE d.business_id=tenant_id AND d.to_status='INDEXING_FAILED' AND d.occurred_at>=range_start AND d.occurred_at<range_end) indexing_failed,
            (SELECT count(*)::int FROM public.learning_evaluation_runs e
              WHERE e.business_id=tenant_id AND e.status='COMPLETED' AND e.completed_at>=range_start AND e.completed_at<range_end) evaluations_completed,
            (SELECT count(*)::int FROM public.learning_evaluation_results e
              WHERE e.business_id=tenant_id AND e.evaluated_at>=range_start AND e.evaluated_at<range_end) evaluation_cases,
            (SELECT count(*)::int FROM public.learning_evaluation_results e
              WHERE e.business_id=tenant_id AND e.evaluated_at>=range_start AND e.evaluated_at<range_end AND e.grounded IS TRUE AND e.citations_valid IS TRUE) grounded_valid_cases
        )
        SELECT jsonb_build_object(
          'range',jsonb_build_object('from',range_start,'toExclusive',range_end,'timezone',local_timezone),
          'definitionsVersion','1',
          'engagement',jsonb_build_object(
            'inboundConversations',(SELECT count(*)::int FROM cohort),
            'inboundMessages',(SELECT count(*)::int FROM inbound),
            'acceptedReplies',(SELECT count(DISTINCT id)::int FROM public_accepted WHERE created_at>=range_start AND created_at<range_end),
            'activeConversations',(SELECT count(*)::int FROM public.conversations v WHERE v."businessId"=tenant_id AND lower(COALESCE(v.status,'open')) NOT IN ('closed','resolved') AND (channel_filter='ALL' OR v.channel=channel_filter)),
            'awaitingResponse',(SELECT count(*)::int FROM cohort c JOIN public.conversations v
              ON v.id=c.conversation_id AND v."businessId"=tenant_id
              WHERE lower(COALESCE(v.status,'open')) NOT IN ('closed','resolved')
                AND (SELECT max(m."createdAt") FROM public.messages m WHERE m."businessId"=tenant_id
                  AND m."conversationId"=c.conversation_id AND m.direction='inbound') >
                  COALESCE((SELECT max(a.created_at) FROM public_accepted a WHERE a.conversation_id=c.conversation_id),'-infinity'::timestamptz)),
            'resolvedEvents',(SELECT count(*)::int FROM public.conversation_inbox_audit a WHERE a.business_id=tenant_id AND a.event_kind='STATUS' AND lower(a.next_value) IN ('closed','resolved') AND a.created_at>=range_start AND a.created_at<range_end),
            'reopenedEvents',(SELECT count(*)::int FROM public.conversation_inbox_audit a WHERE a.business_id=tenant_id AND a.event_kind='STATUS' AND lower(a.next_value)='open' AND a.created_at>=range_start AND a.created_at<range_end),
            'trend',(SELECT days FROM trend)),
          'responses',jsonb_build_object(
            'aiOnly',(SELECT count(*)::int FROM response_groups WHERE ai AND NOT human),
            'humanOnly',(SELECT count(*)::int FROM response_groups WHERE human AND NOT ai),
            'mixed',(SELECT count(*)::int FROM response_groups WHERE human AND ai),
            'unanswered',(SELECT count(*)::int FROM response_groups WHERE NOT human AND NOT ai),
            'answered',(SELECT count(*)::int FROM first_reply),
            'medianFirstResponseSeconds',(SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM (created_at-(SELECT min(occurred_at) FROM inbound i WHERE i.conversation_id=first_reply.conversation_id)))) FROM first_reply),
            'medianAiFirstResponseSeconds',(SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM (created_at-(SELECT min(occurred_at) FROM inbound i WHERE i.conversation_id=first_reply.conversation_id)))) FROM first_reply WHERE authorization_kind='AI'),
            'medianHumanFirstResponseSeconds',(SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY extract(epoch FROM (created_at-(SELECT min(occurred_at) FROM inbound i WHERE i.conversation_id=first_reply.conversation_id)))) FROM first_reply WHERE authorization_kind='HUMAN')),
          'ai',jsonb_build_object('failedGenerations',(SELECT failed FROM ai),'insufficientEvidence',(SELECT insufficient FROM ai),'suppressed',(SELECT suppressed FROM ai),
            'eligibleGroundedRuns',(SELECT eligible FROM ai),'acceptedGroundedRuns',(SELECT count FROM ai_accepted),
            'acceptanceRate',CASE WHEN (SELECT eligible FROM ai)=0 THEN NULL ELSE round((SELECT count FROM ai_accepted)::numeric*100/(SELECT eligible FROM ai),1) END),
          'handoffs',jsonb_build_object('recordedEvents',(SELECT total FROM handoffs),'conversations',(SELECT conversation_count FROM handoffs),'reasons',(SELECT data FROM handoff_reasons),
            'awaitingHuman',(SELECT count(*)::int FROM public.conversations v WHERE v."businessId"=tenant_id
              AND v.control_mode='HUMAN' AND lower(COALESCE(v.status,'open')) NOT IN ('closed','resolved')
              AND (channel_filter='ALL' OR v.channel=channel_filter))),
          'sales',jsonb_build_object('leadsCreated',(SELECT created FROM leads),'qualifiedLeads',(SELECT qualified FROM leads),
            'qualificationRate',CASE WHEN (SELECT created FROM leads)=0 THEN NULL ELSE round((SELECT qualified FROM leads)::numeric*100/(SELECT created FROM leads),1) END,
            'cohortWon',(SELECT cohort_won FROM leads),'cohortConversionRate',CASE WHEN (SELECT created FROM leads)=0 THEN NULL ELSE round((SELECT cohort_won FROM leads)::numeric*100/(SELECT created FROM leads),1) END,
            'openOpportunities',(SELECT open_count FROM leads),'won',(SELECT won FROM conversions),'lost',(SELECT lost FROM conversions),
            'recordedValuesByCurrency',(SELECT values_by_currency FROM conversions),'leadTrend',(SELECT lead_days FROM trend),
            'revenueAvailability',CASE WHEN jsonb_array_length((SELECT values_by_currency FROM conversions))>0 THEN 'RECORDED_CONVERSION_VALUES' ELSE 'UNAVAILABLE_NO_RECORDED_VALUES' END),
          'knowledge',jsonb_build_object('occurrences',(SELECT occurrences FROM gaps),'topics',(SELECT topics FROM gaps),'openTopics',(SELECT open_topics FROM gaps),'reviewedTopics',(SELECT reviewed_topics FROM gaps),'topTopics',(SELECT top_topics FROM gaps),
            'publishedImprovements',(SELECT published FROM learning_activity),'failedIndexing',(SELECT indexing_failed FROM learning_activity),
            'completedEvaluations',(SELECT evaluations_completed FROM learning_activity),'evaluationCases',(SELECT evaluation_cases FROM learning_activity),
            'groundedValidCases',(SELECT grounded_valid_cases FROM learning_activity)),
          'usage',COALESCE((SELECT jsonb_agg(jsonb_build_object('category',category,'purpose',purpose,'consumed',consumed,'reserved',reserved,'uncertain',uncertain) ORDER BY category,purpose) FROM usage),'[]'::jsonb),
          'usageLimits',(SELECT to_jsonb(l) FROM (SELECT monthly_whatsapp_messages,monthly_ai_input_tokens,
            monthly_ai_output_tokens,monthly_embedding_tokens FROM public.business_usage_limits WHERE business_id=tenant_id) l),
          'quotaCounted',COALESCE((SELECT jsonb_object_agg(category,amount) FROM
            (SELECT category,sum(quota_counted)::bigint amount FROM usage GROUP BY category) q),'{}'::jsonb),
          'team',jsonb_build_object('canView',actor_role='owner',
            'agents',CASE WHEN actor_role='owner' THEN (SELECT data FROM agent_stats) ELSE '[]'::jsonb END),
          'channels',(SELECT data FROM channel_stats),
          'availability',jsonb_build_object('estimatedModelCost','UNAVAILABLE_MODEL_PRICING_NOT_CONFIGURED','historicalActorAttribution','AVAILABLE_FROM_MIGRATION_ONLY','delivery','provider acceptance and confirmed delivery are combined for accepted reply totals'))
        INTO result;
        RETURN result;
      END $$;
      REVOKE ALL ON FUNCTION public.kleva_merchant_analytics(timestamptz,timestamptz,text,text) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_merchant_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_merchant_analytics(timestamptz,timestamptz,text,text) TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM public.whatsapp_outbound_messages WHERE actor_account_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM public.usage_reservations WHERE usage_purpose IS NOT NULL) THEN
          RAISE EXCEPTION 'Analytics attribution exists; preserve it and keep this migration applied.';
        END IF;
      END $$;
      DROP FUNCTION public.kleva_merchant_analytics(timestamptz,timestamptz,text,text);
      DROP INDEX public.idx_learning_evaluation_analytics;
      DROP INDEX public.idx_learning_analytics;
      DROP INDEX public.idx_knowledge_gaps_analytics;
      DROP INDEX public.idx_website_handoffs_analytics;
      DROP INDEX public.idx_handoffs_analytics;
      DROP INDEX public.idx_conversions_analytics;
      DROP INDEX public.idx_leads_analytics;
      DROP INDEX public.idx_conversations_analytics;
      DROP INDEX public.idx_messages_analytics;
      DROP INDEX public.idx_usage_analytics;
      ALTER TABLE public.usage_reservations DROP COLUMN usage_purpose;
      DROP INDEX public.idx_wa_outbound_actor_time;
      DROP INDEX public.idx_inbox_audit_analytics;
      DROP INDEX public.idx_ai_runs_analytics;
      DROP INDEX public.idx_wa_outbound_analytics;
      ALTER TABLE public.whatsapp_outbound_messages DROP COLUMN actor_account_id;
    `);
  }
}
