package com.jefflower.fdserver.ticket.controller;

import com.jefflower.fdserver.ticket.entity.ClientRequest;
import com.jefflower.fdserver.ticket.repository.ClientRequestRepository;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@Tag(name = "请求管理", description = "客户端请求记录的存取")
@RestController
@RequestMapping("/api/requests")
public class RequestController {

    @Autowired
    private ClientRequestRepository repository;

    @Operation(summary = "创建请求记录", description = "记录一条客户端请求信息（包含 payload、客户端 IP、请求端点）")
    @PostMapping
    public ClientRequest createRequest(@RequestBody String payload, HttpServletRequest request) {
        ClientRequest clientRequest = new ClientRequest();
        clientRequest.setPayload(payload);
        clientRequest.setClientIp(request.getRemoteAddr());
        clientRequest.setEndpoint(request.getRequestURI());
        clientRequest.setCreatedAt(LocalDateTime.now());
        return repository.save(clientRequest);
    }

    @Operation(summary = "获取所有请求记录", description = "获取所有已记录的客户端请求列表")
    @GetMapping
    public List<ClientRequest> getAllRequests() {
        return repository.findAll();
    }
}
