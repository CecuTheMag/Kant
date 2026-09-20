import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kant.messenger',
  appName: 'Kant',
  webDir: 'dist',
  // Production relays should use HTTPS/WSS. Keep cleartext disabled so an APK
  // cannot silently downgrade relay traffic to an unencrypted HTTP endpoint.
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    backgroundColor: '#08090b',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: '#08090b',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
