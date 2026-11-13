# Kleva December MVP

Target December 13, 2026. Budget 150 hours over 30 focused development days. The release is for a small Nigerian WhatsApp pilot on one deployment and a limited set of approved merchant assets.

A merchant signs in, creates a business, publishes products and FAQs, and connects WhatsApp. A customer messages the business, receives an answer backed by approved information, and can be saved as a lead. The merchant sees the thread, takes over, and replies manually.

Start with the [execution plan](execution-plan.md), [task tracker](progress-tracker.md), [verification log](execution-log.md), and [release checklist](release-checklist.md). Task IDs map to the [omnichannel roadmap](../kleva-omnichannel/execution-roadmap.md). This plan records December acceptance for thin slices. Requirements deferred from a roadmap task remain open in the broader roadmap.

Use one modular NestJS backend, PostgreSQL, Redis/BullMQ, and one Next.js merchant dashboard served on the merchant session origin. Use PostgreSQL full-text search for published text. Keep provider calls bounded and use deterministic logic for permissions, lead writes, delivery and takeover.

See the [merchant business API](merchant-business-api.md) for onboarding, profile and deployment contracts.
