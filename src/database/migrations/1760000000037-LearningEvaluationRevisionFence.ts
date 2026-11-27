import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds exact approved-revision inputs without rewriting the original learning migration. */
export class LearningEvaluationRevisionFence1760000000037 implements MigrationInterface {
  name = 'LearningEvaluationRevisionFence1760000000037';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE FUNCTION public.kleva_learning_evaluation_job_read_v2(target_run uuid)
      RETURNS TABLE(
        run_id uuid,
        business_id uuid,
        expected_source_id uuid,
        expected_revision_id uuid,
        expected_generation_id uuid,
        question text,
        previous_revision_id uuid,
        previous_content text,
        evaluation_current boolean
      )
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE run_row public.learning_evaluation_runs%ROWTYPE;
      BEGIN
        IF session_user::text !~ '^kleva_runtime_' THEN
          RAISE EXCEPTION 'learning evaluator role required' USING ERRCODE='42501';
        END IF;
        UPDATE public.learning_evaluation_runs r SET status='RUNNING'
          WHERE r.id=target_run AND r.status IN ('PENDING','RUNNING')
          RETURNING r.* INTO run_row;
        IF NOT FOUND THEN RETURN; END IF;
        RETURN QUERY
          SELECT run_row.id,run_row.business_id,run_row.approved_faq_id,
            run_row.approved_revision_id,s.generation_id,v.proposed_question::text,
            run_row.previous_revision_id,COALESCE(prev.question||E'\\n'||prev.answer,'')::text,
            (f.published_revision_id=run_row.approved_revision_id AND g.status='ACTIVE')
          FROM public.learning_suggestions s
          JOIN public.learning_suggestion_versions v
            ON v.business_id=s.business_id AND v.suggestion_id=s.id
              AND v.version=run_row.suggestion_version
          LEFT JOIN public.knowledge_index_generations g
            ON g.business_id=s.business_id AND g.id=s.generation_id
              AND g.learning_suggestion_id=s.id
              AND g.learning_suggestion_version=run_row.suggestion_version
              AND g.source_type='FAQ' AND g.source_id=run_row.approved_faq_id
              AND g.source_revision_id=run_row.approved_revision_id
          LEFT JOIN public.knowledge_faqs f
            ON f.business_id=run_row.business_id AND f.id=run_row.approved_faq_id
          LEFT JOIN public.knowledge_faq_revisions prev
            ON prev.business_id=run_row.business_id AND prev.faq_id=run_row.approved_faq_id
              AND prev.id=run_row.previous_revision_id
          WHERE s.business_id=run_row.business_id AND s.id=run_row.suggestion_id;
      END $$;
      REVOKE ALL ON FUNCTION public.kleva_learning_evaluation_job_read_v2(uuid) FROM PUBLIC;
      DO $$ DECLARE role_name text; BEGIN
        FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'kleva_runtime_%' LOOP
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.kleva_learning_evaluation_job_read_v2(uuid) TO %I',role_name);
        END LOOP;
      END $$;
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP FUNCTION public.kleva_learning_evaluation_job_read_v2(uuid);
    `);
  }
}
