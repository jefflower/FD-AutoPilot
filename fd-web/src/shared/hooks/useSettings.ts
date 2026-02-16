import { useState, useEffect, useRef, useCallback } from 'react';
import { NotebookLMConfig, ClientSettings } from '../types/server';
import { getServerBaseUrl, setServerBaseUrl } from '../services/serverApi';
import { userSettingsApi } from '../services/serverApi';

const CLIENT_SETTINGS_APP_CODE = 'client-settings';

// localStorage fallback keys
const LS_KEY_TRANSLATION_LANG = 'fd_translation_lang';
const LS_KEY_NOTEBOOK_CONFIG = 'notebooklm_config';

const DEFAULT_NOTEBOOK_CONFIG: NotebookLMConfig = {
  notebookId: '7662c1de-8bba-4d54-b834-e38161f942f4',
  notebookUrl: 'https://notebooklm.google.com/notebook/7662c1de-8bba-4d54-b834-e38161f942f4',
  prompt: '请使用用户工单的语言，根据下面的工单内容（可能包含已经回复过的内容）简要的做出回复，直接给出回复内容即可\n\n${工单内容}'
};

export function useSettings() {
  const [serverUrl, setServerUrl] = useState(getServerBaseUrl);
  const [translationLang, setTranslationLang] = useState('zh-CN');
  const [notebookLMConfig, setNotebookLMConfig] = useState<NotebookLMConfig>(DEFAULT_NOTEBOOK_CONFIG);

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
          if (parsed.notebookLMConfig) {
            setNotebookLMConfig(prev => ({ ...prev, ...parsed.notebookLMConfig }));
          }
          // Also update localStorage as fallback cache
          if (parsed.translationLang) {
            localStorage.setItem(LS_KEY_TRANSLATION_LANG, parsed.translationLang);
          }
          if (parsed.notebookLMConfig) {
            localStorage.setItem(LS_KEY_NOTEBOOK_CONFIG, JSON.stringify(parsed.notebookLMConfig));
          }
        }
      } catch {
        // Server unavailable — load from localStorage fallback
        if (cancelled) return;
        try {
          const cachedLang = localStorage.getItem(LS_KEY_TRANSLATION_LANG);
          if (cachedLang) setTranslationLang(cachedLang);

          const cachedNotebook = localStorage.getItem(LS_KEY_NOTEBOOK_CONFIG);
          if (cachedNotebook) {
            const parsed = JSON.parse(cachedNotebook);
            setNotebookLMConfig(prev => ({ ...prev, ...parsed }));
          }
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
  const saveToServer = useCallback(async (lang: string, config: NotebookLMConfig) => {
    const settingsJson = JSON.stringify({
      translationLang: lang,
      notebookLMConfig: config,
    } satisfies ClientSettings);

    try {
      await userSettingsApi.saveSettings(CLIENT_SETTINGS_APP_CODE, settingsJson);
      // Also update localStorage as fallback cache
      localStorage.setItem(LS_KEY_TRANSLATION_LANG, lang);
      localStorage.setItem(LS_KEY_NOTEBOOK_CONFIG, JSON.stringify(config));
    } catch {
      // Server unavailable — save to localStorage as fallback
      try {
        localStorage.setItem(LS_KEY_TRANSLATION_LANG, lang);
        localStorage.setItem(LS_KEY_NOTEBOOK_CONFIG, JSON.stringify(config));
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
      saveToServer(translationLang, notebookLMConfig);
    }, 500);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [translationLang, notebookLMConfig, saveToServer]);

  // serverUrl — sync to serverApi module
  useEffect(() => {
    setServerBaseUrl(serverUrl);
  }, [serverUrl]);

  return {
    serverUrl, setServerUrl,
    translationLang, setTranslationLang,
    notebookLMConfig, setNotebookLMConfig
  };
}
