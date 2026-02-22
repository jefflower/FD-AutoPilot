import { useState, useEffect, useRef, useCallback } from 'react';
import { ClientSettings } from '../types/server';
import { getServerBaseUrl, setServerBaseUrl } from '../services/serverApi';
import { userSettingsApi } from '../services/serverApi';

const CLIENT_SETTINGS_APP_CODE = 'client-settings';

// localStorage fallback keys
const LS_KEY_TRANSLATION_LANG = 'fd_translation_lang';

export function useSettings() {
  const [serverUrl, setServerUrl] = useState(getServerBaseUrl);
  const [translationLang, setTranslationLang] = useState('zh-CN');

  // Track whether initial load from server is done to avoid saving back defaults
  const initialLoadDone = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load settings from server on mount
  useEffect(() => {
    let cancelled = false;

    async function loadFromServer() {
      try {
        const raw = await userSettingsApi.getSettings(CLIENT_SETTINGS_APP_CODE);
        if (cancelled) return;

        if (raw) {
          const parsed: Partial<ClientSettings> = JSON.parse(raw);
          if (parsed.translationLang) {
            setTranslationLang(parsed.translationLang);
          }
          // Also update localStorage as fallback cache
          if (parsed.translationLang) {
            localStorage.setItem(LS_KEY_TRANSLATION_LANG, parsed.translationLang);
          }
        }
      } catch {
        // Server unavailable — load from localStorage fallback
        if (cancelled) return;
        try {
          const cachedLang = localStorage.getItem(LS_KEY_TRANSLATION_LANG);
          if (cachedLang) setTranslationLang(cachedLang);
        } catch (e) {
          console.error('Failed to load settings from localStorage fallback:', e);
        }
      } finally {
        if (!cancelled) {
          initialLoadDone.current = true;
        }
      }
    }

    loadFromServer();
    return () => { cancelled = true; };
  }, []);

  // Auto-save settings to server (debounced 500ms)
  const saveToServer = useCallback(async (lang: string) => {
    const settingsJson = JSON.stringify({
      translationLang: lang,
    } satisfies ClientSettings);

    try {
      await userSettingsApi.saveSettings(CLIENT_SETTINGS_APP_CODE, settingsJson);
      localStorage.setItem(LS_KEY_TRANSLATION_LANG, lang);
    } catch {
      // Server unavailable — save to localStorage as fallback
      try {
        localStorage.setItem(LS_KEY_TRANSLATION_LANG, lang);
      } catch (e) {
        console.error('Failed to save settings to localStorage fallback:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (!initialLoadDone.current) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveToServer(translationLang);
    }, 500);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [translationLang, saveToServer]);

  // serverUrl — sync to serverApi module
  useEffect(() => {
    setServerBaseUrl(serverUrl);
  }, [serverUrl]);

  return {
    serverUrl, setServerUrl,
    translationLang, setTranslationLang,
  };
}
