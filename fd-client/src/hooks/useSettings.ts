import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Settings, NotebookLMConfig } from '../types';

export function useSettings() {
  const [apiKey, setApiKey] = useState("");
  const [outputDir, setOutputDir] = useState("data");
  const [syncStartDate, setSyncStartDate] = useState("2025-01");

  // NotebookLM配置状态
  const [notebookLMConfig, setNotebookLMConfig] = useState<NotebookLMConfig>({
    cookie: '',
    atToken: '',
    fSid: '',
    notebookId: '7662c1de-8bba-4d54-b834-e38161f942f4',
    prompt: '请使用用户工单的语言，根据下面的工单内容（可能包含已经回复过的内容）简要的做出回复，直接给出回复内容即可\n\n${工单内容}'
  });

  // 加载配置
  useEffect(() => {
    invoke<Settings>("load_settings_cmd").then((settings) => {
      if (settings.api_key) setApiKey(settings.api_key);
      if (settings.output_dir) setOutputDir(settings.output_dir);
      if (settings.sync_start_date) setSyncStartDate(settings.sync_start_date);
    }).catch(console.error);

    try {
      const savedConfig = localStorage.getItem('notebooklm_config');
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        setNotebookLMConfig(prev => ({ ...prev, ...parsed }));
      }
    } catch (error) {
      console.error('Failed to load NotebookLM config:', error);
    }
  }, []);

  // 自动保存 Freshdesk 设置
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (apiKey || outputDir !== "data" || syncStartDate !== "2025-01") {
        invoke("save_settings_cmd", { apiKey, outputDir, syncStartDate }).catch(console.error);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [apiKey, outputDir, syncStartDate]);

  // 自动保存 NotebookLM 配置
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem('notebooklm_config', JSON.stringify(notebookLMConfig));
      } catch (error) {
        console.error('Failed to save NotebookLM config:', error);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [notebookLMConfig]);

  return {
    apiKey, setApiKey,
    outputDir, setOutputDir,
    syncStartDate, setSyncStartDate,
    notebookLMConfig, setNotebookLMConfig
  };
}
