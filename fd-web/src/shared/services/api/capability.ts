/**
 * Capability API 和 Client Registration API
 */
import type {
  CapabilityDefinition,
  AgentInstance,
  ClientRegistration,
  ClientRegisterRequest,
  ClientRegisterResponse,
  ClientHeartbeatRequest,
  ClientHeartbeatResponse,
} from '../../types/server';
import { request } from './client';

// ============ Capability API ============
export const capabilityApi = {
  getCapabilities: (): Promise<CapabilityDefinition[]> =>
    request<CapabilityDefinition[]>('/capabilities').then(r => r || []),

  getAllCapabilities: (): Promise<CapabilityDefinition[]> =>
    request<CapabilityDefinition[]>('/capabilities/all').then(r => r || []),

  getCapability: (code: string): Promise<CapabilityDefinition> =>
    request<CapabilityDefinition>(`/capabilities/${code}`),

  createCapability: (cap: Partial<CapabilityDefinition>): Promise<CapabilityDefinition> =>
    request<CapabilityDefinition>('/capabilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cap),
    }),

  updateCapability: (id: number, cap: Partial<CapabilityDefinition>): Promise<CapabilityDefinition> =>
    request<CapabilityDefinition>(`/capabilities/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cap),
    }),

  toggleCapability: (id: number): Promise<void> =>
    request<void>(`/capabilities/${id}/toggle`, { method: 'PUT' }),

  deleteCapability: (id: number): Promise<void> =>
    request<void>(`/capabilities/${id}`, { method: 'DELETE' }),
};

// ============ Client Registration API ============
export const clientApi = {
  register: (req: ClientRegisterRequest): Promise<ClientRegisterResponse> =>
    request<ClientRegisterResponse>('/client/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),

  heartbeat: (req: ClientHeartbeatRequest): Promise<ClientHeartbeatResponse> =>
    request<ClientHeartbeatResponse>('/client/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }),

  getInstances: (clientId: string): Promise<AgentInstance[]> =>
    request<AgentInstance[]>(`/client/instances?clientId=${encodeURIComponent(clientId)}`).then(r => r || []),

  getOnlineClients: (): Promise<ClientRegistration[]> =>
    request<ClientRegistration[]>('/client/online').then(r => r || []),
};
