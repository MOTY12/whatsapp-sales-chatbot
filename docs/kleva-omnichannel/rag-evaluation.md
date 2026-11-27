# RAG evaluation harness

## Scope

`src/knowledge/evaluation/` contains a deterministic, synthetic-only evaluation dataset (`kleva-rag-synthetic-v1`), metric aggregation, a strategy adapter runner and Markdown report rendering. The dataset includes hotel, restaurant, retail, school, professional-services and e-commerce questions in English, Nigerian English and Nigerian Pidgin. It includes supported, unsupported and ambiguous queries plus exact SKU and revision labels.

The runner compares adapter outputs for `LEXICAL`, `SEMANTIC` and `HYBRID`. Reports include Recall@1/3/5, MRR, evidence precision, source and revision attribution, exact SKU accuracy, unsupported abstention, cross-tenant violation count, median/P95 latency, embedding tokens, metrics by language, failed synthetic case IDs, provider/model/configuration metadata and known limitations. Reports contain identifiers from the fixture dataset, not merchant questions, customer messages, credentials or vectors.

## Safety controls

The normal deterministic mode does not call an external provider. The real-provider mode requires `authorizedRealProviderRun: true`, a positive token budget and at most 50 cases. It preflights query token cost before each adapter dispatch and rejects observed over-budget usage. Do not wire production merchant data into this harness. CI must use deterministic fixtures only. No real-provider evaluation has been run for this change, and deterministic hash vectors do not establish semantic language quality.

The harness accepts a retrieval adapter; it does not provision isolated evaluation businesses or select a provider on its own. Before a paid evaluation, use a disposable tenant with synthetic content, configure the approved embedding provider and usage allowance, record the configuration, and confirm that this explicit run is authorized. Capture the returned report as a local review artifact without committing secrets or private data.

## Limits

This is a reusable evaluation library, not a quality claim or CI gate. A representative corpus, adapter backed by isolated PostgreSQL fixtures for each strategy, real-provider run, and production-representative latency study remain outstanding.
