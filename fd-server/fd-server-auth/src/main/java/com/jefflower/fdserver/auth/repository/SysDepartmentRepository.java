package com.jefflower.fdserver.auth.repository;

import com.jefflower.fdserver.auth.entity.SysDepartment;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface SysDepartmentRepository extends JpaRepository<SysDepartment, Long> {
    Optional<SysDepartment> findByExternalIdAndPlatform(String externalId, String platform);

    List<SysDepartment> findByPlatformOrderBySortOrder(String platform);

    List<SysDepartment> findByParentIdOrderBySortOrder(Long parentId);

    void deleteByPlatform(String platform);
}
