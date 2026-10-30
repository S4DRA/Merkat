declare module "web-push" {
  type Subscription = {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  type Options = {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL?: number;
    timeout?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
  };
  const webpush: {
    sendNotification(
      subscription: Subscription,
      payload: string,
      options: Options,
    ): Promise<{ statusCode: number }>;
    generateVAPIDKeys(): { publicKey: string; privateKey: string };
    generateRequestDetails(
      subscription: Subscription,
      payload: string,
      options: Options,
    ): { endpoint: string; headers: Record<string, string>; body: Uint8Array };
  };
  export default webpush;
}
