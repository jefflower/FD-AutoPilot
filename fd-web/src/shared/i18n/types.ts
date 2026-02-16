import type { resources, defaultNS } from './config';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['zh-CN'];
    returnNull: false;
  }
}
