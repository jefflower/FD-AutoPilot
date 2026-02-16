import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Auth 页面（首屏加载）
import AuthLoginTab from '../modules/auth/pages/AuthLoginTab';
import AuthRegisterTab from '../modules/auth/pages/AuthRegisterTab';

// 懒加载业务页面
const ServerTicketsTab = lazy(() => import('../modules/ticket/pages/ServerTicketsTab'));
const TranslationTasksTab = lazy(() => import('../modules/ticket/pages/TranslationTasksTab'));
const ReplyTasksTab = lazy(() => import('../modules/ticket/pages/ReplyTasksTab'));
const AuditTasksTab = lazy(() => import('../modules/ticket/pages/AuditTasksTab'));
const ApprovedTasksTab = lazy(() => import('../modules/ticket/pages/ApprovedTasksTab'));
const AdminUsersTab = lazy(() => import('../modules/admin/pages/AdminUsersTab'));
const ManualSyncTab = lazy(() => import('../modules/admin/pages/ManualSyncTab'));
const KnowledgeTab = lazy(() => import('../modules/admin/pages/KnowledgeTab'));
const DatabaseTab = lazy(() => import('../modules/admin/pages/DatabaseTab'));
const ServerLogsTab = lazy(() => import('../modules/admin/pages/ServerLogsTab'));
const TaskDashboardTab = lazy(() => import('../modules/task/pages/TaskDashboardTab'));
const TaskDefinitionsTab = lazy(() => import('../modules/task/pages/TaskDefinitionsTab'));
const TaskHistoryTab = lazy(() => import('../modules/task/pages/TaskHistoryTab'));
const SettingsTab = lazy(() => import('../modules/system/pages/SettingsTab'));
const UserProfileTab = lazy(() => import('../modules/system/pages/UserProfileTab'));

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
  </div>
);

export {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Suspense,
  LoadingFallback,
  // Auth
  AuthLoginTab,
  AuthRegisterTab,
  // Ticket
  ServerTicketsTab,
  TranslationTasksTab,
  ReplyTasksTab,
  AuditTasksTab,
  ApprovedTasksTab,
  // Admin
  AdminUsersTab,
  ManualSyncTab,
  KnowledgeTab,
  DatabaseTab,
  ServerLogsTab,
  // Task
  TaskDashboardTab,
  TaskDefinitionsTab,
  TaskHistoryTab,
  // System
  SettingsTab,
  UserProfileTab,
};
