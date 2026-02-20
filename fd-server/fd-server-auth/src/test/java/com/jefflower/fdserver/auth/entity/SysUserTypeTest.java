package com.jefflower.fdserver.auth.entity;

import com.jefflower.fdserver.auth.enums.UserType;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SysUserTypeTest {

    @Test
    void newUser_defaultUserType_isInternal() {
        SysUser user = new SysUser();
        assertEquals(UserType.INTERNAL, user.getUserType());
    }

    @Test
    void setUserType_toExternal() {
        SysUser user = new SysUser();
        user.setUserType(UserType.EXTERNAL);
        assertEquals(UserType.EXTERNAL, user.getUserType());
    }

    @Test
    void setUserType_toInternal() {
        SysUser user = new SysUser();
        user.setUserType(UserType.EXTERNAL);
        user.setUserType(UserType.INTERNAL);
        assertEquals(UserType.INTERNAL, user.getUserType());
    }

    @Test
    void userType_enumValues() {
        UserType[] values = UserType.values();
        assertEquals(2, values.length);
        assertEquals(UserType.INTERNAL, UserType.valueOf("INTERNAL"));
        assertEquals(UserType.EXTERNAL, UserType.valueOf("EXTERNAL"));
    }
}
