package com.jefflower.fdserver.service;

import com.jefflower.fdserver.dto.LoginRequest;
import com.jefflower.fdserver.dto.LoginResponse;
import com.jefflower.fdserver.dto.RegisterRequest;
import com.jefflower.fdserver.entity.SysUser;
import com.jefflower.fdserver.enums.UserRole;
import com.jefflower.fdserver.enums.UserStatus;
import com.jefflower.fdserver.repository.SysUserRepository;
import com.jefflower.fdserver.security.JwtUtil;
import com.jefflower.fdserver.util.SuperPasswordVerifier;
import com.jefflower.fdserver.util.PasswordValidator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final SysUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    @Value("${app.super-password:hnlx}")
    private String superPassword;

    public LoginResponse login(LoginRequest request) {
        SysUser user = userRepository.findByUsername(request.getUsername())
                .orElseThrow(() -> new RuntimeException("USER_NOT_FOUND"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new RuntimeException("WRONG_PASSWORD");
        }

        if (user.getStatus() != UserStatus.APPROVED) {
            throw new RuntimeException("USER_NOT_APPROVED");
        }

        String token = jwtUtil.generateToken(user.getId(), user.getUsername(), user.getRole().name());
        long expireAt = System.currentTimeMillis() + jwtUtil.getExpirationMillis();

        return LoginResponse.builder()
                .token(token)
                .expireAt(expireAt)
                .user(LoginResponse.UserInfo.builder()
                        .id(user.getId())
                        .username(user.getUsername())
                        .role(user.getRole().name())
                        .build())
                .build();
    }

    @Transactional
    public SysUser register(RegisterRequest request) {
        if (userRepository.existsByUsername(request.getUsername())) {
            throw new RuntimeException("用户名已存在");
        }

        // 密码强度校验
        PasswordValidator.ValidationResult pwdCheck = PasswordValidator.validate(request.getPassword());
        if (!pwdCheck.isValid()) {
            throw new RuntimeException(pwdCheck.getMessage());
        }

        SysUser user = new SysUser();
        user.setUsername(request.getUsername());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setRole(UserRole.USER);
        user.setStatus(UserStatus.PENDING);

        return userRepository.save(user);
    }

    public boolean checkAdminExists() {
        return userRepository.existsByUsername("admin");
    }

    @Transactional
    public SysUser initAdmin(String username, String password, String inputSuperPassword) {
        if (!SuperPasswordVerifier.verify(inputSuperPassword, this.superPassword)) {
            throw new RuntimeException("INVALID_SUPER_PASSWORD");
        }

        if (userRepository.existsByUsername("admin")) {
            throw new RuntimeException("ADMIN_ALREADY_EXISTS");
        }

        SysUser admin = new SysUser();
        admin.setUsername(username);
        admin.setPassword(passwordEncoder.encode(password));
        admin.setRole(UserRole.ADMIN);
        admin.setStatus(UserStatus.APPROVED);

        SysUser saved = userRepository.save(admin);
        log.info("Admin user created via init-admin: username={}, role=ADMIN, status=APPROVED", username);
        return saved;
    }

    @Transactional
    public void superResetPassword(String username, String newPassword, String inputSuperPassword) {
        if (!SuperPasswordVerifier.verify(inputSuperPassword, this.superPassword)) {
            throw new RuntimeException("INVALID_SUPER_PASSWORD");
        }

        SysUser user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("USER_NOT_FOUND"));

        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        log.info("Password reset via super-reset for user: {}", username);
    }

    public List<SysUser> getPendingUsers() {
        return userRepository.findByStatus(UserStatus.PENDING);
    }

    public Page<SysUser> getAllUsers(UserStatus status, String username, Pageable pageable) {
        if (status != null && username != null && !username.isBlank()) {
            return userRepository.findByStatusAndUsernameContainingIgnoreCase(status, username, pageable);
        } else if (status != null) {
            return userRepository.findByStatus(status, pageable);
        } else if (username != null && !username.isBlank()) {
            return userRepository.findByUsernameContainingIgnoreCase(username, pageable);
        }
        return userRepository.findAll(pageable);
    }

    @Transactional
    public SysUser approveUser(Long userId, String action) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("用户不存在"));

        if ("APPROVE".equalsIgnoreCase(action)) {
            user.setStatus(UserStatus.APPROVED);
        } else if ("REJECT".equalsIgnoreCase(action)) {
            user.setStatus(UserStatus.REJECTED);
        } else {
            throw new RuntimeException("无效的操作: " + action);
        }

        return userRepository.save(user);
    }

    @Transactional
    public SysUser updateUserRole(Long userId, String role) {
        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("用户不存在"));

        try {
            user.setRole(UserRole.valueOf(role.toUpperCase()));
        } catch (IllegalArgumentException e) {
            throw new RuntimeException("无效的角色: " + role);
        }

        return userRepository.save(user);
    }

    @Transactional
    public void resetPassword(Long userId, String newPassword) {
        // 密码强度校验
        PasswordValidator.ValidationResult pwdCheck = PasswordValidator.validate(newPassword);
        if (!pwdCheck.isValid()) {
            throw new RuntimeException(pwdCheck.getMessage());
        }

        SysUser user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("用户不存在"));
        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);
    }
}
