package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.ClientRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ClientRequestRepository extends JpaRepository<ClientRequest, Long> {
}
