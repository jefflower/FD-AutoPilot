package com.jefflower.fdserver.ticket.repository;

import com.jefflower.fdserver.ticket.entity.KnowledgeGroup;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface KnowledgeGroupRepository extends JpaRepository<KnowledgeGroup, Long> {

    List<KnowledgeGroup> findAllByOrderByCreatedAtDesc();
}
