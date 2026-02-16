import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zhCommon from './locales/zh-CN/common.json';
import zhAuth from './locales/zh-CN/auth.json';
import zhTickets from './locales/zh-CN/tickets.json';
import zhTasks from './locales/zh-CN/tasks.json';
import zhTaskAdmin from './locales/zh-CN/taskAdmin.json';
import zhAdmin from './locales/zh-CN/admin.json';
import zhSettings from './locales/zh-CN/settings.json';

import enCommon from './locales/en-US/common.json';
import enAuth from './locales/en-US/auth.json';
import enTickets from './locales/en-US/tickets.json';
import enTasks from './locales/en-US/tasks.json';
import enTaskAdmin from './locales/en-US/taskAdmin.json';
import enAdmin from './locales/en-US/admin.json';
import enSettings from './locales/en-US/settings.json';

export const defaultNS = 'common';

export const resources = {
  'zh-CN': {
    common: zhCommon,
    auth: zhAuth,
    tickets: zhTickets,
    tasks: zhTasks,
    taskAdmin: zhTaskAdmin,
    admin: zhAdmin,
    settings: zhSettings,
  },
  'en-US': {
    common: enCommon,
    auth: enAuth,
    tickets: enTickets,
    tasks: enTasks,
    taskAdmin: enTaskAdmin,
    admin: enAdmin,
    settings: enSettings,
  },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    fallbackLng: 'zh-CN',
    supportedLngs: ['zh-CN', 'en-US'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'fd-autopilot-lang',
      caches: ['localStorage'],
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
