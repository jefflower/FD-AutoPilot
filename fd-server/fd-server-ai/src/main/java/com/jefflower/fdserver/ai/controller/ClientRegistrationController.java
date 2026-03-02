package com.jefflower.fdserver.ai.controller;

import com.jefflower.fdserver.ai.dto.ClientHeartbeatRequest;
import com.jefflower.fdserver.ai.dto.ClientHeartbeatResponse;
import com.jefflower.fdserver.ai.dto.ClientRegisterRequest;
import com.jefflower.fdserver.ai.dto.ClientRegisterResponse;
import com.jefflower.fdserver.ai.entity.AgentInstance;
import com.jefflower.fdserver.ai.entity.ClientRegistration;
import com.jefflower.fdserver.ai.service.AgentInstanceService;
import com.jefflower.fdserver.ai.service.ClientRegistrationService;
import com.jefflower.fdserver.common.dto.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "客户端注册", description = "客户端注册、心跳、在线状态管理")
@RestController
@RequestMapping("/api/v1/client")
public class ClientRegistrationController {

    private final ClientRegistrationService registrationService;
    private final AgentInstanceService instanceService;

    public ClientRegistrationController(ClientRegistrationService registrationService,
                                         AgentInstanceService instanceService) {
        this.registrationService = registrationService;
        this.instanceService = instanceService;
    }

    @PostMapping("/register")
    public ApiResponse<ClientRegisterResponse> register(@RequestBody ClientRegisterRequest request,
                                                         Authentication auth) {
        String userId = extractUserId(auth);
        ClientRegisterResponse response = registrationService.register(userId, request);
        return ApiResponse.ok(response);
    }

    @PostMapping("/heartbeat")
    public ApiResponse<ClientHeartbeatResponse> heartbeat(@RequestBody ClientHeartbeatRequest request,
                                                           Authentication auth) {
        String userId = extractUserId(auth);
        ClientHeartbeatResponse response = registrationService.heartbeat(userId, request);
        return ApiResponse.ok(response);
    }

    @GetMapping("/instances")
    public ApiResponse<List<AgentInstance>> getInstances(@RequestParam String clientId) {
        return ApiResponse.ok(instanceService.getInstancesByClientId(clientId));
    }

    @GetMapping("/online")
    public ApiResponse<List<ClientRegistration>> getOnlineClients() {
        return ApiResponse.ok(registrationService.getOnlineClients());
    }

    /**
     * Extract userId from Authentication.
     * JWT filter stores userId in authentication.details.
     */
    private String extractUserId(Authentication auth) {
        if (auth != null && auth.getDetails() != null) {
            return String.valueOf(auth.getDetails());
        }
        return auth != null ? auth.getName() : "anonymous";
    }
}
