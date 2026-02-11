import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Settings, NotebookLMConfig } from '../types';
import { getServerBaseUrl, setServerBaseUrl } from '../services/serverApi';

export function useSettings() {
  const [serverUrl, setServerUrl] = useState(getServerBaseUrl);

  // MQ 配置
  const [mqHost, setMqHost] = useState('localhost');
  const [mqPort, setMqPort] = useState(5672);
  const [mqUsername, setMqUsername] = useState('guest');
  const [mqPassword, setMqPassword] = useState('guest');
  const [translationLang, setTranslationLang] = useState('zh-CN');

  // MQ 队列名配置
  const [mqQueueTranslation, setMqQueueTranslation] = useState('q.ticket.translation');
  const [mqQueueReply, setMqQueueReply] = useState('q.ticket.reply');
  const [mqQueueAudit, setMqQueueAudit] = useState('q.ticket.audit');
  const [mqQueueDlq, setMqQueueDlq] = useState('q.ticket.dlq');

  // NotebookLM 配置
  const [notebookLMConfig, setNotebookLMConfig] = useState<NotebookLMConfig>({
    notebookId: '7662c1de-8bba-4d54-b834-e38161f942f4',
    notebookUrl: 'https://notebooklm.google.com/notebook/7662c1de-8bba-4d54-b834-e38161f942f4',
    prompt: '请使用用户工单的语言，根据下面的工单内容（可能包含已经回复过的内容）简要的做出回复，直接给出回复内容即可\n\n${工单内容}'
  });

  // 加载配置
  useEffect(() => {
    invoke<Settings>("load_settings_cmd").then((settings) => {
      if (settings.mq_host) setMqHost(settings.mq_host);
      if (settings.mq_port) setMqPort(settings.mq_port);
      if (settings.mq_username) setMqUsername(settings.mq_username);
      if (settings.mq_password) setMqPassword(settings.mq_password);
      if (settings.translation_lang) setTranslationLang(settings.translation_lang);
      if (settings.mq_queue_translation) setMqQueueTranslation(settings.mq_queue_translation);
      if (settings.mq_queue_reply) setMqQueueReply(settings.mq_queue_reply);
      if (settings.mq_queue_audit) setMqQueueAudit(settings.mq_queue_audit);
      if (settings.mq_queue_dlq) setMqQueueDlq(settings.mq_queue_dlq);
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

  // 自动保存设置（不含队列名，队列名由服务端管理，通过 sync_mq_queues_cmd 同步）
  useEffect(() => {
    const timeout = setTimeout(() => {
      invoke("save_settings_cmd", {
        mqHost,
        mqPort,
        mqUsername,
        mqPassword,
        translationLang,
        mqQueueTranslation,
        mqQueueReply,
        mqQueueAudit,
        mqQueueDlq,
      }).catch(console.error);
    }, 500);
    return () => clearTimeout(timeout);
  }, [mqHost, mqPort, mqUsername, mqPassword, translationLang]);

  // serverUrl 变更时同步到 serverApi 模块
  useEffect(() => {
    setServerBaseUrl(serverUrl);
  }, [serverUrl]);

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
    serverUrl, setServerUrl,
    mqHost, setMqHost,
    mqPort, setMqPort,
    mqUsername, setMqUsername,
    mqPassword, setMqPassword,
    translationLang, setTranslationLang,
    mqQueueTranslation, setMqQueueTranslation,
    mqQueueReply, setMqQueueReply,
    mqQueueAudit, setMqQueueAudit,
    mqQueueDlq, setMqQueueDlq,
    notebookLMConfig, setNotebookLMConfig
  };
}
