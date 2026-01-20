package com.jefflower.fdserver.controller;

import com.jefflower.fdserver.model.ClientRequest;
import com.jefflower.fdserver.repository.ClientRequestRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/requests")
public class RequestController {

    @Autowired
    private ClientRequestRepository repository;

    @PostMapping
    public ClientRequest createRequest(@RequestBody String payload, HttpServletRequest request) {
        ClientRequest clientRequest = new ClientRequest();
        clientRequest.setPayload(payload);
        clientRequest.setClientIp(request.getRemoteAddr());
        clientRequest.setEndpoint(request.getRequestURI());
        clientRequest.setCreatedAt(LocalDateTime.now());
        return repository.save(clientRequest);
    }

    @GetMapping
    public List<ClientRequest> getAllRequests() {
        return repository.findAll();
    }
}
