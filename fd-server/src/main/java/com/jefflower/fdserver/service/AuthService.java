package com.jefflower.fdserver.service;

import com.jefflower.fdserver.dto.LoginRequest;
import com.jefflower.fdserver.dto.LoginResponse;
import com.jefflower.fdserver.dto.RegisterRequest;
import com.jefflower.fdserver.entity.SysUser;
import com.jefflower.fdserver.enums.UserRole;
import com.jefflower.fdserver.enums.UserStatus;
import com.jefflower.fdserver.repository.SysUserRepository;
import com.jefflower.fdserver.security.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final SysUserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    public LoginResponse login(LoginRequest request) {
        SysUser user = userRepository.findByUsername(request.getUsername())
                .orElseThrow(() -> new RuntimeException("用户名或密码错误"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new RuntimeException("用户名或密码错误");
        }

        if (user.getStatus() != UserStatus.APPROVED) {
            throw new RuntimeException("用户尚未审核通过");
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

        SysUser user = new SysUser();
        user.setUsername(request.getUsername());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setRole(UserRole.USER);
        user.setStatus(UserStatus.PENDING);

        return userRepository.save(user);
    }

    public List<SysUser> getPendingUsers() {
        return userRepository.findByStatus(UserStatus.PENDING);
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
}
