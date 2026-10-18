export interface PushSendOutcome {
  token: string;
  success: boolean;
  providerMessageId: string | null;
  shouldDeactivate: boolean;
  errorMessage: string | null;
}
