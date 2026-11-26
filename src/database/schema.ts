import {
  AuditLog,
  AssistantSession,
  Business,
  Conversation,
  Customer,
  FollowUp,
  Message,
  Notification,
  OnboardingSession,
  PipelineStage,
  Sale,
  Task,
  User,
} from './entities';
import { Account } from './entities/account.entity';
import { ChannelConnection } from './entities/channel-connection.entity';
import { BusinessMember } from './entities/business-member.entity';
import { OutboxOperation } from './entities/outbox-operation.entity';
import { InitialSchema1759999999999 } from './migrations/1759999999999-InitialSchema';
import { AddWebhookPersistence1760000000000 } from './migrations/1760000000000-AddWebhookPersistence';
import { AddAssistantPersistence1760000000001 } from './migrations/1760000000001-AddAssistantPersistence';

import { AddOutboxOperations1760000000002 } from './migrations/1760000000002-AddOutboxOperations';

import { AddTenantIntegrity1760000000003 } from './migrations/1760000000003-AddTenantIntegrity';

import { AddMerchantAuth1760000000004 } from './migrations/1760000000004-AddMerchantAuth';

import { AddMerchantOnboarding1760000000005 } from './migrations/1760000000005-AddMerchantOnboarding';

import { AddChannelConnections1760000000006 } from './migrations/1760000000006-AddChannelConnections';

import { SecureWhatsAppCredentials1760000000007 } from './migrations/1760000000007-SecureWhatsAppCredentials';

import { AddWebhookReceipts1760000000008 } from './migrations/1760000000008-AddWebhookReceipts';
import { ProcessWhatsAppReceipts1760000000009 } from './migrations/1760000000009-ProcessWhatsAppReceipts';
import { AddTenantUsageLedger1760000000010 } from './migrations/1760000000010-AddTenantUsageLedger';
import { DurableWhatsAppOutbound1760000000011 } from './migrations/1760000000011-DurableWhatsAppOutbound';
import { MerchantInbox1760000000012 } from './migrations/1760000000012-MerchantInbox';
import { MerchantFaqKnowledge1760000000013 } from './migrations/1760000000013-MerchantFaqKnowledge';
import { KnowledgeFaq } from './entities/knowledge-faq.entity';
import { KnowledgeFaqRevision } from './entities/knowledge-faq-revision.entity';
import { MerchantProduct } from './entities/merchant-product.entity';
import { MerchantProductRevision } from './entities/merchant-product-revision.entity';
import { MerchantProductCatalog1760000000014 } from './migrations/1760000000014-MerchantProductCatalog';
import { PublishedKnowledgeSearch1760000000015 } from './migrations/1760000000015-PublishedKnowledgeSearch';
import { MerchantLeads1760000000016 } from './migrations/1760000000016-MerchantLeads';
import { AiResponseRuns1760000000017 } from './migrations/1760000000017-AiResponseRuns';
import { MerchantPilotApproval1760000000018 } from './migrations/1760000000018-MerchantPilotApproval';
import { MerchantLead } from './entities/merchant-lead.entity';
import { MerchantSignupAndOnboarding1760000000019 } from './migrations/1760000000019-MerchantSignupAndOnboarding';
import { MerchantEmailAuthentication1760000000020 } from './migrations/1760000000020-MerchantEmailAuthentication';
import { DurableMerchantEmail1760000000021 } from './migrations/1760000000021-DurableMerchantEmail';
import { MerchantEmailDelivery } from './entities/merchant-email-delivery.entity';
import { MerchantEmbeddedWhatsApp1760000000022 } from './migrations/1760000000022-MerchantEmbeddedWhatsApp';
import { PilotOperatorActivation1760000000023 } from './migrations/1760000000023-PilotOperatorActivation';
import { SharedInboxOperations1760000000024 } from './migrations/1760000000024-SharedInboxOperations';
import { MerchantAiPlayground1760000000025 } from './migrations/1760000000025-MerchantAiPlayground';
import { LeadQualification1760000000026 } from './migrations/1760000000026-LeadQualification';
import { SalesQualificationPolicy } from './entities/sales-qualification-policy.entity';
import { MerchantLeadQualification } from './entities/merchant-lead-qualification.entity';
import { MerchantLeadConversion } from './entities/merchant-lead-conversion.entity';
import { AgentToolExecution } from './entities/agent-tool-execution.entity';
import { AgentToolHandoffEvent } from './entities/agent-tool-handoff-event.entity';
import { AgentToolExecution1760000000027 } from './migrations/1760000000027-AgentToolExecution';
import { AgentActivationAndMemory1760000000028 } from './migrations/1760000000028-AgentActivationAndMemory';
import { LearningKnowledgeGaps1760000000029 } from './migrations/1760000000029-LearningKnowledgeGaps';
import { WebsiteChat1760000000030 } from './migrations/1760000000030-WebsiteChat';
import { KnowledgeDocument } from './entities/knowledge-document.entity';
import { KnowledgeDocumentRevision } from './entities/knowledge-document-revision.entity';
import { KnowledgeDocumentPage } from './entities/knowledge-document-page.entity';
import { KnowledgeDocumentUploads1760000000031 } from './migrations/1760000000031-KnowledgeDocumentUploads';
import { KnowledgeIndexGeneration } from './entities/knowledge-index-generation.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import { SemanticKnowledgeIndex1760000000032 } from './migrations/1760000000032-SemanticKnowledgeIndex';
import { LearningApprovalWorkflow1760000000033 } from './migrations/1760000000033-LearningApprovalWorkflow';
import { LearningSuggestion } from './entities/learning-suggestion.entity';
import { LearningSuggestionVersion } from './entities/learning-suggestion-version.entity';
import { LearningSuggestionDecision } from './entities/learning-suggestion-decision.entity';
import { LearningEvaluationRun } from './entities/learning-evaluation-run.entity';
import { LearningEvaluationResult } from './entities/learning-evaluation-result.entity';
import { MerchantBusinessInvitation } from './entities/merchant-business-invitation.entity';
import { MerchantTeamAudit } from './entities/merchant-team-audit.entity';
import { MerchantTeamInvitationAttempt } from './entities/merchant-team-invitation-attempt.entity';
import { MerchantTeamManagement1760000000034 } from './migrations/1760000000034-MerchantTeamManagement';
import { DurableWhatsAppProvisioning1760000000035 } from './migrations/1760000000035-DurableWhatsAppProvisioning';
import { MerchantAnalytics1760000000036 } from './migrations/1760000000036-MerchantAnalytics';

export const databaseEntities = [
  Business,
  User,
  Customer,
  Conversation,
  Message,
  PipelineStage,
  FollowUp,
  Task,
  AuditLog,
  Notification,
  OnboardingSession,
  AssistantSession,
  Sale,
  OutboxOperation,
  Account,
  BusinessMember,
  ChannelConnection,
  KnowledgeFaq,
  KnowledgeFaqRevision,
  MerchantProduct,
  MerchantProductRevision,
  MerchantLead,
  SalesQualificationPolicy,
  MerchantLeadQualification,
  MerchantLeadConversion,
  AgentToolExecution,
  AgentToolHandoffEvent,
  MerchantEmailDelivery,
  KnowledgeDocument,
  KnowledgeDocumentRevision,
  KnowledgeDocumentPage,
  KnowledgeIndexGeneration,
  KnowledgeChunk,
  LearningSuggestion,
  LearningSuggestionVersion,
  LearningSuggestionDecision,
  LearningEvaluationRun,
  LearningEvaluationResult,
  MerchantBusinessInvitation,
  MerchantTeamAudit,
  MerchantTeamInvitationAttempt,
];

export const databaseMigrations = [
  InitialSchema1759999999999,
  AddWebhookPersistence1760000000000,
  AddAssistantPersistence1760000000001,
  AddOutboxOperations1760000000002,
  AddTenantIntegrity1760000000003,
  AddMerchantAuth1760000000004,
  AddMerchantOnboarding1760000000005,
  AddChannelConnections1760000000006,
  SecureWhatsAppCredentials1760000000007,
  AddWebhookReceipts1760000000008,
  ProcessWhatsAppReceipts1760000000009,
  AddTenantUsageLedger1760000000010,
  DurableWhatsAppOutbound1760000000011,
  MerchantInbox1760000000012,
  MerchantFaqKnowledge1760000000013,
  MerchantProductCatalog1760000000014,
  PublishedKnowledgeSearch1760000000015,
  MerchantLeads1760000000016,
  AiResponseRuns1760000000017,
  MerchantPilotApproval1760000000018,
  MerchantSignupAndOnboarding1760000000019,
  MerchantEmailAuthentication1760000000020,
  DurableMerchantEmail1760000000021,
  MerchantEmbeddedWhatsApp1760000000022,
  PilotOperatorActivation1760000000023,
  SharedInboxOperations1760000000024,
  MerchantAiPlayground1760000000025,
  LeadQualification1760000000026,
  AgentToolExecution1760000000027,
  AgentActivationAndMemory1760000000028,
  LearningKnowledgeGaps1760000000029,
  WebsiteChat1760000000030,
  KnowledgeDocumentUploads1760000000031,
  SemanticKnowledgeIndex1760000000032,
  LearningApprovalWorkflow1760000000033,
  MerchantTeamManagement1760000000034,
  DurableWhatsAppProvisioning1760000000035,
  MerchantAnalytics1760000000036,
];
