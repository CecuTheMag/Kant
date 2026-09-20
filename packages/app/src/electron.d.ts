interface KantDesktopAPI {
  getRelayStatus: () => Promise<{
    running: boolean;
    pid: number | null;
    sharedRunning: boolean;
    sharedUrl: string | null;
  }>;
  startSharedRelay: () => Promise<{ ok: boolean; url: string; error?: string }>;
  stopSharedRelay: () => Promise<{ ok: boolean }>;
  showNotification: (title: string, body: string) => Promise<void>;
  platform: string;
  isDesktop: boolean;
}

declare global {
  interface Window {
    kantDesktop?: KantDesktopAPI;
  }
}

export {};
