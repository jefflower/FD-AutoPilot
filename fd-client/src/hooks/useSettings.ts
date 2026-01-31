import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Settings, NotebookLMConfig } from '../types';

export function useSettings() {
  const [apiKey, setApiKey] = useState("");
  const [outputDir, setOutputDir] = useState("data");
  const [syncStartDate, setSyncStartDate] = useState("2025-01");

  // MQ 配置状态（扁平化）
  const [mqHost, setMqHost] = useState('localhost');
  const [mqPort, setMqPort] = useState(5672);
  const [mqUsername, setMqUsername] = useState('guest');
  const [mqPassword, setMqPassword] = useState('guest');
  const [translationLang, setTranslationLang] = useState('cn');

  // NotebookLM配置状态
  const [notebookLMConfig, setNotebookLMConfig] = useState<NotebookLMConfig>({
    cookie: '',
    atToken: '',
    fSid: '',
    notebookId: '7662c1de-8bba-4d54-b834-e38161f942f4',
    notebookUrl: 'https://notebooklm.google.com/notebook/7662c1de-8bba-4d54-b834-e38161f942f4',
    prompt: '请使用用户工单的语言，根据下面的工单内容（可能包含已经回复过的内容）简要的做出回复，直接给出回复内容即可\n\n${工单内容}'
  });

  // 加载配置
  useEffect(() => {
    invoke<Settings>("load_settings_cmd").then((settings) => {
      if (settings.api_key) setApiKey(settings.api_key);
      if (settings.output_dir) setOutputDir(settings.output_dir);
      if (settings.sync_start_date) setSyncStartDate(settings.sync_start_date);
      // MQ 配置
      if (settings.mq_host) setMqHost(settings.mq_host);
      if (settings.mq_port) setMqPort(settings.mq_port);
      if (settings.mq_username) setMqUsername(settings.mq_username);
      if (settings.mq_password) setMqPassword(settings.mq_password);
      if (settings.translation_lang) setTranslationLang(settings.translation_lang);
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

  // 自动保存设置（含 MQ 配置）
  useEffect(() => {
    const timeout = setTimeout(() => {
      invoke("save_settings_cmd", { 
        apiKey, 
        outputDir, 
        syncStartDate,
        mqHost,
        mqPort,
        mqUsername,
        mqPassword,
        translationLang,
      }).catch(console.error);
    }, 500);
    return () => clearTimeout(timeout);
  }, [apiKey, outputDir, syncStartDate, mqHost, mqPort, mqUsername, mqPassword, translationLang]);

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
    mqHost, setMqHost,
    mqPort, setMqPort,
    mqUsername, setMqUsername,
    mqPassword, setMqPassword,
    translationLang, setTranslationLang,
    notebookLMConfig, setNotebookLMConfig
  };
}

