import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.stockm.app',
  appName: 'StockM',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#0f172a',
  },
  server: {
    // In production the app loads from the built files.
    // For live-reload during development, uncomment the url below:
    // url: 'http://YOUR_LOCAL_IP:3000',
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#0f172a',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f172a',
    },
  },
};

export default config;
