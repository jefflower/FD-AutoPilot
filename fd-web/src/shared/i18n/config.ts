import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zhCommon from './locales/zh-CN/common.json';
import zhAuth from './locales/zh-CN/auth.json';
import zhTickets from './locales/zh-CN/tickets.json';
import zhTasks from './locales/zh-CN/tasks.json';
import zhAdmin from './locales/zh-CN/admin.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhOrgSync from './locales/zh-CN/orgSync.json';
import zhKnowledge from './locales/zh-CN/knowledge.json';

import enCommon from './locales/en-US/common.json';
import enAuth from './locales/en-US/auth.json';
import enTickets from './locales/en-US/tickets.json';
import enTasks from './locales/en-US/tasks.json';
import enAdmin from './locales/en-US/admin.json';
import enSettings from './locales/en-US/settings.json';
import enOrgSync from './locales/en-US/orgSync.json';
import enKnowledge from './locales/en-US/knowledge.json';

export const defaultNS = 'common';

export const resources = {
  'zh-CN': {
    common: zhCommon,
    auth: zhAuth,
    tickets: zhTickets,
    tasks: zhTasks,
    admin: zhAdmin,
    settings: zhSettings,
    orgSync: zhOrgSync,
    knowledge: zhKnowledge,
  },
  'en-US': {
    common: enCommon,
    auth: enAuth,
    tickets: enTickets,
    tasks: enTasks,
    admin: enAdmin,
    settings: enSettings,
    orgSync: enOrgSync,
    knowledge: enKnowledge,
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
