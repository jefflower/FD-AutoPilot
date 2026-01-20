package com.jefflower.fdserver.repository;

import com.jefflower.fdserver.model.ClientRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ClientRequestRepository extends JpaRepository<ClientRequest, Long> {
}
