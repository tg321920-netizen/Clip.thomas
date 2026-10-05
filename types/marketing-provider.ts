import type { MarketingChannel, MarketingObjective } from "./marketing";

/** Future paid-media boundary. Organic delivery stays in SocialPublishingRouter.
 * These contracts do not register a provider, create ads or authorize spending.
 */
export interface BusinessMarketingProfile {
  id: string;
  name: string;
  brandId: string | null;
  productProfileIds: string[];
  audience: string;
  objectives: MarketingObjective[];
  tone: string;
  timezone: string;
  channels: MarketingChannel[];
  promotions: Array<{
    id: string;
    sourceId: string;
    startsAt: string;
    endsAt: string;
    approvedClaims: string[];
  }>;
}

export interface MarketingCampaignDraft {
  id: string;
  businessId: string;
  workflowExecutionId: string;
  objective: MarketingObjective;
  adAccountId: string | null;
  currency: string;
  /** Integer minor currency units; never infer or increase a spending limit. */
  budget: { dailyMinor: number | null; lifetimeMinor: number | null };
  adSets: Array<{
    id: string;
    audience: Record<string, unknown>;
    startsAt: string;
    endsAt: string | null;
    ads: Array<{
      id: string;
      generationId: string;
      variantId: string;
      assetIds: string[];
      copy: string;
      cta: string;
      destinationUrl: string | null;
    }>;
  }>;
}

export interface MarketingMetrics {
  campaignId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  impressions: number | null;
  clicks: number | null;
  spendMinor: number | null;
  conversions: number | null;
  revenueMinor: number | null;
  cpmMinor: number | null;
  cpcMinor: number | null;
  ctr: number | null;
  costPerResultMinor: number | null;
  roas: number | null;
  attribution: string | null;
}

/** A future MetaMarketingProvider implements this independently of FacebookProvider.
 * Connection IDs reference CredentialVault; tokens never belong in these DTOs.
 * Submission requires a separate implementation and explicit spend authorization.
 */
export interface MarketingProvider {
  readonly platform: string;
  capabilities(): {
    campaignPreview: boolean;
    campaignSubmission: boolean;
    analytics: boolean;
    experiments: boolean;
  };
  validateDraft(draft: MarketingCampaignDraft): Promise<{
    valid: boolean;
    missingInformation: string[];
  }>;
  preview(draft: MarketingCampaignDraft): Promise<{
    dryRun: true;
    draftId: string;
    payload: Record<string, unknown>;
    warnings: string[];
  }>;
  getAnalytics(connectionId: string, campaignId: string): Promise<MarketingMetrics>;
}
