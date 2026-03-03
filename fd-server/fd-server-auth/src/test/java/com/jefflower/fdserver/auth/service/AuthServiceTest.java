package com.jefflower.fdserver.auth.service;

import com.jefflower.fdserver.common.exception.BusinessException;
import com.jefflower.fdserver.common.exception.ErrorCode;
import com.jefflower.fdserver.auth.dto.TokenPair;
import com.jefflower.fdserver.auth.entity.SysRole;
import com.jefflower.fdserver.auth.entity.SysUserRole;
import com.jefflower.fdserver.auth.repository.SysRoleRepository;
import com.jefflower.fdserver.auth.repository.SysUserRoleRepository;
import com.jefflower.fdserver.auth.service.AuthService;
import com.jefflower.fdserver.auth.service.PermissionCacheService;
import com.jefflower.fdserver.auth.service.TokenService;
import com.jefflower.fdserver.auth.dto.LoginRequest;
import com.jefflower.fdserver.auth.dto.LoginResponse;
import com.jefflower.fdserver.auth.dto.RegisterRequest;
import com.jefflower.fdserver.auth.entity.SysUser;
import com.jefflower.fdserver.auth.enums.UserStatus;
import com.jefflower.fdserver.auth.repository.SysUserRepository;
import com.jefflower.fdserver.auth.security.JwtUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private SysUserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private JwtUtil jwtUtil;

    @Mock
    private TokenService tokenService;

    @Mock
    private SysUserRoleRepository sysUserRoleRepository;

    @Mock
    private SysRoleRepository sysRoleRepository;

    @Mock
    private PermissionCacheService permissionCacheService;

    @InjectMocks
    private AuthService authService;

    private SysUser approvedUser;
    private SysUser pendingUser;

    @BeforeEach
    void setUp() {
        approvedUser = new SysUser();
        approvedUser.setId(1L);
        approvedUser.setUsername("testuser");
        approvedUser.setPassword("encoded_password");
        approvedUser.setStatus(UserStatus.APPROVED);

        pendingUser = new SysUser();
        pendingUser.setId(2L);
        pendingUser.setUsername("pendinguser");
        pendingUser.setPassword("encoded_password");
        pendingUser.setStatus(UserStatus.PENDING);
    }

    // ========== login ==========

    @Test
    void login_success() {
        LoginRequest request = new LoginRequest();
        request.setUsername("testuser");
        request.setPassword("rawpass");

        // Mock RBAC role lookup: user has USER role via sys_user_role
        SysUserRole userRole = new SysUserRole(1L, 10L);
        SysRole role = new SysRole("USER", "普通用户", "工单操作", true);
        role.setId(10L);
        when(sysUserRoleRepository.findByUserId(1L)).thenReturn(List.of(userRole));
        when(sysRoleRepository.findById(10L)).thenReturn(Optional.of(role));

        TokenPair tokenPair = TokenPair.builder()
                .accessToken("jwt-access-token")
                .refreshToken("refresh-token-uuid")
                .accessTokenExpireAt(System.currentTimeMillis() + 1800000L)
                .refreshTokenExpireAt(System.currentTimeMillis() + 604800000L)
                .build();

        when(userRepository.findByUsername("testuser")).thenReturn(Optional.of(approvedUser));
        when(passwordEncoder.matches("rawpass", "encoded_password")).thenReturn(true);
        when(tokenService.createTokenPair(eq(1L), eq("testuser"), eq(List.of("USER")))).thenReturn(tokenPair);

        LoginResponse response = authService.login(request);

        assertNotNull(response);
        assertEquals("jwt-access-token", response.getToken());
        assertEquals("jwt-access-token", response.getAccessToken());
        assertEquals("refresh-token-uuid", response.getRefreshToken());
        assertNotNull(response.getExpireAt());
        assertEquals(1L, response.getUser().getId());
        assertEquals("testuser", response.getUser().getUsername());
        assertEquals("USER", response.getUser().getRole());
        assertEquals(List.of("USER"), response.getUser().getRoles());
    }

    @Test
    void login_userNotFound_throwsException() {
        LoginRequest request = new LoginRequest();
        request.setUsername("noone");
        request.setPassword("pass");

        when(userRepository.findByUsername("noone")).thenReturn(Optional.empty());

        BusinessException ex = assertThrows(BusinessException.class, () -> authService.login(request));
        assertEquals(ErrorCode.USER_NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void login_wrongPassword_throwsException() {
        LoginRequest request = new LoginRequest();
        request.setUsername("testuser");
        request.setPassword("wrong");

        when(userRepository.findByUsername("testuser")).thenReturn(Optional.of(approvedUser));
        when(passwordEncoder.matches("wrong", "encoded_password")).thenReturn(false);

        BusinessException ex = assertThrows(BusinessException.class, () -> authService.login(request));
        assertEquals(ErrorCode.WRONG_PASSWORD, ex.getErrorCode());
    }

    @Test
    void login_userNotApproved_throwsException() {
        LoginRequest request = new LoginRequest();
        request.setUsername("pendinguser");
        request.setPassword("rawpass");

        when(userRepository.findByUsername("pendinguser")).thenReturn(Optional.of(pendingUser));
        when(passwordEncoder.matches("rawpass", "encoded_password")).thenReturn(true);

        BusinessException ex = assertThrows(BusinessException.class, () -> authService.login(request));
        assertEquals(ErrorCode.USER_NOT_APPROVED, ex.getErrorCode());
    }

    // ========== register ==========

    @Test
    void register_success() {
        RegisterRequest request = new RegisterRequest();
        request.setUsername("newuser");
        request.setPassword("password123");

        SysRole userRole = new SysRole("USER", "普通用户", "工单操作", true);
        userRole.setId(10L);

        when(userRepository.existsByUsername("newuser")).thenReturn(false);
        when(passwordEncoder.encode("password123")).thenReturn("encoded_new");
        when(userRepository.save(any(SysUser.class))).thenAnswer(invocation -> {
            SysUser saved = invocation.getArgument(0);
            saved.setId(10L);
            return saved;
        });
        when(sysRoleRepository.findByCode("USER")).thenReturn(Optional.of(userRole));
        when(sysUserRoleRepository.save(any(SysUserRole.class))).thenAnswer(i -> i.getArgument(0));

        SysUser result = authService.register(request);

        assertNotNull(result);
        assertEquals("newuser", result.getUsername());
        assertEquals("encoded_new", result.getPassword());
        assertEquals(UserStatus.PENDING, result.getStatus());

        // 验证 RBAC 角色分配
        verify(sysRoleRepository).findByCode("USER");
        verify(sysUserRoleRepository).save(any(SysUserRole.class));

        ArgumentCaptor<SysUser> captor = ArgumentCaptor.forClass(SysUser.class);
        verify(userRepository).save(captor.capture());
        assertEquals("newuser", captor.getValue().getUsername());
    }

    @Test
    void register_duplicateUsername_throwsException() {
        RegisterRequest request = new RegisterRequest();
        request.setUsername("testuser");
        request.setPassword("password123");

        when(userRepository.existsByUsername("testuser")).thenReturn(true);

        RuntimeException ex = assertThrows(RuntimeException.class, () -> authService.register(request));
        assertEquals("用户名已存在", ex.getMessage());
        verify(userRepository, never()).save(any());
    }

    // ========== getPendingUsers ==========

    @Test
    void getPendingUsers_returnsPendingList() {
        when(userRepository.findByStatus(UserStatus.PENDING)).thenReturn(List.of(pendingUser));

        List<SysUser> result = authService.getPendingUsers();

        assertEquals(1, result.size());
        assertEquals(UserStatus.PENDING, result.get(0).getStatus());
    }

    // ========== getAllUsers ==========

    @Test
    void getAllUsers_noFilters_returnsAll() {
        Pageable pageable = PageRequest.of(0, 10);
        Page<SysUser> page = new PageImpl<>(List.of(approvedUser, pendingUser));
        when(userRepository.findAll(pageable)).thenReturn(page);

        Page<SysUser> result = authService.getAllUsers(null, null, pageable);

        assertEquals(2, result.getTotalElements());
        verify(userRepository).findAll(pageable);
    }

    @Test
    void getAllUsers_filterByStatus() {
        Pageable pageable = PageRequest.of(0, 10);
        Page<SysUser> page = new PageImpl<>(List.of(approvedUser));
        when(userRepository.findByStatus(UserStatus.APPROVED, pageable)).thenReturn(page);

        Page<SysUser> result = authService.getAllUsers(UserStatus.APPROVED, null, pageable);

        assertEquals(1, result.getTotalElements());
        verify(userRepository).findByStatus(UserStatus.APPROVED, pageable);
    }

    @Test
    void getAllUsers_filterByUsername() {
        Pageable pageable = PageRequest.of(0, 10);
        Page<SysUser> page = new PageImpl<>(List.of(approvedUser));
        when(userRepository.findByUsernameContainingIgnoreCase("test", pageable)).thenReturn(page);

        Page<SysUser> result = authService.getAllUsers(null, "test", pageable);

        assertEquals(1, result.getTotalElements());
        verify(userRepository).findByUsernameContainingIgnoreCase("test", pageable);
    }

    @Test
    void getAllUsers_filterByStatusAndUsername() {
        Pageable pageable = PageRequest.of(0, 10);
        Page<SysUser> page = new PageImpl<>(List.of(approvedUser));
        when(userRepository.findByStatusAndUsernameContainingIgnoreCase(
                UserStatus.APPROVED, "test", pageable)).thenReturn(page);

        Page<SysUser> result = authService.getAllUsers(UserStatus.APPROVED, "test", pageable);

        assertEquals(1, result.getTotalElements());
        verify(userRepository).findByStatusAndUsernameContainingIgnoreCase(
                UserStatus.APPROVED, "test", pageable);
    }

    @Test
    void getAllUsers_blankUsername_treatedAsNull() {
        Pageable pageable = PageRequest.of(0, 10);
        Page<SysUser> page = new PageImpl<>(List.of(approvedUser));
        when(userRepository.findByStatus(UserStatus.APPROVED, pageable)).thenReturn(page);

        Page<SysUser> result = authService.getAllUsers(UserStatus.APPROVED, "  ", pageable);

        assertEquals(1, result.getTotalElements());
        verify(userRepository).findByStatus(UserStatus.APPROVED, pageable);
    }

    // ========== approveUser ==========

    @Test
    void approveUser_approve_setsStatusApproved() {
        when(userRepository.findById(2L)).thenReturn(Optional.of(pendingUser));
        when(userRepository.save(any(SysUser.class))).thenAnswer(i -> i.getArgument(0));

        SysUser result = authService.approveUser(2L, "APPROVE");

        assertEquals(UserStatus.APPROVED, result.getStatus());
    }

    @Test
    void approveUser_reject_setsStatusRejected() {
        when(userRepository.findById(2L)).thenReturn(Optional.of(pendingUser));
        when(userRepository.save(any(SysUser.class))).thenAnswer(i -> i.getArgument(0));

        SysUser result = authService.approveUser(2L, "REJECT");

        assertEquals(UserStatus.REJECTED, result.getStatus());
    }

    @Test
    void approveUser_caseInsensitive() {
        when(userRepository.findById(2L)).thenReturn(Optional.of(pendingUser));
        when(userRepository.save(any(SysUser.class))).thenAnswer(i -> i.getArgument(0));

        SysUser result = authService.approveUser(2L, "approve");

        assertEquals(UserStatus.APPROVED, result.getStatus());
    }

    @Test
    void approveUser_invalidAction_throwsException() {
        when(userRepository.findById(2L)).thenReturn(Optional.of(pendingUser));

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> authService.approveUser(2L, "INVALID"));
        assertTrue(ex.getMessage().contains("无效的操作"));
    }

    @Test
    void approveUser_userNotFound_throwsException() {
        when(userRepository.findById(999L)).thenReturn(Optional.empty());

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> authService.approveUser(999L, "APPROVE"));
        assertEquals("用户不存在", ex.getMessage());
    }

    // ========== updateUserRole ==========

    @Test
    void updateUserRole_toAdmin() {
        SysRole adminRole = new SysRole("ADMIN", "管理员", "管理权限", true);
        adminRole.setId(20L);

        when(userRepository.findById(1L)).thenReturn(Optional.of(approvedUser));
        when(sysRoleRepository.findByCode("ADMIN")).thenReturn(Optional.of(adminRole));
        when(sysUserRoleRepository.save(any(SysUserRole.class))).thenAnswer(i -> i.getArgument(0));

        SysUser result = authService.updateUserRole(1L, "ADMIN");

        assertNotNull(result);
        assertEquals(1L, result.getId());

        // 验证 RBAC 操作：清除旧角色 + 分配新角色
        verify(sysUserRoleRepository).deleteByUserId(1L);
        verify(sysUserRoleRepository).save(any(SysUserRole.class));
        verify(permissionCacheService).evictUserPermissions(1L);
    }

    @Test
    void updateUserRole_caseInsensitive() {
        SysRole adminRole = new SysRole("ADMIN", "管理员", "管理权限", true);
        adminRole.setId(20L);

        when(userRepository.findById(1L)).thenReturn(Optional.of(approvedUser));
        when(sysRoleRepository.findByCode("ADMIN")).thenReturn(Optional.of(adminRole));
        when(sysUserRoleRepository.save(any(SysUserRole.class))).thenAnswer(i -> i.getArgument(0));

        SysUser result = authService.updateUserRole(1L, "admin");

        assertNotNull(result);
        verify(sysRoleRepository).findByCode("ADMIN");
        verify(sysUserRoleRepository).deleteByUserId(1L);
        verify(sysUserRoleRepository).save(any(SysUserRole.class));
        verify(permissionCacheService).evictUserPermissions(1L);
    }

    @Test
    void updateUserRole_invalidRole_throwsException() {
        when(userRepository.findById(1L)).thenReturn(Optional.of(approvedUser));
        when(sysRoleRepository.findByCode("SUPERADMIN")).thenReturn(Optional.empty());

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> authService.updateUserRole(1L, "SUPERADMIN"));
        assertTrue(ex.getMessage().contains("无效的角色"));
    }

    @Test
    void updateUserRole_userNotFound_throwsException() {
        when(userRepository.findById(999L)).thenReturn(Optional.empty());

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> authService.updateUserRole(999L, "ADMIN"));
        assertEquals("用户不存在", ex.getMessage());
    }

    // ========== resetPassword ==========

    @Test
    void resetPassword_success() {
        when(userRepository.findById(1L)).thenReturn(Optional.of(approvedUser));
        when(passwordEncoder.encode("newpass123")).thenReturn("encoded_new_pass");
        when(userRepository.save(any(SysUser.class))).thenAnswer(i -> i.getArgument(0));

        authService.resetPassword(1L, "newpass123");

        ArgumentCaptor<SysUser> captor = ArgumentCaptor.forClass(SysUser.class);
        verify(userRepository).save(captor.capture());
        assertEquals("encoded_new_pass", captor.getValue().getPassword());
    }

    @Test
    void resetPassword_userNotFound_throwsException() {
        when(userRepository.findById(999L)).thenReturn(Optional.empty());

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> authService.resetPassword(999L, "newpass123"));
        assertEquals("用户不存在", ex.getMessage());
    }
}
