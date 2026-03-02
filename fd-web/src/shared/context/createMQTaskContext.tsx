/**
 * 兼容桥接文件
 *
 * 原有的 createMQTaskContext 已拆分到 ./mq-task/ 目录。
 * 此文件 re-export 所有公共 API 以保持外部 import 路径不变。
 */
export { createMQTaskContext } from './mq-task/createMQTaskContext';
export type { MQTask, TaskCallbacks, MQTaskContextType, MQTaskConfig } from './mq-task/types';
