-- Operational metadata only. Do not add message bodies, tokens, or webhook payloads.
SELECT status, operation AS operation_type, "lastError" AS error_classification,
       count(*) AS operations, min("createdAt") AS oldest_created_at,
       min("dueAt") FILTER (WHERE status IN ('PENDING', 'RETRY_PENDING')) AS earliest_retry_at
FROM public.outbox_operations
GROUP BY status, operation, "lastError"
ORDER BY status, operation;

SELECT status, count(*) AS sends,
       min(created_at) AS oldest_created_at,
       max(updated_at) AS last_updated_at
FROM public.whatsapp_outbound_messages
GROUP BY status
ORDER BY status;

SELECT status, error_category AS error_classification, count(*) AS runs,
       max(updated_at) AS last_updated_at
FROM public.ai_response_runs
GROUP BY status, error_category
ORDER BY status, error_category;

SELECT CASE WHEN processed_at IS NULL THEN 'pending'
            WHEN processing_outcome IS NULL THEN 'processed'
            ELSE processing_outcome END AS receipt_state,
       count(*) AS receipts,
       min(received_at) AS oldest_received_at,
       max(received_at) AS newest_received_at
FROM public.webhook_receipts
GROUP BY receipt_state
ORDER BY receipt_state;

SELECT count(*) AS failed_outbox_last_hour
FROM public.outbox_operations
WHERE status = 'FAILED' AND "updatedAt" >= now() - interval '1 hour';
