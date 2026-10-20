/** Public (browser-safe) settings. Never put secrets here. */
export const publicConfig = {
  appName: "Exam Sprint",
  statusEndpoint: "/api/status",
  sessionEndpoint: "/api/session",
  challengeEndpoint: "/api/challenge",
} as const;
